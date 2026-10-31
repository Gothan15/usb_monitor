import { promises as fs } from "fs";
import path from "path";

/**
 * Lectura server-side de config/app_settings.json (el mismo archivo que
 * expone /api/settings). Centraliza los ajustes que afectan al flujo de
 * desbloqueo por contraseña y al método 3, con valores por defecto que
 * mantienen el comportamiento si el archivo no existe.
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
  /** Fase 5 (método 3): minutos sin señales para marcar un equipo. */
  silenceThresholdMinutes: number;
  [key: string]: unknown;
}

export const DEFAULT_SETTINGS: AppSettings = {
  requireAgentToken: false,
  passwordUnlockEnabled: true,
  offlineEmergencyEnabled: true,
  lockSessionOnInsert: false,
  silenceThresholdMinutes: 5,
};

const SETTINGS_PATH = path.join(process.cwd(), "config", "app_settings.json");

export async function readAppSettings(): Promise<AppSettings> {
  try {
    const raw = await fs.readFile(SETTINGS_PATH, "utf-8");
    const parsed = JSON.parse(raw);
    return { ...DEFAULT_SETTINGS, ...parsed };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}
