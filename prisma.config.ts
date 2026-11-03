import "dotenv/config";
import { defineConfig } from "prisma/config";

// Prisma 7: la conexión ya no vive en el schema; vive aquí.
export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
    seed: "tsx prisma/seed.ts",
  },
  datasource: {
    url: process.env.DATABASE_URL as string,
    shadowDatabaseUrl: process.env.SHADOW_DATABASE_URL,
  },
});
