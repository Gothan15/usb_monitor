import {
  randomBytes,
  scryptSync,
  timingSafeEqual,
  createHmac,
  createHash,
} from "crypto";
import QuickLRU from "quick-lru";
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
    "SESSION_SECRET environment variable is required. Rotate any existing sessions after setting it.",
  );
}

const rolloverSecrets = (process.env.SESSION_SECRET_ROLLOVER || "")
  .split(/[,;]/)
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
const SESSION_CACHE_TTL_MS = 2 * 60 * 1000; // cache lookups for 2 minutos
const SESSION_CACHE_MAX = 1000;
const AGENT_CACHE_TTL_MS = 60 * 1000;
const AGENT_CACHE_MAX = 200;

type UserRole = "admin" | "user";

type CachedUser = {
  id: string;
  username: string;
  role: UserRole;
  apiKey: string | null;
  computerId: string | null;
  computerName: string | null;
};

// Keeps hot user lookups in-memory so high-frequency endpoints avoid repetitive SQL hits.
const sessionUserCache = new QuickLRU<
  string,
  { payload: CachedUser; expiresAt: number }
>({
  maxSize: SESSION_CACHE_MAX,
});

const agentServiceCache = new QuickLRU<
  string,
  { payload: AgentServiceIdentity; expiresAt: number }
>({
  maxSize: AGENT_CACHE_MAX,
});

function cacheKeyUser(id: string) {
  return `uid:${id}`;
}

function cacheKeyApiKey(apiKey: string) {
  return `ak:${apiKey}`;
}

function cacheKeyAgent(apiKey: string) {
  return `svc:${apiKey}`;
}

function setCachedUser(key: string, user: CachedUser) {
  sessionUserCache.set(key, {
    payload: user,
    expiresAt: Date.now() + SESSION_CACHE_TTL_MS,
  });
}

function getCachedUser(key: string): CachedUser | null {
  const cached = sessionUserCache.get(key);
  if (!cached) return null;
  if (cached.expiresAt <= Date.now()) {
    sessionUserCache.delete(key);
    return null;
  }
  return cached.payload;
}

function cacheAgentIdentity(apiKey: string, identity: AgentServiceIdentity) {
  agentServiceCache.set(cacheKeyAgent(apiKey), {
    payload: identity,
    expiresAt: Date.now() + AGENT_CACHE_TTL_MS,
  });
}

function getCachedAgentIdentity(apiKey: string): AgentServiceIdentity | null {
  const cached = agentServiceCache.get(cacheKeyAgent(apiKey));
  if (!cached) return null;
  if (cached.expiresAt <= Date.now()) {
    agentServiceCache.delete(cacheKeyAgent(apiKey));
    return null;
  }
  return cached.payload;
}

function normalizeUserRecord(user: any): CachedUser {
  return {
    id: user.id,
    username: user.username,
    role: (user.role?.toLowerCase?.() || user.role) as UserRole,
    apiKey: user.apiKey ?? null,
    computerId: user.computerId ?? null,
    computerName: user.computer?.name ?? null,
  };
}

function cacheUserRecord(user: CachedUser) {
  setCachedUser(cacheKeyUser(user.id), user);
  if (user.apiKey) {
    setCachedUser(cacheKeyApiKey(user.apiKey), user);
  }
}

function toUserAuthIdentity(
  user: CachedUser,
  sessionNeedsRotation?: boolean,
): UserAuthIdentity {
  return {
    type: "user",
    userId: user.id,
    username: user.username,
    role: user.role,
    apiKey: user.apiKey,
    computerId: user.computerId,
    computerName: user.computerName,
    sessionNeedsRotation,
  };
}

function asServiceIdentityFromAgent(
  user: CachedUser,
): AgentServiceIdentity | null {
  if (user.role !== "user") {
    return null;
  }
  if (!user.apiKey) {
    return null;
  }
  const serviceId = user.computerName?.trim() || `service:${user.id}`;
  return {
    type: "service",
    serviceId,
    token: user.apiKey,
    agentUserId: user.id,
    computerId: user.computerId,
  };
}

type AuthIdentity = UserAuthIdentity | ServiceAuthIdentity;

export interface UserAuthIdentity {
  type: "user";
  userId: string;
  username: string;
  role: UserRole;
  apiKey: string | null;
  computerId: string | null;
  computerName?: string | null;
  sessionNeedsRotation?: boolean;
}

