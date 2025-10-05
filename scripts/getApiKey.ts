import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function getApiKeyForComputer(computerName: string) {
  try {
    // Buscar la computadora
    const computer = await prisma.computer.findUnique({
      where: { name: computerName },
      include: {
        users: true, // Incluir usuarios asignados
      },
    });

    if (!computer) {
      console.log(`❌ Computer "${computerName}" no encontrada`);
      console.log("\nComputadoras disponibles:");
      const computers = await prisma.computer.findMany();
      computers.forEach((c) => console.log(`  - ${c.name} (${c.ipAddress})`));
      return;
    }

    console.log(`\n✅ Computadora: ${computer.name}`);
    console.log(`📍 IP: ${computer.ipAddress}`);

    if (computer.users.length === 0) {
      console.log(`\n⚠️  No hay usuarios asignados a esta computadora`);
      console.log(`\nPara asignar un usuario, usa:`);
      console.log(
        `  npm run script scripts/assignComputer.ts <username> ${computerName}\n`
      );

      // Mostrar todos los usuarios disponibles
      console.log(`Usuarios disponibles:`);
      const users = await prisma.user.findMany();
      users.forEach((u) => {
        const computerInfo = u.computerId
          ? ` (asignado a otra PC)`
          : " (sin asignar)";
        console.log(`  - ${u.username}${computerInfo}`);
      });
      return;
    }

    console.log(`\n👤 Usuarios asignados a esta computadora:`);
    for (const user of computer.users) {
      console.log(`\n  Usuario: ${user.username}`);
      console.log(`  Rol: ${user.role}`);
      console.log(`  API Key: ${user.apiKey}`);
    }

    const firstUser = computer.users[0];
    console.log(`\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
    console.log(
      `📋 Para configurar el servicio Windows, ejecuta como Administrador:\n`
    );
    console.log(`setx USB_MONITOR_API_KEY "${firstUser.apiKey}" /M`);
    console.log(`\n⚠️  IMPORTANTE:`);
    console.log(`   1. Ejecutar en PowerShell como Administrador`);
    console.log(`   2. Reiniciar el servicio después:`);
    console.log(
      `      net stop USBMonitorService && net start USBMonitorService\n`
    );
  } catch (error) {
    console.error("Error:", error);
  } finally {
    await prisma.$disconnect();
  }
}

const computerName = process.argv[2] || "GWINTBLEIDD";
getApiKeyForComputer(computerName);
