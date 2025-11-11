import { getCurrentTimestamp } from "@/lib/time";

// Rate limiting simple en memoria (IP + clave compuesta) para despliegue single-instance.
// En producción multi-nodo usar Redis.

interface BucketKeyConfig {
  windowMs: number; // ventana en ms
  max: number; // máximo eventos en ventana
}

interface Entry {
  count: number;
  expiresAt: number;
}

const store = new Map<string, Entry>();

export function hit(
  key: string,
  cfg: BucketKeyConfig
): { allowed: boolean; remaining: number; resetIn: number } {
  const k = `${key}`;
  const current = store.get(k);
  const t = getCurrentTimestamp();
  if (!current || current.expiresAt <= t) {
    const expiresAt = t + cfg.windowMs;
    store.set(k, { count: 1, expiresAt });
    return { allowed: true, remaining: cfg.max - 1, resetIn: cfg.windowMs };
  }
  if (current.count >= cfg.max) {
    return { allowed: false, remaining: 0, resetIn: current.expiresAt - t };
  }
  current.count++;
  return {
    allowed: true,
    remaining: cfg.max - current.count,
    resetIn: current.expiresAt - t,
  };
}

export function cleanup() {
  const t = getCurrentTimestamp();
  for (const [k, v] of store) {
    if (v.expiresAt <= t) store.delete(k);
  }
}

setInterval(cleanup, 60_000).unref?.();
