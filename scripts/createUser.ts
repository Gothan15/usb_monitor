import { db } from "@/lib/db";
import { hashPassword, generateApiKey } from "@/lib/auth";

// createUser (solo modo posicional)
// Uso: npm run user:create -- <username> <password> [apiKey] [role]
// Salida (éxito): CREATED <id> <username> <apiKey> <role>
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
  const role = args[3] || "user"; // Por defecto "user"

  if (role !== "admin" && role !== "user") {
    console.error("ERROR: rol debe ser 'admin' o 'user'");
    process.exit(1);
  }

  const existing = await (db as any).user.findUnique({ where: { username } });
  if (existing) {
    console.error("El usuario ya existe");
    process.exit(2);
  }

  const passwordHash = await hashPassword(password);
  const apiKey = apiKeyProvided || generateApiKey();
  const user = await (db as any).user.create({
    data: { username, passwordHash, apiKey, role },
  });

  console.log(
    `CREATED ${user.id} ${user.username} ${user.apiKey} ${user.role}`
  );
  process.exit(0);
}

function printUsage(reason?: string) {
  if (reason) console.error(reason);
  console.log(
    "Uso: npm run user:create -- <username> <password> [apiKey] [role]"
  );
  console.log("Roles disponibles: admin, user (por defecto: user)");
}

main().catch((e) => {
  console.error(e);
  process.exit(99);
});
