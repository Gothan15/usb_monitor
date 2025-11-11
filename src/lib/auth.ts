import { randomBytes, scryptSync, timingSafeEqual, createHmac } from "crypto";
import argon2 from "argon2";
import { db } from "./db";
import { getCurrentTimestamp } from "./time";

// Autenticación simplificada:
// - Un único token de sesión firmado (HMAC) en cookie HttpOnly 'session'
// - Formato: base64url(JSON { uid, ak, exp }) + '.' + firma
// - Expira a la hora (por defecto) y se renueva opcionalmente en /api/auth/session
// - Fallback: ApiKey vía Authorization: ApiKey <key>

// Rotación de claves: SESSION_SECRETS="key1,key2,key3" (key1 activa)
const primarySecret = process.env.SESSION_SECRET;
if (!primarySecret) {
  throw new Error(
    "SESSION_SECRET environment variable is required. Rotate any existing sessions after setting it."
  );
}

const rolloverSecrets = (process.env.SESSION_SECRET_ROLLOVER || "")
  .split(/[,;\s]+/)
  .map((value) => value.trim())
  .filter(Boolean);

const SECRET_KEYS = [primarySecret, ...rolloverSecrets];
const ACTIVE_SECRET = primarySecret;
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

type AuthIdentity = UserAuthIdentity | ServiceAuthIdentity;

export interface UserAuthIdentity {
  type: "user";
  userId: string;
  username: string;
  role: string;
  apiKey: string | null;
  sessionNeedsRotation?: boolean;
}

export interface ServiceAuthIdentity {
  type: "service";
  serviceId: string;
  token: string;
}

const CSRF_COOKIE_NAME = "csrf-token";
const CSRF_HEADER_NAME = "x-csrf-token";
const SAFE_HTTP_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

const SERVICE_API_KEYS = (() => {
  const raw = process.env.SERVICE_API_KEYS || "";
  const entries = raw
    .split(/[,\s]+/)
    .map((value) => value.trim())
    .filter(Boolean);
  const map = new Map<string, string>();
  for (const entry of entries) {
    const [id, token] = entry.split(":");
    if (id && token) {
      map.set(token.trim(), id.trim());
    }
  }
  return map;
})();

function parseCookies(headerValue: string | null): Record<string, string> {
  if (!headerValue) return {};
  const pairs = headerValue
    .split(/; */)
    .map((chunk) => chunk.trim())
    .filter(Boolean)
    .map((cookie) => {
      const [key, ...rest] = cookie.split("=");
      return [decodeURIComponent(key), decodeURIComponent(rest.join("="))];
    });
  return Object.fromEntries(pairs);
}

function safeRandomCsrfToken() {
  return randomBytes(32).toString("base64url");
}

function readCsrfTokenFromRequest(
  req: Request,
  cookies?: Record<string, string>
) {
  const cookieBag = cookies || parseCookies(req.headers.get("cookie"));
  return cookieBag[CSRF_COOKIE_NAME];
}

