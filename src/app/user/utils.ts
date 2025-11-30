import type {
  AssignedComputer,
  BasicUserSnapshot,
  UsbConnection,
  UsbEvent,
} from "./types";

const ensureString = (value: unknown): string =>
  typeof value === "string" ? value : String(value ?? "");

const ensureNumber = (value: unknown): number => {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "bigint") {
    return Number(value);
  }
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
};

const ensureIsoString = (value: unknown): string => {
  if (typeof value === "string" && value.trim()) {
    const date = new Date(value);
    return Number.isNaN(date.getTime())
      ? new Date().toISOString()
      : date.toISOString();
  }
  if (value instanceof Date) {
    return Number.isNaN(value.getTime())
      ? new Date().toISOString()
      : value.toISOString();
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    const date = new Date(value);
    return Number.isNaN(date.getTime())
      ? new Date().toISOString()
      : date.toISOString();
  }
  return new Date().toISOString();
};

const normalizeConnection = (payload: any): UsbConnection => ({
  id: ensureString(
    payload?.id ||
      `${payload?.pcName ?? "pc"}-${payload?.driveLetter ?? "drive"}-${
        payload?.connectedAt ?? Date.now()
      }`
  ),
  pcName: ensureString(payload?.pcName || "—"),
  driveLetter: ensureString(payload?.driveLetter || "—"),
  volumeName: ensureString(payload?.volumeName || "Sin nombre"),
  serialNumber: ensureString(payload?.serialNumber || "—"),
  model: ensureString(payload?.model || "Desconocido"),
  size: ensureNumber(payload?.size),
  connectedAt: ensureIsoString(payload?.connectedAt),
  disconnectedAt: payload?.disconnectedAt
    ? ensureIsoString(payload.disconnectedAt)
    : null,
  lastSeen: ensureIsoString(payload?.lastSeen ?? payload?.connectedAt),
  isConnected: Boolean(payload?.isConnected),
});

const normalizeEvent = (payload: any): UsbEvent => ({
  id: ensureString(
    payload?.id ||
      `${payload?.pcName ?? "pc"}-${payload?.createdAt ?? Date.now()}`
  ),
  pcName: ensureString(payload?.pcName || "—"),
  pcIp: ensureString(payload?.pcIp || "—"),
  pcUser: ensureString(payload?.pcUser || "—"),
  message: ensureString(payload?.event || payload?.message || "Evento USB"),
  driveLetter: payload?.driveLetter ? ensureString(payload.driveLetter) : null,
  serialNumber: payload?.serialNumber
    ? ensureString(payload.serialNumber)
    : null,
  readonlyStatus: payload?.readonlyStatus
    ? ensureString(payload.readonlyStatus)
    : null,
  whitelisted: Boolean(payload?.whitelisted),
  createdAt: ensureIsoString(payload?.createdAt ?? payload?.timestamp),
});

const normalizeComputer = (payload: any): AssignedComputer | null => {
  if (!payload) {
    return null;
  }
  return {
    id: ensureString(payload.id || ""),
    name: ensureString(payload.name || "—"),
    ipAddress: ensureString(payload.ipAddress || "N/D"),
    isActive: Boolean(payload.isActive),
    serviceRunning: Boolean(payload.serviceRunning),
    lastSeen: payload?.lastSeen ? ensureIsoString(payload.lastSeen) : null,
  };
};

export const fetchBasicUserSnapshot = async (
  userId: string,
  signal?: AbortSignal
): Promise<BasicUserSnapshot> => {
  const query = userId ? `?userId=${encodeURIComponent(userId)}` : "";
  const response = await fetch(`/api/usb-event/user-devices${query}`, {
    cache: "no-store",
    credentials: "include",
    signal,
  });

  if (!response.ok) {
    const message = `Error ${response.status} al obtener datos`;
    throw new Error(message);
  }

  const data = await response.json();
  if (!data?.ok) {
    throw new Error(
      data?.error?.message ||
        data?.error ||
        "El servidor no devolvió información válida."
    );
  }

  return {
    computer: normalizeComputer(data.computer),
    connectedUSBs: Array.isArray(data.connectedUSBs)
      ? data.connectedUSBs.map(normalizeConnection)
      : [],
    usbHistory: Array.isArray(data.usbHistory)
      ? data.usbHistory.map(normalizeConnection)
      : [],
    events: Array.isArray(data.events) ? data.events.map(normalizeEvent) : [],
    apiKey: typeof data.apiKey === "string" ? data.apiKey : "",
    warnings: Array.isArray(data.warnings)
      ? data.warnings.map((item: unknown) => ensureString(item))
      : undefined,
  };
};

export const formatBytes = (bytes: number): string => {
  if (!Number.isFinite(bytes) || bytes <= 0) {
    return "0 B";
  }
  const units = ["B", "KB", "MB", "GB", "TB"];
  const exponent = Math.min(
    Math.floor(Math.log(bytes) / Math.log(1024)),
    units.length - 1
  );
  const value = bytes / Math.pow(1024, exponent);
  return `${value.toFixed(value >= 10 || value % 1 === 0 ? 0 : 1)} ${
    units[exponent]
  }`;
};
