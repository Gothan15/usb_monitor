import { db } from "@/lib/db";
import { hashPassword, generateApiKey } from "@/lib/auth";

// createUser (solo modo posicional)
// Uso: npm run user:create -- <username> <password> [apiKey] [role] [computerName]
// Salida (éxito): CREATED <id> <username> <apiKey> <role> [computerName]
// Errores: código !=0 y mensaje corto.

async function main() {
  const args = process.argv.slice(2);
  if (args.includes("--help") || args.includes("-h")) {
    printUsage();
    process.exit(0);
  }
  // Rechazar cualquier flag
  if (args.some((a) => a.startsWith("--"))) {
    console.error("ERROR: solo se permite modo posicional");
    printUsage();
    process.exit(1);
  }
  if (args.length < 2) {
    printUsage();
    process.exit(1);
  }
  const username = args[0];
  const password = args[1];
  const apiKeyProvided = args[2];
  const role = (args[3] || "user").toLowerCase(); // Por defecto "user"
  const computerName = args[4]; // Nombre de la computadora (opcional)

  const allowedRoles = new Set(["admin", "user"]);
  if (!allowedRoles.has(role)) {
    console.error("ERROR: rol debe ser 'admin' o 'user'");
    process.exit(1);
  }

  const existing = await (db as any).user.findUnique({ where: { username } });
  if (existing) {
    console.error("El usuario ya existe");
    process.exit(2);
  }

  let computerId = null;
  if (computerName) {
    const computer = await (db as any).computer.findUnique({
      where: { name: computerName },
    });
    if (!computer) {
      console.error(`ERROR: La computadora '${computerName}' no existe`);
      process.exit(3);
    }
    computerId = computer.id;
  }

  // Nota: el rol 'agent' fue eliminado.

  const passwordHash = await hashPassword(password);
  const apiKey = apiKeyProvided || generateApiKey();
  const user = await (db as any).user.create({
    data: { username, passwordHash, apiKey, role, computerId },
  });

  console.log(
    `CREATED ${user.id} ${user.username} ${user.apiKey} ${user.role}${
      computerName ? ` ${computerName}` : ""
    }`
  );
  process.exit(0);
}

function printUsage(reason?: string) {
  if (reason) console.error(reason);
  console.log(
    "Uso: npm run user:create -- <username> <password> [apiKey] [role] [computerName]"
  );
  console.log("Roles disponibles: admin, user (por defecto: user)");
  console.log("computerName: Nombre de la computadora a asignar (opcional)");
}

main().catch((e) => {
  console.error(e);
  process.exit(99);
});
