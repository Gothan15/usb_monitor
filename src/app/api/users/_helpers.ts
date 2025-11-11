import { Prisma } from "@prisma/client";

export function sanitizeUsername(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (trimmed.length > 64) return trimmed.slice(0, 64);
  return trimmed;
}

export function sanitizePassword(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (trimmed.length > 128) return trimmed.slice(0, 128);
  return trimmed;
}

export function normalizeIpAddress(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (trimmed.length > 64) return trimmed.slice(0, 64);
  return trimmed;
}

export function buildUserSearchFilter(
  search: string | null
): Prisma.UserWhereInput {
  if (!search) {
    return {};
  }

  return {
    OR: [
      { username: { contains: search, mode: "insensitive" } },
      {
        computer: {
          OR: [
            { name: { contains: search, mode: "insensitive" } },
            { ipAddress: { contains: search, mode: "insensitive" } },
          ],
        },
      },
    ],
  };
}

export function serializeUser(user: any) {
  return {
    id: user.id,
    username: user.username,
    role: user.role,
    apiKey: user.apiKey ?? null,
    computerId: user.computerId ?? null,
    createdAt:
      user.createdAt instanceof Date
        ? user.createdAt.toISOString()
        : user.createdAt,
    updatedAt:
      user.updatedAt instanceof Date
        ? user.updatedAt.toISOString()
        : user.updatedAt,
    computer: user.computer
      ? {
          id: user.computer.id,
          name: user.computer.name,
          ipAddress: user.computer.ipAddress,
        }
      : null,
  };
}