function validateCsrfToken(req: Request, authIdentity: AuthIdentity | null) {
  if (!authIdentity || authIdentity.type !== "user") {
    return;
  }

  const method = req.method?.toUpperCase?.() || "GET";
  if (SAFE_HTTP_METHODS.has(method)) return;

  const cookies = parseCookies(req.headers.get("cookie"));
  const cookieToken = readCsrfTokenFromRequest(req, cookies);
  const headerToken = req.headers.get(CSRF_HEADER_NAME);
  if (!cookieToken || !headerToken) {
    throw Object.assign(new Error("CSRF token missing"), {
      code: "CSRF_MISSING",
    });
  }
  if (cookieToken.length !== headerToken.length) {
    throw Object.assign(new Error("CSRF token invalid"), {
      code: "CSRF_INVALID",
    });
  }
  const cookieBuffer = Buffer.from(cookieToken);
  const headerBuffer = Buffer.from(headerToken);
  if (
    cookieBuffer.length !== headerBuffer.length ||
    !timingSafeEqual(cookieBuffer, headerBuffer)
  ) {
    throw Object.assign(new Error("CSRF token mismatch"), {
      code: "CSRF_INVALID",
    });
  }
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

interface SessionVerificationResult {
  payload: SessionPayload;
  needsRotation: boolean;
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

function verifySessionInternal(
  token: string
): SessionVerificationResult | null {
  const [body, sig] = token.split(".");
  if (!body || !sig) return null;
  let matchedKey: string | null = null;
  for (const key of SECRET_KEYS) {
    const expected = b64url(createHmac("sha256", key).update(body).digest());
    if (sig === expected) {
      matchedKey = key;
      break;
    }
  }
  if (!matchedKey) return null;
  try {
    const payload = JSON.parse(
      Buffer.from(
        body.replace(/-/g, "+").replace(/_/g, "/"),
        "base64"
      ).toString()
    ) as SessionPayload;
    const now = Math.floor(getCurrentTimestamp() / 1000);
    if (payload.exp < now) return null;
    if (payload.la && now - payload.la > SESSION_INACTIVITY_LIMIT) return null;
    return {
      payload,
      needsRotation: matchedKey !== ACTIVE_SECRET,
    };
  } catch {
    return null;
  }
}

function verifySession(token: string): SessionPayload | null {
  return verifySessionInternal(token)?.payload ?? null;
}

export function createSessionToken(
  userId: string,
  apiKey: string | null,
  ttlSeconds = SESSION_TTL_SECONDS
) {
  const now = Math.floor(getCurrentTimestamp() / 1000);
  return signSession({
    uid: userId,
    ak: apiKey,
    exp: now + ttlSeconds,
    la: now,
  });
}

export function renewSessionToken(token: string): string | null {
  const verification = verifySessionInternal(token);
  if (!verification) return null;
  const payload = verification.payload;
  const now = Math.floor(getCurrentTimestamp() / 1000);
  // Sliding inactivity update: solo regenerar si han pasado > 2 min desde última actividad
  if (!verification.needsRotation && payload.la && now - payload.la < 120)
    return token; // evitar regeneración excesiva
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
  const cookies = parseCookies(req.headers.get("cookie"));
  const sessionToken = cookies.session;
  if (sessionToken) {
    const verification = verifySessionInternal(sessionToken);
    if (verification) {
      const user = await (db as any).user.findUnique({
        where: { id: verification.payload.uid },
        select: { id: true, apiKey: true, username: true, role: true },
      });
      if (user) {
        return {
          type: "user",
          userId: user.id,
          username: user.username,
          role: user.role,
          apiKey: user.apiKey,
          sessionNeedsRotation: verification.needsRotation,
        };
      }
    }
  }
  // 2) API Key fallback
  const authHeader = req.headers.get("authorization") || "";
  const apiKeyMatch = authHeader.match(/^ApiKey\s+(\S+)$/i);
  if (apiKeyMatch) {
    const apiKey = apiKeyMatch[1];
    if (SERVICE_API_KEYS.has(apiKey)) {
      return {
        type: "service",
        serviceId: SERVICE_API_KEYS.get(apiKey) as string,
        token: apiKey,
      };
    }
    const user = await (db as any).user.findUnique({
      where: { apiKey },
      select: { id: true, apiKey: true, username: true, role: true },
    });
    if (user) {
      return {
        type: "user",
        userId: user.id,
        username: user.username,
        role: user.role,
        apiKey: user.apiKey,
      };
    }
  }
  return null;
}

export async function requireAuth(
  req: Request,
  options: { role?: string; enforceCsrf?: boolean } = {}
): Promise<UserAuthIdentity> {
  const auth = await authenticateRequest(req);
  if (!auth || auth.type !== "user") {
    throw new Error(options.role ? "FORBIDDEN" : "UNAUTHORIZED");
  }
  if (options.role && auth.role !== options.role) {
    throw new Error("FORBIDDEN");
  }
  if (options.enforceCsrf !== false) {
    validateCsrfToken(req, auth);
  }
  return auth;
}

export async function requireServiceAuth(
  req: Request
): Promise<ServiceAuthIdentity> {
  const auth = await authenticateRequest(req);
  if (!auth || auth.type !== "service") {
    throw new Error("UNAUTHORIZED");
  }
  return auth;
}

export async function simulatePasswordCheckDelay() {
  await new Promise((r) => setTimeout(r, 400));
}

/**
 * Verifica sesión desde un Request y devuelve información del usuario
 */
export async function verifySessionFromRequest(
  req: Request
): Promise<{ username: string; role: string } | null> {
  const cookies = parseCookies(req.headers.get("cookie"));
  if (!cookies.session) return null;

  const verification = verifySessionInternal(cookies.session);
  if (!verification) return null;

  const user = await (db as any).user.findUnique({
    where: { id: verification.payload.uid },
    select: { username: true, role: true },
  });

  return user;
}

export function buildSessionCookie(
  token: string,
  ttlSeconds = SESSION_TTL_SECONDS
) {
  const isProd = process.env.NODE_ENV === "production";
  const cookieFlags = [
    "Path=/",
    "HttpOnly",
    "SameSite=Strict",
    `Max-Age=${ttlSeconds}`,
  ];
  if (isProd) cookieFlags.push("Secure");
  return `session=${token}; ${cookieFlags.join("; ")}`;
}

export function buildCsrfCookie(
  token: string,
  ttlSeconds = SESSION_TTL_SECONDS
) {
  const isProd = process.env.NODE_ENV === "production";
  const cookieFlags = ["Path=/", "SameSite=Strict", `Max-Age=${ttlSeconds}`];
  if (isProd) cookieFlags.push("Secure");
  return `${CSRF_COOKIE_NAME}=${token}; ${cookieFlags.join("; ")}`;
}

export function issueCsrfToken(): string {
  return safeRandomCsrfToken();
}

export function expireSessionCookie() {
  const isProd = process.env.NODE_ENV === "production";
  const cookieFlags = ["Path=/", "HttpOnly", "SameSite=Strict", "Max-Age=0"];
  if (isProd) cookieFlags.push("Secure");
  return `session=; ${cookieFlags.join("; ")}`;
}

export function expireCsrfCookie() {
  const isProd = process.env.NODE_ENV === "production";
  const cookieFlags = ["Path=/", "SameSite=Strict", "Max-Age=0"];
  if (isProd) cookieFlags.push("Secure");
  return `${CSRF_COOKIE_NAME}=; ${cookieFlags.join("; ")}`;
}

export const sessionInternal = {
  verifySession,
  renewSessionToken,
  issueCsrfToken,
};
