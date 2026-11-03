import "dotenv/config";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@/generated/prisma/client";

// Prisma 7: el cliente exige un adaptador de driver; el de Postgres
// oficial usa `pg` por debajo y la URL sale del .env como siempre.
export function createPrismaClient() {
  const adapter = new PrismaPg({
    connectionString: process.env.DATABASE_URL,
  });
  return new PrismaClient({
    adapter,
    // Eliminar logs de query para no ensuciar salida de scripts
    log: process.env.PRISMA_DEBUG === "1" ? ["query"] : [],
  });
}

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

export const db = globalForPrisma.prisma ?? createPrismaClient();

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
