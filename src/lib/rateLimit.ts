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

const redisUrl = process.env.REDIS_URL || process.env.UPSTASH_REDIS_REST_URL;
const isProduction = process.env.NODE_ENV === "production";

let redisClient: Redis | null = null;
let redisInitAttempted = false;
let warnedAboutInMemory = false;

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
  });
  redisClient.on("error", (error) => {
    logWarn("Error en cliente Redis para rate limiting", {
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

export async function hit(
  key: string,
  cfg: BucketKeyConfig,
  context?: RateLimitContext
): Promise<HitResult> {
  const compositeKey = buildKey(key, context);
  const redis = ensureRedis();
  if (redis) {
    try {
      const status = (redis as unknown as { status?: string }).status;
      if (status !== "ready") {
        await redis.connect();
      }
      const pipeline = redis.multi();
      pipeline.incr(compositeKey);
      pipeline.pttl(compositeKey);
      const results = (await pipeline.exec()) || [];
      const incrResult = results[0]?.[1] ?? 0;
      const ttlResult = results[1]?.[1] ?? -1;
      const count = Number(incrResult) || 0;
      let ttl = Number(ttlResult);
      if (ttl <= 0) {
        await redis.pexpire(compositeKey, cfg.windowMs);
        ttl = cfg.windowMs;
      }
      const allowed = count <= cfg.max;
      return {
        allowed,
        remaining: allowed ? cfg.max - count : 0,
        resetIn: ttl,
      };
    } catch (error) {
      logWarn("Fallo usando Redis para rate limiting, se usa memoria", {
        message: error instanceof Error ? error.message : String(error),
      });
      // continua a fallback en memoria
    }
  }

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
