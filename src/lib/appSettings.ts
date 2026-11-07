import { promises as fs } from "fs";
import path from "path";
import { obtenerRedis } from "@/lib/redis";

/**
 * Lectura server-side de config/app_settings.json (el mismo archivo que
 * expone /api/settings). Centraliza los ajustes que afectan al flujo de
 * desbloqueo por contraseña y al método 3, con valores por defecto que
 * mantienen el comportamiento si el archivo no existe.
 *
 * Caché en Redis (opcional): el contenido del archivo se guarda en
 * Redis para no leer el disco en cada petición. La fuente de verdad
 * sigue siendo el archivo: POST /api/settings invalida la caché al
 * guardar (invalidarCacheAjustes) y la entrada caduca sola al minuto
 * como red de seguridad, por si el archivo cambia por otra vía. Sin
 * Redis disponible, se lee el disco exactamente como antes.
 */
export interface AppSettings {
  /** Fase 3: exigir token por equipo en la ingesta de eventos. */
  requireAgentToken: boolean;
  /** Fase 5: interruptor general del desbloqueo por contraseña. */
  passwordUnlockEnabled: boolean;
  /** Fase 4/5: permitir la emergencia sin red con hash local. */
  offlineEmergencyEnabled: boolean;
  /** Fase 5: bloquear la sesión de Windows al insertar un USB. */
  lockSessionOnInsert: boolean;
  /**
   * Apagar el equipo cliente cuando se inserta un dispositivo que
   * NO está en la lista blanca (cuenta atrás cancelable del agente).
   */
  shutdownOnNonWhitelisted: boolean;
  /** Segundos de cuenta atrás antes del apagado (10–600). */
  shutdownCountdownSeconds: number;
  /**
   * Captura de evidencia al bloquear un dispositivo que NO está en
   * la lista blanca: foto del momento (captura de pantalla, ventana
   * en primer plano, procesos y pestañas del navegador) que queda
   * guardada en el panel junto al bloqueo. Apagado por defecto.
   */
  captureEvidenceOnNonWhitelisted: boolean;
  /** Fase 5 (método 3): minutos sin señales para marcar un equipo. */
  silenceThresholdMinutes: number;
  [key: string]: unknown;
}

export const DEFAULT_SETTINGS: AppSettings = {
  requireAgentToken: false,
  passwordUnlockEnabled: true,
  offlineEmergencyEnabled: true,
  lockSessionOnInsert: false,
  shutdownOnNonWhitelisted: false,
  shutdownCountdownSeconds: 60,
  captureEvidenceOnNonWhitelisted: false,
  silenceThresholdMinutes: 5,
};

const SETTINGS_PATH = path.join(process.cwd(), "config", "app_settings.json");

const CLAVE_CACHE_AJUSTES = "ajustes:app";
// Red de seguridad ante cambios del archivo por fuera del panel; la
// invalidación normal es inmediata, al guardar desde /api/settings.
const TTL_CACHE_AJUSTES_MS = 60_000;

async function leerAjustesDeDisco(): Promise<Record<string, unknown>> {
  try {
    const raw = await fs.readFile(SETTINGS_PATH, "utf-8");
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

export async function readAppSettings(): Promise<AppSettings> {
  const redis = await obtenerRedis().catch(() => null);
  if (redis) {
    try {
      const enCache = await redis.get(CLAVE_CACHE_AJUSTES);
      if (enCache) {
        const parsed = JSON.parse(enCache);
        if (parsed && typeof parsed === "object") {
          return { ...DEFAULT_SETTINGS, ...parsed };
        }
      }
    } catch {
      // Caché ilegible o Redis caído a mitad: se sigue con el disco.
    }
  }

  const desdeDisco = await leerAjustesDeDisco();

  if (redis) {
    try {
      await redis.set(
        CLAVE_CACHE_AJUSTES,
        JSON.stringify(desdeDisco),
        "PX",
        TTL_CACHE_AJUSTES_MS,
      );
    } catch {
      // Sin caché esta vez; la siguiente lectura reintenta.
    }
  }

  return { ...DEFAULT_SETTINGS, ...desdeDisco };
}

/** Borra la caché de ajustes. Lo llama POST /api/settings tras guardar el archivo. Nunca lanza. */
export async function invalidarCacheAjustes(): Promise<void> {
  try {
    const redis = await obtenerRedis();
    if (redis) await redis.del(CLAVE_CACHE_AJUSTES);
  } catch {
    // La entrada caduca sola al minuto (TTL_CACHE_AJUSTES_MS).
  }
}
