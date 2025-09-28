export interface USBEvent {
  id: string;
  pcName: string;
  pcIp: string;
  pcUser: string;
  event: string;
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

export function formatDateTime(dateString: string) {
  return new Date(dateString).toLocaleString("es-ES", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}
