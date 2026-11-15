import { createInterface } from "node:readline/promises";

import { db } from "@/lib/db";

/*
  vaciarDatos script — Vacía las tablas de datos del panel
  conservando las cuentas (User) y la lista blanca
  (USBWhitelist): equipos, eventos, conexiones, bloqueos,
  intentos, órdenes del agente, tareas de instalación y
  evidencias se borran enteros.

  Forma de uso:
    npm run db:vaciar
  Primero enseña el resumen — cuántas cuentas y cuántas
  entradas de la lista blanca se conservan, y cuántas filas
  caerían por tabla — y después pregunta: para borrar hay
  que escribir VACIAR y dar Enter. Cualquier otra respuesta
  (o cerrar sin escribir) no borra nada. La confirmación es
  tecleada a propósito: la versión anterior pedía una marca
  en el comando y esa marca no siempre llegaba al script.

  Avisos honestos:
  - NO hay deshacer: haz una copia de la base antes si los
    datos te importan algo.
  - Los usuarios pierden el equipo asignado: sin equipos, la
    asignación no puede seguir apuntando a ninguno (la cuenta
    en sí — nombre, clave, rol — no se toca). La lista blanca
    sí se queda entera, con su «creada por» incluido.
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
  { nombre: "Bloqueos", contar: () => db.pendingUnlock.count(), borrar: () => db.pendingUnlock.deleteMany() },
  { nombre: "Intentos de desbloqueo", contar: () => db.unlockAttempt.count(), borrar: () => db.unlockAttempt.deleteMany() },
  { nombre: "Órdenes del agente", contar: () => db.agentCommand.count(), borrar: () => db.agentCommand.deleteMany() },
  { nombre: "Tareas de instalación", contar: () => db.installTask.count(), borrar: () => db.installTask.deleteMany() },
  { nombre: "Destinos de instalación", contar: () => db.installTaskTarget.count(), borrar: () => db.installTaskTarget.deleteMany() },
  { nombre: "Evidencias de bloqueo", contar: () => db.blockEvidence.count(), borrar: () => db.blockEvidence.deleteMany() },
] as const;

async function main() {
  // El resumen primero: lo que se conserva y lo que se va.
  const usuarios = await db.user.count();
  const listaBlanca = await db.uSBWhitelist.count();
  console.log(`Cuentas que se CONSERVAN (tabla de usuarios): ${usuarios}`);
  console.log(`Entradas que se CONSERVAN (lista blanca): ${listaBlanca}`);
  console.log("Filas que se borran:");
  let total = 0;
  for (const tabla of TABLAS) {
    const filas = await tabla.contar();
    total += filas;
    console.log(`  ${tabla.nombre}: ${filas}`);
  }
  console.log(`  TOTAL: ${total}`);

  // La confirmación tecleada: sin VACIAR en mayúsculas, nada.
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  let respuesta = "";
  try {
    respuesta = await rl.question(
      "\nPara borrar todo eso, escribe VACIAR y pulsa Enter: ",
    );
  } catch {
    // Entrada cerrada sin respuesta (Ctrl+C, tubería cortada…):
    // se trata como un «no», que es el lado seguro.
    respuesta = "";
  } finally {
    rl.close();
  }
  if (respuesta.trim() !== "VACIAR") {
    console.log("No se ha borrado nada.");
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

  const quedanUsuarios = await db.user.count();
  const quedaLista = await db.uSBWhitelist.count();
  console.log(
    `\nHecho. Se conservan ${quedanUsuarios} usuarios y ${quedaLista} entradas de la lista blanca; el resto quedó vacío.`,
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
