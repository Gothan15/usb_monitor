import { db } from "@/lib/db";

async function main() {
  const users = await (db as any).user.findMany({
    select: {
      id: true,
      username: true,
      apiKey: true,
      role: true,
      createdAt: true,
      computer: {
        select: {
          name: true,
          ipAddress: true,
          isActive: true,
        },
      },
    },
    orderBy: { createdAt: "asc" },
  });
  // Salida estilo tabla (con computadora asignada)
  console.table(
    users.map((u) => ({
      id: u.id,
      username: u.username,
      role: u.role,
      computer: u.computer ? u.computer.name : "Sin asignar",
      computerIp: u.computer ? u.computer.ipAddress : "-",
      status: u.computer ? (u.computer.isActive ? "Activa" : "Inactiva") : "-",
      apiKey: u.apiKey,
      createdAt: u.createdAt,
    }))
  );
  process.exit(0);
}

main().catch(() => {
  process.exit(1);
});
