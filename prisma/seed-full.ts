import { PrismaClient } from "@prisma/client";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const prisma = new PrismaClient();
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const seedPath = path.join(__dirname, "seed-data.json");

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

function randomApiKey(prefix = "uk_") {
  return (
    prefix +
    Math.random().toString(36).slice(2, 10) +
    Math.random().toString(36).slice(2, 10)
  );
}

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

async function main() {
  console.log("Loading seed data from seed-data.json...");
  const fileContents = await readFile(seedPath, "utf8");
  const seedData = JSON.parse(fileContents) as SeedData;

  if (!Array.isArray(seedData.users) || !Array.isArray(seedData.whitelist)) {
    throw new Error('Seed file must contain "users" and "whitelist" arrays.');
  }

  console.log("Clearing existing data (safe order)...");

  await prisma.uSBEvent.deleteMany();
  await prisma.uSBConnection.deleteMany();
  await prisma.uSBWhitelist.deleteMany();
  await prisma.user.deleteMany();
  await prisma.computer.deleteMany();

  console.log("Creating computers...");
  const computers = [] as Awaited<ReturnType<typeof prisma.computer.create>>[];
  for (let i = 1; i <= 12; i++) {
    const name = `PC-${String(i).padStart(2, "0")}`;
    const comp = await prisma.computer.create({
      data: {
        name,
        ipAddress: `192.168.1.${10 + i}`,
        lastSeen: new Date(Date.now() - i * 1000 * 60 * 60),
        isActive: i % 2 === 0,
        serviceInstalled: true,
        serviceRunning: i % 3 !== 0,
        agentVersion: `1.0.${i}`,
      },
    });
    computers.push(comp);
  }

  console.log("Inserting users from seed-data.json...");
  const jsonUsers = [] as Awaited<ReturnType<typeof prisma.user.create>>[];
  for (const user of seedData.users) {
    const computerId = await ensureComputer(user.computerId, user.username);

    const createdUser = await prisma.user.create({
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
    jsonUsers.push(createdUser);
  }

  console.log("Inserting whitelist from seed-data.json...");
  const jsonWhitelist = [] as Awaited<
    ReturnType<typeof prisma.uSBWhitelist.create>
  >[];
  for (const entry of seedData.whitelist) {
    const createdById = entry.createdById
      ? await prisma.user
          .findUnique({ where: { id: entry.createdById } })
          .then((user) => user?.id ?? null)
      : null;

    const createdEntry = await prisma.uSBWhitelist.create({
      data: {
        id: entry.id,
        serialNumber: entry.serialNumber,
        label: entry.label,
        notes: entry.notes,
        createdById,
      },
    });
    jsonWhitelist.push(createdEntry);
  }

  console.log("Creating additional users (>=10 total)...");
  const users = [...jsonUsers] as Awaited<
    ReturnType<typeof prisma.user.create>
  >[];
  for (let i = 3; i <= 12; i++) {
    // Start from 3 to add more
    const username = `user${i}`;
    const user = await prisma.user.create({
      data: {
        username,
        passwordHash: `argon2id$placeholder$${username}`,
        apiKey: randomApiKey(),
        role: i === 1 ? "ADMIN" : "USER",
        computerId: computers[i - 1]?.id ?? null,
      },
    });
    users.push(user);
  }

  console.log("Creating additional whitelist entries (>=10 total)...");
  const whitelistEntries = [...jsonWhitelist] as Awaited<
    ReturnType<typeof prisma.uSBWhitelist.create>
  >[];
  for (let i = 2; i <= 12; i++) {
    // Start from 2 to add more
    const serial = `SN${100000 + i}`;
    const entry = await prisma.uSBWhitelist.create({
      data: {
        serialNumber: serial,
        label: `Trusted USB ${i}`,
        notes: i % 2 === 0 ? "Corp device" : "User-provided",
        createdById: users[(i - 1) % users.length].id,
      },
    });
    whitelistEntries.push(entry);
  }

  console.log("Creating USB connections (>=10)...");
  const connections = [] as Awaited<
    ReturnType<typeof prisma.uSBConnection.create>
  >[];
  for (let i = 1; i <= 12; i++) {
    const comp = computers[(i - 1) % computers.length];
    const serial =
      i % 3 === 0
        ? whitelistEntries[(i - 1) % whitelistEntries.length].serialNumber
        : `TSN-${i}`;
    const conn = await prisma.uSBConnection.create({
      data: {
        pcName: comp.name,
        driveLetter: `E${i}`,
        volumeName: `USB_VOL_${i}`,
        serialNumber: serial,
        model: `Model-${i}`,
        size: BigInt(32000000000 + i * 1000),
        connectedAt: new Date(Date.now() - i * 1000 * 60 * 30),
        disconnectedAt:
          i % 4 === 0 ? new Date(Date.now() - i * 1000 * 60 * 5) : null,
        lastSeen: new Date(),
        isConnected: i % 4 !== 0,
      },
    });
    connections.push(conn);
  }

  console.log("Creating USB events (>=10)...");
  const events = [] as Awaited<ReturnType<typeof prisma.uSBEvent.create>>[];
  for (let i = 1; i <= 12; i++) {
    const comp = computers[(i - 1) % computers.length];
    const user = users[(i - 1) % users.length];
    const serial =
      connections[(i - 1) % connections.length].serialNumber ?? null;
    const ev = await prisma.uSBEvent.create({
      data: {
        pcName: comp.name,
        pcIp: comp.ipAddress,
        pcUser: user.username,
        event: i % 2 === 0 ? "connected" : "disconnected",
        driveLetter: `E${i}`,
        serialNumber: serial,
        readonlyStatus: i % 2 === 0 ? "false" : "true",
        whitelisted: whitelistEntries.some((w) => w.serialNumber === serial),
        timestamp: new Date(Date.now() - i * 1000 * 60 * 10),
      },
    });
    events.push(ev);
  }

  console.log(
    `Inserted ${computers.length} computers, ${users.length} users (${jsonUsers.length} from JSON), ${whitelistEntries.length} whitelist entries (${jsonWhitelist.length} from JSON), ${connections.length} connections, ${events.length} events.`
  );
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
