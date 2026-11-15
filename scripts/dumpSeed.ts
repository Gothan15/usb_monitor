import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  const users = await prisma.user.findMany({
    select: {
      id: true,
      username: true,
      passwordHash: true,
      apiKey: true,
      role: true,
      computerId: true,
      createdAt: true,
      updatedAt: true,
      failedAttempts: true,
      lockedUntil: true,
    },
    orderBy: { createdAt: "asc" },
  });

  const whitelist = await prisma.uSBWhitelist.findMany({
    select: {
      id: true,
      serialNumber: true,
      label: true,
      notes: true,
      createdAt: true,
      updatedAt: true,
      createdById: true,
    },
    orderBy: { createdAt: "asc" },
  });

  const payload = { users, whitelist };
  process.stdout.write(JSON.stringify(payload, null, 2));
}

main()
  .catch((error) => {
    console.error("Error dumping seed data", error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
