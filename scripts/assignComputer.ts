import { db } from "@/lib/db";

// assignComputer
// Uso: npm run user:assign-computer -- <username> <computerName>
// Asigna una computadora a un usuario existente

async function main() {
  const args = process.argv.slice(2);

  if (args.includes("--help") || args.includes("-h")) {
    printUsage();
    process.exit(0);
  }

  if (args.length < 2) {
    printUsage();
    process.exit(1);
  }

  const username = args[0];
  const computerName = args[1];

  // Verificar que el usuario existe
  const user = await (db as any).user.findUnique({
    where: { username },
    include: { computer: true },
  });

  if (!user) {
    console.error(`ERROR: El usuario '${username}' no existe`);
    process.exit(2);
  }

  // Verificar que la computadora existe
  const computer = await (db as any).computer.findUnique({
    where: { name: computerName },
  });

  if (!computer) {
    console.error(`ERROR: La computadora '${computerName}' no existe`);
    console.log("\nComputadoras disponibles:");
    const computers = await (db as any).computer.findMany({
      select: { name: true, ipAddress: true, isActive: true },
    });
    computers.forEach((c: any) => {
      console.log(
        `  - ${c.name} (${c.ipAddress}) ${
          c.isActive ? "[Activa]" : "[Inactiva]"
        }`
      );
    });
    process.exit(3);
  }

  // Actualizar el usuario
  const updated = await (db as any).user.update({
    where: { username },
    data: { computerId: computer.id },
  });

  console.log(
    `SUCCESS: Usuario '${username}' asignado a computadora '${computerName}'`
  );

  if (user.computer) {
    console.log(`  (Anteriormente asignado a: ${user.computer.name})`);
  }

  process.exit(0);
}

function printUsage() {
  console.log("Uso: npm run user:assign-computer -- <username> <computerName>");
  console.log("\nEjemplo:");
  console.log("  npm run user:assign-computer -- juan PC-JUAN");
}

main().catch((e) => {
  console.error(e);
  process.exit(99);
});
