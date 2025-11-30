import { PrismaClient } from "@prisma/client";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

type SeedUser = {
  id: string;
  username: string;
  passwordHash: string;
  apiKey: string;
  role: string;
  computerId: string | null;
  failedAttempts: number;
  lockedUntil: string | null;
};

type SeedWhitelistEntry = {
  id: string;
  serialNumber: string;
  label: string | null;
  notes: string | null;
  createdById: string | null;
};

type SeedData = {
  users: SeedUser[];
  whitelist: SeedWhitelistEntry[];
};

const prisma = new PrismaClient();
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const seedPath = path.join(__dirname, "seed-data.json");

async function ensureComputer(
  computerId: string | null,
  username: string
): Promise<string | null> {
  if (!computerId) {
    return null;
  }

  const computer = await prisma.computer.findUnique({
    where: { id: computerId },
  });
  if (!computer) {
    console.warn(
      `Computer ${computerId} referenced by user ${username} was not found. The relation will be skipped.`
    );
    return null;
  }

  return computer.id;
}

async function seedUsers(users: SeedUser[]): Promise<void> {
  await prisma.uSBWhitelist.deleteMany();
  await prisma.user.deleteMany();

  for (const user of users) {
    const computerId = await ensureComputer(user.computerId, user.username);

    await prisma.user.create({
      data: {
        id: user.id,
        username: user.username,
        passwordHash: user.passwordHash,
        apiKey: user.apiKey,
        role: user.role.toUpperCase() as "ADMIN" | "USER",
        computerId,
        failedAttempts: user.failedAttempts,
        lockedUntil: user.lockedUntil ? new Date(user.lockedUntil) : null,
      },
    });
  }
}

async function seedWhitelist(entries: SeedWhitelistEntry[]): Promise<void> {
  for (const entry of entries) {
    const createdById = entry.createdById
      ? await prisma.user
          .findUnique({ where: { id: entry.createdById } })
          .then((user) => user?.id ?? null)
      : null;

    await prisma.uSBWhitelist.create({
      data: {
        id: entry.id,
        serialNumber: entry.serialNumber,
        label: entry.label,
        notes: entry.notes,
        createdById,
      },
    });
  }
}

async function main(): Promise<void> {
  const fileContents = await readFile(seedPath, "utf8");
  const seedData = JSON.parse(fileContents) as SeedData;

  if (!Array.isArray(seedData.users) || !Array.isArray(seedData.whitelist)) {
    throw new Error('Seed file must contain "users" and "whitelist" arrays.');
  }

  await seedUsers(seedData.users);
  await seedWhitelist(seedData.whitelist);

  console.log(
    `Seed complete. Inserted ${seedData.users.length} users and ${seedData.whitelist.length} whitelist entries.`
  );
}

async function run(): Promise<void> {
  try {
    await main();
  } catch (error) {
    console.error("Failed to seed database.");
    console.error(error);
    process.exitCode = 1;
  } finally {
    await prisma.$disconnect();
  }
}

run();
