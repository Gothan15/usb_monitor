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
