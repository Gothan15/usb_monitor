import { db } from "@/lib/db";
import { hashPassword, generateApiKey } from "@/lib/auth";

// createUser (solo modo posicional)
// Uso: npm run user:create -- <username> <password> [apiKey]
// Salida (éxito): CREATED <id> <username> <apiKey>
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

  const existing = await (db as any).user.findUnique({ where: { username } });
  if (existing) {
    console.error("El usuario ya existe");
    process.exit(2);
  }

  const passwordHash = await hashPassword(password);
  const apiKey = apiKeyProvided || generateApiKey();
  const user = await (db as any).user.create({
    data: { username, passwordHash, apiKey },
  });

  console.log(`CREATED ${user.id} ${user.username} ${user.apiKey}`);
  process.exit(0);
}

function printUsage(reason?: string) {
  if (reason) console.error(reason);
  console.log("Uso: npm run user:create -- <username> <password> [apiKey]");
}

main().catch((e) => {
  console.error(e);
  process.exit(99);
});
