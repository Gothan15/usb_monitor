// Servicio de desbloqueos: el contrato de `/api/admin/unlocks`
// y de la evidencia, con sus tipos. La pestaña Desbloqueos
// consume estas funciones en vez de montar las peticiones.

import { lecturaJson } from "@/lib/http";

/** Un bloqueo (o desbloqueo) de un dispositivo en un equipo. */
export interface Pending {
  id: string;
  pcName: string;
  driveLetter: string | null;
  serialNumber: string | null;
  deviceLabel: string | null;
  whitelisted: boolean;
  createdAt: string;
  unlockedAt: string | null;
  unlockedBy: { username: string; role: string } | null;
  closedAt?: string | null;
  closeReason?: string | null;
  hasEvidence?: boolean;
}

/** La evidencia capturada de un bloqueo, con su custodia. */
export interface EvidenceData {
  id: string;
  capturedAt: string;
  foregroundProcess: string | null;
  foregroundTitle: string | null;
  processes: { proceso: string; titulo?: string }[];
  browserTabs: { navegador: string; titulo: string; url?: string }[];
  tabsComplete: boolean;
  nota: string | null;
  hasImage: boolean;
  // Custodia de la imagen: huella y registro de vistas.
  imageSha256: string | null;
  viewCount: number;
  lastViewedAt: string | null;
  lastViewedBy: string | null;
}

/** Un intento de desbloqueo registrado. */
export interface Attempt {
  id: string;
  createdAt: string;
  pcName: string;
  usernameTried: string;
  serialNumber: string | null;
  result: string;
  origin: string;
  adminUnlock: boolean;
  user: { username: string; role: string } | null;
}

/** Un equipo en el parte de silencio (sin señal reciente). */
export interface SilenceComputer {
  id: string;
  name: string;
  ipAddress: string;
  lastSeen: string | null;
  silent: boolean;
  silentSince: string | null;
}

/** Todo lo que enseña la pestaña Desbloqueos. */
export interface UnlocksData {
  blockedNow: Pending[];
  activeUnlocked: Pending[];
  history: Pending[];
  attempts: Attempt[];
  silence: {
    thresholdMinutes: number;
    serverLikelyDown: boolean;
    computers: SilenceComputer[];
  };
}

/**
 * Carga la vista de desbloqueos con los filtros dados.
 * Devuelve null si la petición falla: la pestaña conserva los
 * datos anteriores y su red de reintento sigue su curso.
 */
export async function listar(filtros: {
  result?: string;
  pcName?: string;
}): Promise<UnlocksData | null> {
  try {
    const params = new URLSearchParams();
    if (filtros.result) params.set("result", filtros.result);
    if (filtros.pcName) params.set("pcName", filtros.pcName);
    return await lecturaJson<UnlocksData>(
      `/api/admin/unlocks?${params.toString()}`,
    );
  } catch {
    return null;
  }
}

/**
 * Trae la evidencia de un bloqueo. Devuelve null si no hay o
 * si la petición falla: la ventana enseña «sin evidencia».
 */
export async function evidencia(id: string): Promise<EvidenceData | null> {
  try {
    const json = await lecturaJson<{ evidence?: EvidenceData | null }>(
      `/api/admin/evidence/${id}`,
    );
    return json?.evidence ?? null;
  } catch {
    return null;
  }
}
