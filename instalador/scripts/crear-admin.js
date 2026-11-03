// ================================================================
// USB Monitor — Panel · creación del administrador inicial
// ----------------------------------------------------------------
// Lo ejecuta Configurar-Panel.ps1 con el Node integrado, DESDE la
// carpeta de la aplicación (Construir-Instalador.ps1 lo copia ahí
// como «crear-admin-instalador.mjs» para que resuelva los módulos
// del propio panel: pg y argon2).
//
// Desde Prisma 7 el script ya no usa el cliente de Prisma: el del
// panel se genera como código TypeScript en src/generated (un .mjs
// suelto no puede importarlo) y además exige un adaptador de
// driver. Las dos operaciones que necesita —contar administradores
// y crear uno— van en SQL directo con «pg», que el panel ya trae
// como dependencia del adaptador oficial.
//
// Variables de entorno que consume:
//   DATABASE_URL     la del panel (la pone el script llamante)
//   INST_ADMIN_USER  usuario elegido en el asistente
//   INST_ADMIN_PASS  su contraseña (no se imprime jamás)
//
// Idempotente: si ya existe CUALQUIER administrador, no hace nada
// (así una actualización nunca resetea cuentas). El hash replica
// EXACTAMENTE el formato de src/lib/auth.ts del panel:
// «argon2id$» + hash Argon2id (timeCost 2, memoryCost 19456,
// parallelism 1, hashLength 64) y la apiKey «uk_» + 24 bytes en
// base64url, igual que generateApiKey(). El id replica la forma
// de un cuid() (25 caracteres, empieza por «c»), que es el que
// Prisma generaba en el cliente.
// ================================================================
import { Client } from "pg";
import argon2 from "argon2";
import { randomBytes } from "node:crypto";

const usuario = process.env.INST_ADMIN_USER;
const clave = process.env.INST_ADMIN_PASS;

if (!usuario || !clave) {
  console.log("ADMIN_OMITIDO: faltan INST_ADMIN_USER o INST_ADMIN_PASS");
  process.exit(0);
}

const db = new Client({ connectionString: process.env.DATABASE_URL });
await db.connect();
try {
  // Ojo: el enum Role del esquema mapea a minúsculas en la base
  // de datos (ADMIN @map("admin")); en SQL hay que usar «admin».
  const { rows } = await db.query(
    'SELECT COUNT(*)::int AS n FROM "User" WHERE role = $1',
    ["admin"]
  );
  if (rows[0].n > 0) {
    console.log("ADMIN_OMITIDO: ya existe un administrador");
  } else {
    const hash = await argon2.hash(clave, {
      type: argon2.argon2id,
      timeCost: 2,
      memoryCost: 19456,
      parallelism: 1,
      hashLength: 64,
    });
    const id =
      "c" +
      Date.now().toString(36) +
      randomBytes(12).toString("hex").slice(0, 16);
    await db.query(
      'INSERT INTO "User" (id, username, "passwordHash", "apiKey", role, "createdAt", "updatedAt", "failedAttempts") ' +
        "VALUES ($1, $2, $3, $4, $5, NOW(), NOW(), 0)",
      [id, usuario, `argon2id$${hash}`, `uk_${randomBytes(24).toString("base64url")}`, "admin"]
    );
    console.log(`ADMIN_CREADO: ${usuario}`);
  }
} finally {
  await db.end();
}