export interface ServiceAuthIdentity {
  type: "service";
  serviceId: string;
  token: string;
  agentUserId?: string;
  computerId?: string | null;
}

type AgentServiceIdentity = ServiceAuthIdentity & {
  agentUserId: string;
  computerId: string | null;
};

const CSRF_COOKIE_NAME = "csrf-token";
const CSRF_HEADER_NAME = "x-csrf-token";
const SAFE_HTTP_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);
const AUTHORIZATION_HEADER_PATTERN = /^ApiKey\s+(\S+)$/i;

const SERVICE_API_KEYS = (() => {
  const raw = process.env.SERVICE_API_KEYS || "";
  const entries = raw
    .split(",")
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

/**
 * Credencial por equipo (fase 3 del plan de desbloqueo): cada PC tiene
 * un token propio; el servidor guarda solo su hash SHA-256 en
 * Computer.agentTokenHash y el agente lo presenta como
 * `Authorization: AgentToken <token>`.
 */
export function hashAgentToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

export function generateAgentToken(): string {
  return randomBytes(32).toString("hex");
}

const computerTokenCache = new Map<
  string,
  { identity: ServiceAuthIdentity; expiresAt: number }
>();

async function authenticateAgentToken(
  token: string,
): Promise<ServiceAuthIdentity | null> {
  const cached = computerTokenCache.get(token);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.identity;
  }
  const computer = await (db as any).computer.findFirst({
    where: { agentTokenHash: hashAgentToken(token) },
    select: { id: true, name: true },
  });
  if (!computer) {
    return null;
  }
  const identity: ServiceAuthIdentity = {
    type: "service",
    serviceId: computer.name,
    token,
    computerId: computer.id,
  };
  computerTokenCache.set(token, {
    identity,
    expiresAt: Date.now() + AGENT_CACHE_TTL_MS,
  });
  return identity;
}

function parseCookies(headerValue: string | null): Record<string, string> {
  if (!headerValue) return {};
  const pairs = headerValue
    .split(";")
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
  cookies?: Record<string, string>,
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
    "hex",
  )}$${derived.toString("hex")}`;
}

export async function hashPassword(password: string): Promise<string> {
  const hash = await argon2.hash(password, ARGON2_OPTS);
  return `${PASSWORD_HASH_PREFIX_ARGON2}$${hash}`; // almacenamos prefijo + hash argon2 completo
}

export async function verifyPassword(
  password: string,
  stored: string,
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
  token: string,
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
        "base64",
      ).toString(),
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
  ttlSeconds = SESSION_TTL_SECONDS,
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
  req: Request,
): Promise<AuthIdentity | null> {
  // 1) Cookie de sesión
  const cookies = parseCookies(req.headers.get("cookie"));
  const sessionToken = cookies.session;
  if (sessionToken) {
    const verification = verifySessionInternal(sessionToken);
    if (verification) {
      let user = getCachedUser(cacheKeyUser(verification.payload.uid));
      if (!user) {
        const record = await (db as any).user.findUnique({
          where: { id: verification.payload.uid },
          select: {
            id: true,
            apiKey: true,
            username: true,
            role: true,
            computerId: true,
            computer: { select: { name: true } },
          },
        });
        if (record) {
          user = normalizeUserRecord(record);
          cacheUserRecord(user);
        }
      }
      if (user) {
        return toUserAuthIdentity(user, verification.needsRotation);
      }
    }
  }
  // 1b) Token por equipo (agente): Authorization: AgentToken <token>
  const authHeader = req.headers.get("authorization") || "";
  const agentTokenMatch = authHeader.match(/^AgentToken\s+(\S+)$/i);
  if (agentTokenMatch) {
    return authenticateAgentToken(agentTokenMatch[1]);
  }

  // 2) API Key fallback
  const apiKeyMatch = authHeader.match(AUTHORIZATION_HEADER_PATTERN);
  if (apiKeyMatch) {
    const apiKey = apiKeyMatch[1];
    if (SERVICE_API_KEYS.has(apiKey)) {
      return {
        type: "service",
        serviceId: SERVICE_API_KEYS.get(apiKey) as string,
        token: apiKey,
      };
    }
    let user = getCachedUser(cacheKeyApiKey(apiKey));
    if (!user) {
      const record = await (db as any).user.findUnique({
        where: { apiKey },
        select: {
          id: true,
          apiKey: true,
          username: true,
          role: true,
          computerId: true,
          computer: { select: { name: true } },
        },
      });
      if (record) {
        user = normalizeUserRecord(record);
        cacheUserRecord(user);
      }
    }
    if (user) {
      return toUserAuthIdentity(user);
    }
  }
  return null;
}

export async function requireAuth(
  req: Request,
  options: { role?: UserRole; enforceCsrf?: boolean } = {},
): Promise<UserAuthIdentity> {
  const auth = await authenticateRequest(req);
  if (!auth || auth.type !== "user") {
    throw new Error(options.role ? "FORBIDDEN" : "UNAUTHORIZED");
  }
  if (
    options.role &&
    auth.role?.toLowerCase() !== options.role?.toLowerCase()
  ) {
    throw new Error("FORBIDDEN");
  }
  if (options.enforceCsrf !== false) {
    validateCsrfToken(req, auth);
  }
  return auth;
}

export async function requireServiceAuth(
  req: Request,
): Promise<ServiceAuthIdentity> {
  const authHeader = req.headers.get("authorization") || "";
  const apiKeyMatch = authHeader.match(AUTHORIZATION_HEADER_PATTERN);
  const presentedApiKey = apiKeyMatch?.[1] ?? null;

  if (presentedApiKey) {
    const cached = getCachedAgentIdentity(presentedApiKey);
    if (cached) {
      return cached;
    }
  }

  const auth = await authenticateRequest(req);
  if (auth && auth.type === "service") {
    return auth;
  }

  if (auth && auth.type === "user" && auth.role === "user") {
    if (!auth.apiKey || !presentedApiKey || auth.apiKey !== presentedApiKey) {
      throw new Error("UNAUTHORIZED");
    }
    const candidate: CachedUser = {
      id: auth.userId,
      username: auth.username,
      role: auth.role,
      apiKey: auth.apiKey,
      computerId: auth.computerId ?? null,
      computerName: auth.computerName ?? null,
    };
    const serviceIdentity = asServiceIdentityFromAgent(candidate);
    if (!serviceIdentity) {
      throw new Error("UNAUTHORIZED");
    }
    if (!serviceIdentity.computerId) {
      const roleLabel = "user";
      console.warn(
        `[auth] ${roleLabel} ${auth.username} (${auth.userId}) lacks an assigned computer; rejecting service authentication.`,
      );
      throw new Error("UNAUTHORIZED");
    }
    cacheAgentIdentity(presentedApiKey, serviceIdentity);
    return serviceIdentity;
  }

  throw new Error("UNAUTHORIZED");
}

export async function simulatePasswordCheckDelay() {
  await new Promise((r) => setTimeout(r, 400));
}

/**
 * Verifica sesión desde un Request y devuelve información del usuario
 */
export async function verifySessionFromRequest(
  req: Request,
): Promise<{ username: string; role: string } | null> {
  const cookies = parseCookies(req.headers.get("cookie"));
  if (!cookies.session) return null;

  const verification = verifySessionInternal(cookies.session);
  if (!verification) return null;

  const user = await (db as any).user.findUnique({
    where: { id: verification.payload.uid },
    select: { username: true, role: true },
  });

  if (!user) return null;

  return {
    username: user.username,
    role: user.role?.toLowerCase?.() ?? user.role,
  };
}

export function buildSessionCookie(
  token: string,
  ttlSeconds = SESSION_TTL_SECONDS,
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
  ttlSeconds = SESSION_TTL_SECONDS,
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

export const authTesting = {
  clearCaches() {
    sessionUserCache.clear();
    agentServiceCache.clear();
  },
  seedApiKeyUserCache(seed: {
    id: string;
    username: string;
    role: UserRole;
    apiKey: string;
    computerId?: string | null;
    computerName?: string | null;
  }) {
    const cached: CachedUser = {
      id: seed.id,
      username: seed.username,
      role: seed.role,
      apiKey: seed.apiKey,
      computerId: seed.computerId ?? null,
      computerName: seed.computerName ?? null,
    };
    cacheUserRecord(cached);
  },
};
