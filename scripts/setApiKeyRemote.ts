import { spawn } from "child_process";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

interface RemoteConfig {
  hostname: string;
  username?: string;
  password?: string;
}

async function setApiKeyRemotely(computerName: string, config?: RemoteConfig) {
  try {
    // Obtener información de la computadora y usuario
    const computer = await prisma.computer.findUnique({
      where: { name: computerName },
      include: { users: true },
    });

    if (!computer || computer.users.length === 0) {
      console.error(
        `❌ No se encontró computadora o usuario asignado para ${computerName}`
      );
      return;
    }

    const apiKey = computer.users[0].apiKey;
    const targetHost = config?.hostname || computer.ipAddress;

    console.log(
      `\n🔧 Configurando API Key en ${computerName} (${targetHost})...`
    );

    // Comando para configurar la variable de entorno de sistema
    const setxCommand = `setx USB_MONITOR_API_KEY "${apiKey}" /M`;

    if (config?.username && config?.password) {
      // Ejecutar remotamente via WinRM
      console.log(`📡 Conectando via WinRM a ${targetHost}...`);

      const psCommand = `
        Invoke-Command -ComputerName ${targetHost} -Credential (New-Object PSCredential -ArgumentList "${config.username}", (ConvertTo-SecureString "${config.password}" -AsPlainText -Force)) -ScriptBlock {
          ${setxCommand}
        }
      `;

      const ps = spawn("powershell.exe", ["-NoProfile", "-Command", psCommand]);

      ps.stdout.on("data", (data) => {
        console.log(`stdout: ${data}`);
      });

      ps.stderr.on("data", (data) => {
        console.error(`stderr: ${data}`);
      });

      ps.on("close", (code) => {
        if (code === 0) {
          console.log(`\n✅ API Key configurada exitosamente`);
          console.log(`\n⚠️  Ahora reinicia el servicio en ${computerName}:`);
          console.log(
            `   net stop USBMonitorService && net start USBMonitorService\n`
          );
        } else {
          console.error(`❌ Error al configurar API Key (código ${code})`);
        }
      });
    } else {
      // Modo manual - mostrar instrucciones
      console.log(`\n📋 Instrucciones manuales:`);
      console.log(`\n1. Conéctate a ${computerName} como Administrador`);
      console.log(`\n2. Ejecuta en PowerShell:`);
      console.log(`   ${setxCommand}`);
      console.log(`\n3. Reinicia el servicio:`);
      console.log(`   net stop USBMonitorService`);
      console.log(`   net start USBMonitorService\n`);

      console.log(`💡 O copia y pega este comando completo:\n`);
      console.log(
        `${setxCommand}; net stop USBMonitorService; net start USBMonitorService\n`
      );
    }
  } catch (error) {
    console.error("❌ Error:", error);
  } finally {
    await prisma.$disconnect();
  }
}

// Parsear argumentos
const computerName = process.argv[2];
const hostname = process.argv[3];
const username = process.argv[4];
const password = process.argv[5];

if (!computerName) {
  console.log(`
Uso:
  npm run script scripts/setApiKeyRemote.ts <computerName> [hostname] [username] [password]

Ejemplos:
  # Modo manual (muestra instrucciones)
  npm run script scripts/setApiKeyRemote.ts GWINTBLEIDD

  # Modo automático via WinRM
  npm run script scripts/setApiKeyRemote.ts GWINTBLEIDD 192.168.42.1 Administrator password123
  `);
  process.exit(1);
}

const config: RemoteConfig | undefined = hostname
  ? {
      hostname,
      username,
      password,
    }
  : undefined;

setApiKeyRemotely(computerName, config);
