import { db } from "@/lib/db";

async function main() {
  const users = await (db as any).user.findMany({
    select: { id: true, username: true, apiKey: true, createdAt: true },
    orderBy: { createdAt: "asc" },
  });
  // Salida estilo tabla (como antes)
  console.table(
    users.map((u) => ({
      id: u.id,
      username: u.username,
      apiKey: u.apiKey,
      createdAt: u.createdAt,
    }))
  );
  process.exit(0);
}

main().catch(() => {
  process.exit(1);
});
