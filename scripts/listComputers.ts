import { db } from "@/lib/db";

// listComputers
// Lista todas las computadoras en el sistema

async function main() {
  const computers = await (db as any).computer.findMany({
    include: {
      users: {
        select: {
          username: true,
          role: true,
        },
      },
    },
    orderBy: { name: "asc" },
  });

  if (computers.length === 0) {
    console.log("No hay computadoras registradas en el sistema.");
    process.exit(0);
  }

  console.log("\n=== COMPUTADORAS REGISTRADAS ===\n");

  computers.forEach((computer: any) => {
    console.log(`Nombre: ${computer.name}`);
    console.log(`IP: ${computer.ipAddress}`);
    console.log(`Estado: ${computer.isActive ? "Activa" : "Inactiva"}`);
    console.log(
      `Servicio: ${computer.serviceRunning ? "Ejecutándose" : "Detenido"}`
    );
    console.log(
      `Última vez visto: ${
        computer.lastSeen
          ? new Date(computer.lastSeen).toLocaleString("es-ES")
          : "Nunca"
      }`
    );

    if (computer.users.length > 0) {
      console.log(`Usuarios asignados:`);
      computer.users.forEach((user: any) => {
        console.log(`  - ${user.username} (${user.role})`);
      });
    } else {
      console.log("Usuarios asignados: Ninguno");
    }

    console.log("---");
  });

  console.log(`\nTotal: ${computers.length} computadora(s)\n`);
  process.exit(0);
}

main().catch((e) => {
  console.error("Error:", e.message);
  process.exit(1);
});
