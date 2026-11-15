import { db } from "@/lib/db";

/*
  vaciarDatos script — Vacía TODAS las tablas del panel menos
  la de usuarios: equipos, eventos, conexiones, lista blanca,
  bloqueos, intentos, órdenes del agente, tareas de
  instalación y evidencias se borran enteros; las cuentas
  (User) se quedan tal cual.

  Formas de uso:
    Ver qué se borraría, sin tocar nada (modo de prueba):
      npm run db:vaciar
    Borrar de verdad:
      npm run db:vaciar -- --confirmar

  Avisos honestos:
  - NO hay deshacer: haz una copia de la base antes si los
    datos te importan algo.
  - Los usuarios pierden el equipo asignado: sin equipos, la
    asignación no puede seguir apuntando a ninguno (la cuenta
    en sí — nombre, clave, rol — no se toca).
  - Los agentes de las PC se quedan con su credencial
    huérfana: al no existir ya su equipo en el panel, tendrán
    que enrolarse de nuevo, como equipos nuevos.
  - Corre esto con el panel PARADO: si está en marcha, los
    agentes que sigan vivos volverán a crear su equipo y a
    reportar eventos sobre la base recién vaciada.
*/

// Cada tabla a vaciar, con su conteo y su borrado. El orden de
// la lista da igual: primero se sueltan los usuarios de sus
// equipos y ninguna tabla guarda un id obligatorio de otra
// que siga llena cuando le toca (las referencias entre las
// demás son anulables o caen en cascada dentro del grupo).
const TABLAS = [
  { nombre: "Equipos", contar: () => db.computer.count(), borrar: () => db.computer.deleteMany() },
  { nombre: "Eventos USB", contar: () => db.uSBEvent.count(), borrar: () => db.uSBEvent.deleteMany() },
  { nombre: "Conexiones USB", contar: () => db.uSBConnection.count(), borrar: () => db.uSBConnection.deleteMany() },
  { nombre: "Lista blanca", contar: () => db.uSBWhitelist.count(), borrar: () => db.uSBWhitelist.deleteMany() },
  { nombre: "Bloqueos", contar: () => db.pendingUnlock.count(), borrar: () => db.pendingUnlock.deleteMany() },
  { nombre: "Intentos de desbloqueo", contar: () => db.unlockAttempt.count(), borrar: () => db.unlockAttempt.deleteMany() },
  { nombre: "Órdenes del agente", contar: () => db.agentCommand.count(), borrar: () => db.agentCommand.deleteMany() },
  { nombre: "Tareas de instalación", contar: () => db.installTask.count(), borrar: () => db.installTask.deleteMany() },
  { nombre: "Destinos de instalación", contar: () => db.installTaskTarget.count(), borrar: () => db.installTaskTarget.deleteMany() },
  { nombre: "Evidencias de bloqueo", contar: () => db.blockEvidence.count(), borrar: () => db.blockEvidence.deleteMany() },
] as const;

async function main() {
  const confirmar = process.argv.slice(2).includes("--confirmar");

  // El resumen primero: cuántas cuentas se quedan y cuántas
  // filas se van por tabla. Sirve igual para el modo de prueba
  // y para dejar constancia en el modo de verdad.
  const usuarios = await db.user.count();
  console.log(`Cuentas que se CONSERVAN (tabla de usuarios): ${usuarios}`);
  console.log("Filas que se borran:");
  let total = 0;
  for (const tabla of TABLAS) {
    const filas = await tabla.contar();
    total += filas;
    console.log(`  ${tabla.nombre}: ${filas}`);
  }
  console.log(`  TOTAL: ${total}`);

  if (!confirmar) {
    console.log(
      "\nEsto ha sido solo el resumen: no se ha borrado nada.\n" +
        "Para vaciar de verdad: npm run db:vaciar -- --confirmar",
    );
    return;
  }

  // Primero, los usuarios se quedan sin equipo asignado: los
  // equipos van a desaparecer y la asignación no puede apuntar
  // a un equipo que ya no existe.
  const desasignados = await db.user.updateMany({
    data: { computerId: null },
  });
  if (desasignados.count > 0) {
    console.log(
      `\nUsuarios que pierden su equipo asignado: ${desasignados.count}`,
    );
  }

  // El vaciado, tabla a tabla, contando lo borrado en cada una.
  console.log("\nBorrando…");
  for (const tabla of TABLAS) {
    const { count } = await tabla.borrar();
    console.log(`  ${tabla.nombre}: ${count} filas borradas`);
  }

  const quedan = await db.user.count();
  console.log(
    `\nHecho. La base queda vacía salvo las cuentas: ${quedan} usuarios.`,
  );
}

main()
  .catch((error) => {
    console.error("No se pudo vaciar la base de datos:", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await db.$disconnect();
  });
