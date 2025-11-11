import { PrismaClient } from "@prisma/client";
import { getCurrentDate } from "@/lib/time";

const prisma = new PrismaClient();

async function updateComputerIP(computerName: string, newIP: string) {
  try {
    const computer = await prisma.computer.update({
      where: { name: computerName },
      data: {
        ipAddress: newIP,
        lastSeen: getCurrentDate(),
        isActive: true,
      },
    });

    console.log(`✅ IP actualizada para ${computerName}:`);
    console.log(`   IP anterior: ${computer.ipAddress}`);
    console.log(`   IP nueva: ${newIP}`);
    console.log(
      `\n💡 Ahora el backend podrá conectarse en: http://${newIP}:5001`
    );
  } catch (error) {
    console.error("❌ Error:", error);
  } finally {
    await prisma.$disconnect();
  }
}

const computerName = process.argv[2];
const newIP = process.argv[3];

if (!computerName || !newIP) {
  console.log(`
Uso:
  npm run script scripts/updateComputerIP.ts <computerName> <newIP>

Ejemplo:
  npm run script scripts/updateComputerIP.ts GWINTBLEIDD 172.20.10.12
  `);
  process.exit(1);
}

updateComputerIP(computerName, newIP);
