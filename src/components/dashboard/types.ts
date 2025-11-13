export interface USBEvent {
  id: string;
  pcName: string;
  pcIp: string;
  pcUser: string;
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
  driveLetter: string;
  volumeName: string;
  serialNumber: string;
  model: string;
  size: number;
  connectedAt: string;
  lastSeen: string;
  isConnected: true;
  isWhitelisted: boolean;
}

export interface DisconnectedUSBDevice {
  id: string;
  pcName: string;
  driveLetter: string;
  volumeName: string;
  serialNumber: string;
  model: string;
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
