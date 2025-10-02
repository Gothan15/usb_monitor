import { randomBytes, scryptSync, timingSafeEqual, createHmac } from "crypto";
import argon2 from "argon2";
import { db } from "./db";

// Autenticación simplificada:
// - Un único token de sesión firmado (HMAC) en cookie HttpOnly 'session'
// - Formato: base64url(JSON { uid, ak, exp }) + '.' + firma
// - Expira a la hora (por defecto) y se renueva opcionalmente en /api/auth/session
// - Fallback: ApiKey vía Authorization: ApiKey <key>

// Rotación de claves: SESSION_SECRETS="key1,key2,key3" (key1 activa)
const secretEnv =
  process.env.SESSION_SECRETS ||
  process.env.SESSION_SECRET ||
  process.env.JWT_SECRET ||
  "usbmonitor_secret_2025";
const SECRET_KEYS = secretEnv.split(/[,;\s]+/).filter(Boolean);
const ACTIVE_SECRET = SECRET_KEYS[0];
const SESSION_TTL_SECONDS = 60 * 60; // 1 hora
const PASSWORD_HASH_PREFIX_SCRYPT = "scrypt"; // legado
const PASSWORD_HASH_PREFIX_ARGON2 = "argon2id"; // nuevo formato
// Parámetros Argon2 recomendados (ajustar según recursos)
const ARGON2_OPTS = {
  type: argon2.argon2id,
  timeCost: 2,
  memoryCost: 19456, // ~19MB
  parallelism: 1,
  hashLength: 64,
};
// Inactividad máxima (sliding): si han pasado más de X segundos desde último uso => inválida
const SESSION_INACTIVITY_LIMIT = 30 * 60; // 30 min

export interface AuthIdentity {
  userId: string;
  apiKey: string | null;
}

export function hashPasswordLegacyScrypt(password: string): string {
  const salt = randomBytes(16);
  const derived = scryptSync(password, salt, 64);
  return `${PASSWORD_HASH_PREFIX_SCRYPT}$${salt.toString(
    "hex"
  )}$${derived.toString("hex")}`;
}

export async function hashPassword(password: string): Promise<string> {
  const hash = await argon2.hash(password, ARGON2_OPTS);
  return `${PASSWORD_HASH_PREFIX_ARGON2}$${hash}`; // almacenamos prefijo + hash argon2 completo
}

export async function verifyPassword(
  password: string,
  stored: string
): Promise<{
  valid: boolean;
  needsRehash: boolean;
}> {
  try {
    if (stored.startsWith(PASSWORD_HASH_PREFIX_ARGON2 + "$")) {
      const hash = stored.substring(PASSWORD_HASH_PREFIX_ARGON2.length + 1);
      const valid = await argon2.verify(hash, password, ARGON2_OPTS);
      // argon2 lib permite detectar parámetros distintos (no incluye API directa), se puede marcar policy update manual.
      return { valid, needsRehash: false };
    }
    if (stored.startsWith(PASSWORD_HASH_PREFIX_SCRYPT + "$")) {
      const parts = stored.split("$");
      if (parts.length !== 3) return { valid: false, needsRehash: false };
      const [_prefix, saltHex, hashHex] = parts;
      if (!saltHex || !hashHex) return { valid: false, needsRehash: false };
      const salt = Buffer.from(saltHex, "hex");
      const derived = scryptSync(password, salt, 64);
      const expected = Buffer.from(hashHex, "hex");
      const valid = timingSafeEqual(derived, expected);
      return { valid, needsRehash: valid }; // si es válido en scrypt pedimos rehash a argon2
    }
    return { valid: false, needsRehash: false };
  } catch {
    return { valid: false, needsRehash: false };
  }
}

export async function verifyPasswordFast(password: string, stored: string) {
  return verifyPassword(password, stored);
}

export function generateApiKey(): string {
  return "uk_" + randomBytes(24).toString("base64url");
}

interface SessionPayload {
  uid: string;
  ak?: string | null;
  exp: number; // epoch seconds (expiration)
  la?: number; // last activity epoch seconds
}

