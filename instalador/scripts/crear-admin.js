// ================================================================
// USB Monitor — Panel · creación del administrador inicial
// ----------------------------------------------------------------
// Lo ejecuta Configurar-Panel.ps1 con el Node integrado, DESDE la
// carpeta de la aplicación (Construir-Instalador.ps1 lo copia ahí
// como «crear-admin-instalador.mjs» para que resuelva los módulos
// del propio panel: @prisma/client y argon2).
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
// base64url, igual que generateApiKey().
// ================================================================
import { PrismaClient } from "@prisma/client";
import argon2 from "argon2";
import { randomBytes } from "node:crypto";

const usuario = process.env.INST_ADMIN_USER;
const clave = process.env.INST_ADMIN_PASS;

if (!usuario || !clave) {
  console.log("ADMIN_OMITIDO: faltan INST_ADMIN_USER o INST_ADMIN_PASS");
  process.exit(0);
}

const prisma = new PrismaClient();
try {
  const yaHayAdmin = await prisma.user.count({ where: { role: "ADMIN" } });
  if (yaHayAdmin > 0) {
    console.log("ADMIN_OMITIDO: ya existe un administrador");
  } else {
    const hash = await argon2.hash(clave, {
      type: argon2.argon2id,
      timeCost: 2,
      memoryCost: 19456,
      parallelism: 1,
      hashLength: 64,
    });
    await prisma.user.create({
      data: {
        username: usuario,
        passwordHash: `argon2id$${hash}`,
        apiKey: "uk_" + randomBytes(24).toString("base64url"),
        role: "ADMIN",
      },
    });
    console.log(`ADMIN_CREADO: ${usuario}`);
  }
} finally {
  await prisma.$disconnect();
}
