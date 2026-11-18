export interface USBEvent {
  id: string;
  pcName: string;
  pcIp: string;
  pcUser: string;
  /** Cuenta que autorizó el desbloqueo (solo en eventos de desbloqueo). */
  unlockedBy?: string | null;
  event: string;
  driveLetter?: string | null;
  serialNumber?: string | null;
  readonlyStatus?: string | null;
  whitelisted?: boolean;
  timestamp: string;
  createdAt: string;
}

export interface Computer {
  id: string;
  name: string;
  ipAddress: string;
  lastSeen: string | null;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
  serviceInstalled?: boolean;
  serviceRunning?: boolean;
  lastServiceCheck?: string | null;
  /** Versión que el agente anuncia en su ping (null si aún no la ha dado). */
  agentVersion?: string | null;
  /** Versión del paquete que sirve el panel, si hay paquete. */
  versionPaquete?: string | null;
  /** El agente va por detrás del paquete: hay actualización. */
  actualizacionDisponible?: boolean;
  /** USB conectados ahora mismo (misma frescura que la hoja de «Ver USB»). */
  usbConectados?: number;
  /** Hay una cuenta atrás de apagado corriendo en el equipo. */
  apagadoEnCurso?: boolean;
  /** Hay una orden «reiniciar» viva para este equipo: el botón enseña su ruleta. */
  reinicioEnCurso?: boolean;
  /** Última vez que el agente pidió su configuración al panel. */
  lastConfigAt?: string | null;
}

export interface WhitelistEntry {
  id: string;
  serialNumber: string;
  label: string | null;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
  createdBy?: {
    id: string;
    username: string;
  } | null;
}
export {
  DEFAULT_TIME_ZONE,
  formatDate,
  formatDateTime,
  formatHour,
  formatTime,
} from "@/lib/time";

// Dispositivos USB para el panel admin
export type HistoryRange = 1 | 7 | 30;

export interface ConnectedUSBDevice {
  id: string;
  pcName: string;
  driveLetter: string | null;
  volumeName: string;
  serialNumber: string;
  model: string;
  deviceKind: string;
  size: number;
  connectedAt: string;
  lastSeen: string;
  isConnected: true;
  isWhitelisted: boolean;
}

export interface DisconnectedUSBDevice {
  id: string;
  pcName: string;
  driveLetter: string | null;
  volumeName: string;
  serialNumber: string;
  model: string;
  deviceKind: string;
  size: number;
  connectedAt: string;
  disconnectedAt: string | null;
  lastSeen: string;
  isConnected: false;
  isWhitelisted: boolean;
}

export function formatDuration(startIso: string, endIso: string): string {
  const start = new Date(startIso).getTime();
  const end = new Date(endIso).getTime();
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) {
    return "—";
  }
  let diff = Math.floor((end - start) / 1000);
  const days = Math.floor(diff / 86400);
  diff -= days * 86400;
  const hours = Math.floor(diff / 3600);
  diff -= hours * 3600;
  const minutes = Math.floor(diff / 60);
  const parts: string[] = [];
  if (days) parts.push(`${days}d`);
  if (hours) parts.push(`${hours}h`);
  parts.push(`${minutes}m`);
  return parts.join(" ");
}

/** «hace 40 s», «hace 5 min», «hace 2 h», «hace 3 d» para una fecha ISO. */
export function haceCuanto(iso: string | null | undefined): string {
  if (!iso) return "nunca";
  const segundos = Math.max(
    0,
    Math.floor((Date.now() - new Date(iso).getTime()) / 1000),
  );
  if (segundos < 60) return `hace ${segundos} s`;
  const minutos = Math.floor(segundos / 60);
  if (minutos < 60) return `hace ${minutos} min`;
  const horas = Math.floor(minutos / 60);
  if (horas < 24) return `hace ${horas} h`;
  return `hace ${Math.floor(horas / 24)} d`;
}
