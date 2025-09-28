import { db } from "@/lib/db";

/*
  deleteUser script
  Formas de uso:
    Flags:      npm run user:delete -- --username <usuario>
                npm run user:delete -- --id <id>
    Posicional: npm run user:delete -- <usuario>
    Ayuda:      npm run user:delete -- --help

  Nota: Requiere exactamente un identificador (username o id).
*/

async function main() {
  const raw = process.argv.slice(2);
  const params: Record<string, string> = {};
  for (let i = 0; i < raw.length; i++) {
    const a = raw[i];
    if (a === "--help" || a === "-h") {
      return printUsage();
    }
    if (a.startsWith("--")) {
      const key = a.replace(/^--/, "");
      const val =
        raw[i + 1] && !raw[i + 1].startsWith("--") ? raw[++i] : "true";
      params[key] = val;
    }
  }
  const positional = raw.filter((a) => !a.startsWith("--"));
  if (!params.username && positional[0]) params.username = positional[0];

  const { username, id } = params;
  if ((username && id) || (!username && !id)) {
    return printUsage("Debes indicar sólo username O sólo id");
  }

  try {
    const where: any = username ? { username } : { id };
    const user = await (db as any).user.findUnique({ where });
    if (!user) {
      console.error("Usuario no encontrado");
      process.exit(2);
    }
    await (db as any).user.delete({ where });
    console.log(`DELETED ${user.id} ${user.username}`);
    process.exit(0);
  } catch (e) {
    console.error("ERROR");
    process.exit(99);
  }
}

function printUsage(reason?: string) {
  if (reason) console.error("\n" + reason + "\n");
  console.log(
    "Uso: npm run user:delete -- <username> | --username <u> | --id <id>"
  );
  process.exit(1);
}

main();
