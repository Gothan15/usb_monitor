// Servicio de ajustes: la configuración del panel, el estado
// del sistema y el paquete del agente que maneja la pestaña
// Ajustes. Los tipos son el contrato de esas rutas.

import { lecturaJson, mutacionFormulario, mutacionJson } from "@/lib/http";

/** El paquete del agente colocado en el panel. */
export interface EstadoPaquete {
  version: string | null;
  sha256: string | null;
  agente: { presente: boolean; tamano: number };
  empujador: { presente: boolean; tamano: number };
  /** Versión más nueva que ya corre en algún equipo. */
  versionFlotaMaxima?: string | null;
  /** Algún equipo va por delante del paquete colocado. */
  desfasado?: boolean;
}

/** El parte de salud del propio panel. */
export interface EstadoSistema {
  bd: string;
  redis: string;
  disco: { libre: number; total: number } | null;
  nodeVersion: string;
  encendidoDesde: string;
  paquete: { version: string | null } | null;
}

/**
 * Lee los ajustes guardados. El objeto es de forma libre a
 * propósito: el panel funde lo guardado sobre los valores por
 * defecto sin lista cerrada de claves, y cada sección de la
 * pestaña recoge las suyas.
 */
export function leer(): Promise<Record<string, any>> {
  return lecturaJson<Record<string, any>>("/api/settings");
}

/** Guarda un ajuste o un grupo de ajustes. */
export function guardar(payload: Record<string, unknown>) {
  return mutacionJson<{ ok: boolean }>("/api/settings", "POST", payload);
}

/**
 * El estado del sistema. Devuelve null si el panel no
 * responde: la sección enseña «sin datos».
 */
export async function sistema(): Promise<EstadoSistema | null> {
  try {
    const datos = await lecturaJson<EstadoSistema & { ok: boolean }>(
      "/api/admin/sistema",
    );
    return datos?.ok ? datos : null;
  } catch {
    return null;
  }
}

/**
 * El estado del paquete del agente, ya compuesto. Devuelve
 * null si la lectura falla.
 */
export async function estadoPaquete(): Promise<EstadoPaquete | null> {
  try {
    const data = await lecturaJson<{
      ok: boolean;
      version?: string | null;
      sha256?: string | null;
      agente?: { presente: boolean; tamano: number };
      empujador?: { presente: boolean; tamano: number };
      versionFlotaMaxima?: string | null;
      desfasado?: boolean;
    }>("/api/admin/agent-package");
    if (!data?.ok) return null;
    return {
      version: data.version ?? null,
      sha256: data.sha256 ?? null,
      agente: data.agente ?? { presente: false, tamano: 0 },
      empujador: data.empujador ?? { presente: false, tamano: 0 },
      versionFlotaMaxima: data.versionFlotaMaxima ?? null,
      desfasado: Boolean(data.desfasado),
    };
  } catch {
    return null;
  }
}

/** Sube el paquete del agente (el zip de la Release) al panel. */
export function subirPaquete(formulario: FormData) {
  return mutacionFormulario<{
    ok: boolean;
    estado: EstadoPaquete;
    avisos?: string[];
  }>("/api/admin/agent-package", formulario);
}
