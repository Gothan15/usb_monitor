import { PrismaClient } from "@prisma/client";

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

export const db =
  globalForPrisma.prisma ??
  new PrismaClient({
    // Eliminar logs de query para no ensuciar salida de scripts
    log: process.env.PRISMA_DEBUG === "1" ? ["query"] : [],
  });

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = db;

const denyRawSql = (..._args: unknown[]) => {
  throw new Error(
    "Raw SQL execution is disabled. Use the Prisma query builder instead."
  );
};

Object.assign(db as unknown as Record<string, unknown>, {
  $queryRaw: denyRawSql,
  $queryRawUnsafe: denyRawSql,
  $executeRaw: denyRawSql,
  $executeRawUnsafe: denyRawSql,
});
