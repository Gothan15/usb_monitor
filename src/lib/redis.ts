import Redis from "ioredis";
import { logWarn } from "@/lib/logger";

/**
 * Cliente Redis compartido y OPCIONAL para datos prescindibles:
 * la presencia del agente (agentPresence) y la caché de ajustes
 * (appSettings). El límite de peticiones tiene su propio cliente en
 * rateLimit.ts y no se toca.
 *
 * Regla de oro: Redis nunca es imprescindible. Si REDIS_URL no está
 * definida o el servidor no responde, obtenerRedis() devuelve null y
 * cada consumidor sigue con su comportamiento de siempre (base de
 * datos o disco). Ninguna función de este módulo lanza.
 *
 * Solo REDIS_URL (protocolo redis:// o rediss://), igual que en
 * rateLimit: el endpoint REST de Upstash no sirve para ioredis.
 */

let cliente: Redis | null = null;
let ultimoFalloMs = 0;
let ultimoAvisoErrorMs = 0;
const AVISO_ERROR_CADA_MS = 30_000;

// El estado se lee por esta vía porque los tipos de ioredis estrechan
// `status` tras cada llamada y no reflejan los cambios asíncronos de
// la conexión (mismo motivo que el cast de rateLimit.ts).
function estadoCliente(): string {
  if (!cliente) return "end";
  return (cliente as unknown as { status?: string }).status ?? "end";
}

// Tras un fallo de conexión se espera este tiempo antes de reintentar:
// un Redis caído no debe añadir la espera de conexión (2 s) a cada
// petición del panel; con el latido del agente cada 30 s y el uso
// normal del panel, la recuperación se detecta en segundos.
const ESPERA_TRAS_FALLO_MS = 10_000;

export async function obtenerRedis(): Promise<Redis | null> {
  const url = process.env.REDIS_URL;
  if (!url) return null;

  if (!cliente) {
    cliente = new Redis(url, {
      lazyConnect: true,
      maxRetriesPerRequest: 0,
      connectTimeout: 2000,
      // Sin cola fuera de línea: si no hay conexión, el comando falla
      // al momento y el consumidor usa su respaldo, en vez de quedar
      // esperando a que Redis vuelva.
      enableOfflineQueue: false,
    });
    cliente.on("error", (error) => {
      // Con freno: si Redis está caído, ioredis reintenta en
      // segundo plano y emite un error por intento; sin freno el
      // log se llena de la misma línea (pasó con el cliente del
      // rate limiting). El aviso importa una vez, no cien.
      const ahora = Date.now();
      if (ahora - ultimoAvisoErrorMs < AVISO_ERROR_CADA_MS) return;
      ultimoAvisoErrorMs = ahora;
      logWarn("Error en cliente Redis compartido", {
        message: error instanceof Error ? error.message : String(error),
      });
    });
  }

  if (estadoCliente() === "ready") return cliente;
  // Una conexión en curso terminará sola; este llamador usa el
  // respaldo y el siguiente ya encontrará el cliente listo.
  const estado = estadoCliente();
  if (estado === "connecting" || estado === "reconnecting") {
    return null;
  }
  if (Date.now() - ultimoFalloMs < ESPERA_TRAS_FALLO_MS) return null;

  try {
    await cliente.connect();
  } catch {
    ultimoFalloMs = Date.now();
    return null;
  }
  return estadoCliente() === "ready" ? cliente : null;
}
