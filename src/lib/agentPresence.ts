import { obtenerRedis } from "@/lib/redis";
import { readAppSettings } from "@/lib/appSettings";

/**
 * Presencia del agente en Redis: una clave por equipo que el latido
 * (GET /api/agent/ping) refresca en cada señal y que expira sola
 * cuando el agente deja de llamar.
 *
 * La expiración ES el umbral de silencio del método 3
 * (silenceThresholdMinutes, mínimo 2 min): si la clave existe, el
 * equipo ha dado señal dentro del umbral; si no existe, o no ha dado
 * señal o Redis no guarda nada de él.
 *
 * Es un dato prescindible y una señal ADICIONAL: PostgreSQL sigue
 * guardando lastSeen y Equipos lo usa como respaldo, así que un
 * Redis vacío o reiniciado nunca marca como apagado un equipo que
 * está dando señales (las claves se reescriben en el siguiente
 * latido, ≤30 s). Ninguna función de este módulo lanza: sin Redis,
 * refrescar no hace nada y leer devuelve null.
 */

const PREFIJO_CLAVE = "presencia:agente:";

export function clavePresencia(computerId: string): string {
  return PREFIJO_CLAVE + computerId;
}

/** TTL de la presencia: el umbral vigente, con el mismo suelo de 2 min que aplica Equipos. */
export function ttlPresenciaMs(silenceThresholdMinutes: number): number {
  return Math.max(2, silenceThresholdMinutes || 5) * 60_000;
}

export async function refrescarPresencia(computerId: string): Promise<void> {
  try {
    const redis = await obtenerRedis();
    if (!redis) return;
    const settings = await readAppSettings();
    await redis.set(
      clavePresencia(computerId),
      new Date().toISOString(),
      "PX",
      ttlPresenciaMs(settings.silenceThresholdMinutes),
    );
  } catch {
    // Presencia prescindible: el lastSeen de la BD ya se guardó.
  }
}

/**
 * Lee la presencia de varios equipos de una vez.
 * Devuelve null si Redis no está disponible (el llamador decide con
 * su respaldo de siempre) y un mapa id → presente si Redis respondió.
 */
export async function leerPresencias(
  computerIds: string[],
): Promise<Map<string, boolean> | null> {
  if (!computerIds.length) return new Map();
  try {
    const redis = await obtenerRedis();
    if (!redis) return null;
    const pipeline = redis.pipeline();
    for (const id of computerIds) pipeline.exists(clavePresencia(id));
    const resultados = await pipeline.exec();
    if (!resultados) return null;
    const mapa = new Map<string, boolean>();
    computerIds.forEach((id, i) => {
      const [error, valor] = resultados[i] ?? [];
      mapa.set(id, !error && Number(valor) === 1);
    });
    return mapa;
  } catch {
    return null;
  }
}
