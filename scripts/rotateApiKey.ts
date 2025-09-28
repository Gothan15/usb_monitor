import { db } from "@/lib/db";
import { generateApiKey } from "@/lib/auth";

/*
  rotateApiKey script
  Uso:
    npm run user:rotate-key -- --username <usuario>
    npm run user:rotate-key -- <usuario>
    npm run user:rotate-key -- --id <id>
*/

async function main() {
  const raw = process.argv.slice(2);
  const params: Record<string, string> = {};
  for (let i = 0; i < raw.length; i++) {
    const a = raw[i];
    if (a === "--help" || a === "-h") return printUsage();
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
  if ((username && id) || (!username && !id))
    return printUsage("Debes indicar sólo username O sólo id");

  const where: any = username ? { username } : { id };
  const user = await (db as any).user.findUnique({ where });
  if (!user) {
    console.error("Usuario no encontrado");
    process.exit(2);
  }
  const newKey = generateApiKey();
  const updated = await (db as any).user.update({
    where,
    data: { apiKey: newKey },
  });
  console.log(`ROTATED ${updated.id} ${updated.username} ${updated.apiKey}`);
  process.exit(0);
}

function printUsage(reason?: string) {
  if (reason) console.error("\n" + reason + "\n");
  console.log(
    "Uso: npm run user:rotate-key -- <username> | --username <u> | --id <id>"
  );
  process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(99);
});
