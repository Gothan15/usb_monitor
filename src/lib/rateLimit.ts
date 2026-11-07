import Redis from "ioredis";
import { getCurrentTimestamp } from "@/lib/time";
import { logWarn } from "@/lib/logger";

interface BucketKeyConfig {
  windowMs: number;
  max: number;
}

interface RateLimitContext {
  userId?: string;
  serviceId?: string;
  ip?: string;
  identifier?: string;
}

interface HitResult {
  allowed: boolean;
  remaining: number;
  resetIn: number;
}

// Solo REDIS_URL (protocolo redis:// o rediss://). NO usar aquí
// UPSTASH_REDIS_REST_URL: es un endpoint REST (HTTPS), ioredis no
// puede hablar con él y el cliente quedaba fallando en cada uso.
// Si se usa Upstash, su URL válida para esto es la de protocolo
// (rediss://…) del panel de Upstash, puesta en REDIS_URL.
const redisUrl = process.env.REDIS_URL;
const isProduction = process.env.NODE_ENV === "production";

let redisClient: Redis | null = null;
let redisInitAttempted = false;
let warnedAboutInMemory = false;
let ultimoFalloRedisMs = 0;
let ultimoAvisoMs = 0;

// Tras un fallo de conexión se espera este tiempo antes de volver
// a intentarlo: un Redis caído no debe convertir cada petición en
// un intento de conexión (2 s de espera) ni en una línea de log.
const ESPERA_TRAS_FALLO_MS = 5_000;
const AVISO_CADA_MS = 30_000;

/** logWarn con freno: el mismo aviso, como mucho una vez cada 30 s. */
function avisarLimitado(mensaje: string, datos?: { message: string }) {
  const ahora = Date.now();
  if (ahora - ultimoAvisoMs < AVISO_CADA_MS) return;
  ultimoAvisoMs = ahora;
  logWarn(mensaje, datos);
}

// Contador de ventana fija en UN solo viaje a Redis y atómico:
// antes eran una transacción (INCR+PTTL) y, si la clave nacía sin
// caducidad, un PEXPIRE aparte — dos viajes en el peor caso y una
// ventana en la que otro proceso podía colarse entre ambos.
const SCRIPT_CONTADOR = `
local count = redis.call('INCR', KEYS[1])
local ttl = redis.call('PTTL', KEYS[1])
if ttl <= 0 then
  redis.call('PEXPIRE', KEYS[1], ARGV[1])
  ttl = tonumber(ARGV[1])
end
return { count, ttl }`;

function ensureRedis() {
  if (redisClient || redisInitAttempted) {
    return redisClient;
  }
  redisInitAttempted = true;
  if (!redisUrl) {
    if (!warnedAboutInMemory && isProduction) {
      warnedAboutInMemory = true;
      logWarn(
        "REDIS_URL no definido, usando rate limiting en memoria (desaconsejado en producción)"
      );
    }
    return null;
  }
  redisClient = new Redis(redisUrl, {
    lazyConnect: true,
    maxRetriesPerRequest: 0,
    connectTimeout: 2000,
    // Sin cola fuera de línea: sin conexión, el comando falla al
    // momento y manda el respaldo en memoria, sin esperas.
    enableOfflineQueue: false,
  });
  redisClient.on("error", (error) => {
    avisarLimitado("Error en cliente Redis para rate limiting", {
      message: error instanceof Error ? error.message : String(error),
    });
  });
  return redisClient;
}

const memoryStore = new Map<string, { count: number; expiresAt: number }>();

function buildKey(baseKey: string, context?: RateLimitContext) {
  const parts = ["rl", baseKey];
  if (context?.userId) parts.push(`user:${context.userId}`);
  if (context?.serviceId) parts.push(`service:${context.serviceId}`);
  if (context?.ip) parts.push(`ip:${context.ip}`);
  if (context?.identifier) parts.push(`id:${context.identifier}`);
  return parts.join("|");
}

function estadoRedis(redis: Redis): string {
  return (redis as unknown as { status?: string }).status ?? "end";
}

/**
 * Intenta contar en Redis; devuelve null si no se pudo (sin Redis,
 * caído o a mitad de conexión) y el llamador sigue con la memoria.
 * La disciplina de conexión es la misma del cliente compartido:
 * jamás se llama a connect() con una conexión en curso (ioredis
 * lo cobra con un error «already connecting» por petición) y tras
 * un fallo se espera ESPERA_TRAS_FALLO_MS antes de reintentar.
 */
async function intentarEnRedis(
  compositeKey: string,
  cfg: BucketKeyConfig
): Promise<HitResult | null> {
  const redis = ensureRedis();
  if (!redis) return null;

  const estado = estadoRedis(redis);
  if (estado === "connecting" || estado === "reconnecting") return null;
  if (estado !== "ready") {
    if (Date.now() - ultimoFalloRedisMs < ESPERA_TRAS_FALLO_MS) {
      return null;
    }
    try {
      await redis.connect();
    } catch {
      ultimoFalloRedisMs = Date.now();
      return null;
    }
    if (estadoRedis(redis) !== "ready") {
      ultimoFalloRedisMs = Date.now();
      return null;
    }
  }

  try {
    const respuesta = (await redis.eval(
      SCRIPT_CONTADOR,
      1,
      compositeKey,
      String(cfg.windowMs)
    )) as [unknown, unknown];
    const count = Number(respuesta?.[0]) || 0;
    const ttl = Number(respuesta?.[1]) || cfg.windowMs;
    const allowed = count <= cfg.max;
    return {
      allowed,
      remaining: allowed ? cfg.max - count : 0,
      resetIn: ttl,
    };
  } catch (error) {
    ultimoFalloRedisMs = Date.now();
    avisarLimitado("Fallo usando Redis para rate limiting, se usa memoria", {
      message: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}

export async function hit(
  key: string,
  cfg: BucketKeyConfig,
  context?: RateLimitContext
): Promise<HitResult> {
  const compositeKey = buildKey(key, context);
  const viaRedis = await intentarEnRedis(compositeKey, cfg);
  if (viaRedis) return viaRedis;

  const now = getCurrentTimestamp();
  const current = memoryStore.get(compositeKey);
  if (!current || current.expiresAt <= now) {
    memoryStore.set(compositeKey, {
      count: 1,
      expiresAt: now + cfg.windowMs,
    });
    return {
      allowed: true,
      remaining: cfg.max - 1,
      resetIn: cfg.windowMs,
    };
  }
  if (current.count >= cfg.max) {
    return {
      allowed: false,
      remaining: 0,
      resetIn: Math.max(0, current.expiresAt - now),
    };
  }
  current.count += 1;
  return {
    allowed: true,
    remaining: Math.max(0, cfg.max - current.count),
    resetIn: Math.max(0, current.expiresAt - now),
  };
}

setInterval(() => {
  const now = getCurrentTimestamp();
  for (const [key, entry] of memoryStore) {
    if (entry.expiresAt <= now) {
      memoryStore.delete(key);
    }
  }
}, 60_000).unref?.();