function b64url(data: Buffer | string) {
  return (typeof data === "string" ? Buffer.from(data) : data)
    .toString("base64")
    .replace(/=/g, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");
}
function signWithKey(body: string, key: string) {
  const mac = b64url(createHmac("sha256", key).update(body).digest());
  return body + "." + mac;
}

function signSession(p: SessionPayload) {
  const body = b64url(JSON.stringify(p));
  return signWithKey(body, ACTIVE_SECRET);
}

function verifySession(token: string): SessionPayload | null {
  const [body, sig] = token.split(".");
  if (!body || !sig) return null;
  // Probar contra todas las claves (rotación)
  let valid = false;
  for (const key of SECRET_KEYS) {
    const expected = b64url(createHmac("sha256", key).update(body).digest());
    if (sig === expected) {
      valid = true;
      break;
    }
  }
  if (!valid) return null;
  try {
    const payload = JSON.parse(
      Buffer.from(
        body.replace(/-/g, "+").replace(/_/g, "/"),
        "base64"
      ).toString()
    ) as SessionPayload;
    const now = Math.floor(Date.now() / 1000);
    if (payload.exp < now) return null;
    if (payload.la && now - payload.la > SESSION_INACTIVITY_LIMIT) return null; // inactividad
    return payload;
  } catch {
    return null;
  }
}

export function createSessionToken(
  userId: string,
  apiKey: string | null,
  ttlSeconds = SESSION_TTL_SECONDS
) {
  const now = Math.floor(Date.now() / 1000);
  return signSession({
    uid: userId,
    ak: apiKey,
    exp: now + ttlSeconds,
    la: now,
  });
}

export function renewSessionToken(token: string): string | null {
  const payload = verifySession(token);
  if (!payload) return null;
  const now = Math.floor(Date.now() / 1000);
  // Sliding inactivity update: solo regenerar si han pasado > 2 min desde última actividad
  if (payload.la && now - payload.la < 120) return token; // evitar regeneración excesiva
  return signSession({
    uid: payload.uid,
    ak: payload.ak ?? null,
    exp: now + SESSION_TTL_SECONDS,
    la: now,
  });
}

export async function authenticateRequest(
  req: Request
): Promise<AuthIdentity | null> {
  // 1) Cookie de sesión
  const cookieHeader = req.headers.get("cookie") || "";
  if (cookieHeader) {
    const cookies = Object.fromEntries(
      cookieHeader
        .split(/; */)
        .filter(Boolean)
        .map((c) => {
          const [k, ...r] = c.split("=");
          return [decodeURIComponent(k), decodeURIComponent(r.join("="))];
        })
    );
    if (cookies.session) {
      const payload = verifySession(cookies.session);
      if (payload) return { userId: payload.uid, apiKey: payload.ak || null };
    }
  }
  // 2) API Key fallback
  const authHeader = req.headers.get("authorization") || "";
  const apiKeyMatch = authHeader.match(/^ApiKey\s+(\S+)$/i);
  if (apiKeyMatch) {
    const apiKey = apiKeyMatch[1];
    const user = await (db as any).user.findUnique({
      where: { apiKey },
      select: { id: true, apiKey: true },
    });
    if (user) return { userId: user.id, apiKey: user.apiKey };
  }
  return null;
}

export async function requireAuth(req: Request): Promise<AuthIdentity> {
  const auth = await authenticateRequest(req);
  if (!auth) throw new Error("UNAUTHORIZED");
  return auth;
}

export async function simulatePasswordCheckDelay() {
  await new Promise((r) => setTimeout(r, 400));
}

// Helpers exportados para rutas específicas
// Export utilidades mínimas para rutas
export const sessionInternal = { verifySession, renewSessionToken };

/**
 * Verifica sesión desde un Request y devuelve información del usuario
 */
export async function verifySessionFromRequest(
  req: Request
): Promise<{ username: string; role: string } | null> {
  const cookieHeader = req.headers.get("cookie") || "";
  if (!cookieHeader) return null;

  const cookies = Object.fromEntries(
    cookieHeader
      .split(/; */)
      .filter(Boolean)
      .map((c) => {
        const [k, ...r] = c.split("=");
        return [decodeURIComponent(k), decodeURIComponent(r.join("="))];
      })
  );

  if (!cookies.session) return null;

  const payload = verifySession(cookies.session);
  if (!payload) return null;

  const user = await (db as any).user.findUnique({
    where: { id: payload.uid },
    select: { username: true, role: true },
  });

  return user;
}
