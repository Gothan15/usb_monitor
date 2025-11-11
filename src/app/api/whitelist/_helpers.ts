import { requireAdminUser } from "@/lib/admin";

export function normalizeSerial(serial: string): string {
  const collapsed = serial.replace(/\s+/g, "");
  const sanitized = collapsed.replace(/[^0-9a-zA-Z._-]/g, "");
  return sanitized.toUpperCase();
}

export function sanitizeText(value: unknown, max = 120): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  return trimmed.slice(0, max);
}

export function serializeWhitelistEntry(entry: any) {
  return {
    id: entry.id,
    serialNumber: entry.serialNumber,
    label: entry.label ?? null,
    notes: entry.notes ?? null,
    createdAt:
      entry.createdAt instanceof Date
        ? entry.createdAt.toISOString()
        : entry.createdAt,
    updatedAt:
      entry.updatedAt instanceof Date
        ? entry.updatedAt.toISOString()
        : entry.updatedAt,
    createdBy: entry.createdBy
      ? {
          id: entry.createdBy.id,
          username: entry.createdBy.username,
        }
      : null,
  };
}

export { requireAdminUser };
