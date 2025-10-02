/**
 * Script para actualizar usuarios existentes y agregar roles
 * Uso: npx tsx scripts/updateUserRoles.ts
 */

import { db } from "../src/lib/db";

async function main() {
  console.log("Actualizando roles de usuarios...");

  // Obtener todos los usuarios
  const users = await (db as any).user.findMany();

  console.log(`Encontrados ${users.length} usuarios`);

  for (const user of users) {
    // Si el usuario es 'admin', asignar rol admin, sino user
    const role = user.username === "admin" ? "admin" : "user";

    await (db as any).user.update({
      where: { id: user.id },
      data: { role },
    });

    console.log(`Usuario ${user.username} actualizado con rol: ${role}`);
  }

  console.log("✓ Roles actualizados correctamente");
}

main()
  .catch((e) => {
    console.error("Error:", e);
    process.exit(1);
  })
  .finally(async () => {
    await (db as any).$disconnect();
  });
