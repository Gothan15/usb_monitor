export interface BasicUserSnapshot {
  computer: AssignedComputer | null;
  connectedUSBs: UsbConnection[];
  usbHistory: UsbConnection[];
  events: UsbEvent[];
  apiKey: string;
  warnings?: string[];
}

export interface AssignedComputer {
  id: string;
  name: string;
  ipAddress: string;
  isActive: boolean;
  serviceRunning: boolean;
  lastSeen: string | null;
}

export interface UsbConnection {
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
  isConnected: boolean;
}

export interface UsbEvent {
  id: string;
  pcName: string;
  pcIp: string;
  pcUser: string;
  message: string;
  driveLetter: string | null;
  serialNumber: string | null;
  readonlyStatus: string | null;
  whitelisted: boolean;
  createdAt: string;
}

export interface ApiKeyPayload {
  apiKey: string;
}
