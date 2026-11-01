-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "Role" AS ENUM ('admin', 'user');

-- CreateEnum
CREATE TYPE "PendingStatus" AS ENUM ('BLOCKED', 'UNLOCKED', 'CLOSED');

-- CreateTable
CREATE TABLE "usb_events" (
    "id" TEXT NOT NULL,
    "pcName" TEXT NOT NULL,
    "pcIp" TEXT NOT NULL,
    "pcUser" TEXT NOT NULL,
    "event" TEXT NOT NULL,
    "driveLetter" TEXT,
    "serialNumber" TEXT,
    "readonlyStatus" TEXT,
    "whitelisted" BOOLEAN NOT NULL DEFAULT false,
    "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "usb_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "computers" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "ipAddress" TEXT NOT NULL,
    "lastSeen" TIMESTAMP(3),
    "isActive" BOOLEAN NOT NULL DEFAULT false,
    "serviceInstalled" BOOLEAN NOT NULL DEFAULT false,
    "serviceRunning" BOOLEAN NOT NULL DEFAULT false,
    "lastServiceCheck" TIMESTAMP(3),
    "agentVersion" TEXT,
    "agentTokenHash" TEXT,
    "agentTokenAt" TIMESTAMP(3),
    "unlockMode" TEXT NOT NULL DEFAULT 'OWNER_OR_ADMIN',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "computers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "username" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "apiKey" TEXT NOT NULL,
    "role" "Role" NOT NULL DEFAULT 'user',
    "computerId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "failedAttempts" INTEGER NOT NULL DEFAULT 0,
    "lockedUntil" TIMESTAMP(3),

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "usb_connections" (
    "id" TEXT NOT NULL,
    "pcName" TEXT NOT NULL,
    "driveLetter" TEXT NOT NULL,
    "volumeName" TEXT NOT NULL,
    "serialNumber" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "size" BIGINT NOT NULL DEFAULT 0,
    "connectedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "disconnectedAt" TIMESTAMP(3),
    "lastSeen" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "isConnected" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "usb_connections_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "usb_whitelist" (
    "id" TEXT NOT NULL,
    "serialNumber" TEXT NOT NULL,
    "label" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdById" TEXT,

    CONSTRAINT "usb_whitelist_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pending_unlocks" (
    "id" TEXT NOT NULL,
    "computerId" TEXT,
    "pcName" TEXT NOT NULL,
    "driveLetter" TEXT,
    "serialNumber" TEXT,
    "deviceLabel" TEXT,
    "whitelisted" BOOLEAN NOT NULL DEFAULT false,
    "status" "PendingStatus" NOT NULL DEFAULT 'BLOCKED',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "unlockedById" TEXT,
    "unlockedAt" TIMESTAMP(3),
    "executedAt" TIMESTAMP(3),
    "closedAt" TIMESTAMP(3),
    "closeReason" TEXT,

    CONSTRAINT "pending_unlocks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "unlock_attempts" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "pendingId" TEXT,
    "pcName" TEXT NOT NULL,
    "usernameTried" TEXT NOT NULL,
    "userId" TEXT,
    "serialNumber" TEXT,
    "result" TEXT NOT NULL,
    "origin" TEXT NOT NULL,

    CONSTRAINT "unlock_attempts_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "usb_events_createdAt_idx" ON "usb_events"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "computers_name_key" ON "computers"("name");

-- CreateIndex
CREATE INDEX "computers_lastSeen_idx" ON "computers"("lastSeen");

-- CreateIndex
CREATE INDEX "computers_ipAddress_idx" ON "computers"("ipAddress");

-- CreateIndex
CREATE UNIQUE INDEX "User_username_key" ON "User"("username");

-- CreateIndex
CREATE UNIQUE INDEX "User_apiKey_key" ON "User"("apiKey");

-- CreateIndex
CREATE INDEX "User_computerId_idx" ON "User"("computerId");

-- CreateIndex
CREATE INDEX "usb_connections_pcName_connectedAt_idx" ON "usb_connections"("pcName", "connectedAt");

-- CreateIndex
CREATE INDEX "usb_connections_pcName_isConnected_idx" ON "usb_connections"("pcName", "isConnected");

-- CreateIndex
CREATE INDEX "usb_connections_pcName_serialNumber_isConnected_idx" ON "usb_connections"("pcName", "serialNumber", "isConnected");

-- CreateIndex
CREATE INDEX "usb_connections_serialNumber_idx" ON "usb_connections"("serialNumber");

-- CreateIndex
CREATE INDEX "usb_connections_connectedAt_idx" ON "usb_connections"("connectedAt");

-- CreateIndex
CREATE INDEX "usb_connections_disconnectedAt_idx" ON "usb_connections"("disconnectedAt");

-- CreateIndex
CREATE UNIQUE INDEX "usb_whitelist_serialNumber_key" ON "usb_whitelist"("serialNumber");

-- CreateIndex
CREATE INDEX "pending_unlocks_pcName_status_idx" ON "pending_unlocks"("pcName", "status");

-- CreateIndex
CREATE INDEX "pending_unlocks_createdAt_idx" ON "pending_unlocks"("createdAt");

-- CreateIndex
CREATE INDEX "unlock_attempts_pcName_createdAt_idx" ON "unlock_attempts"("pcName", "createdAt");

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_computerId_fkey" FOREIGN KEY ("computerId") REFERENCES "computers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "usb_whitelist" ADD CONSTRAINT "usb_whitelist_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pending_unlocks" ADD CONSTRAINT "pending_unlocks_computerId_fkey" FOREIGN KEY ("computerId") REFERENCES "computers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pending_unlocks" ADD CONSTRAINT "pending_unlocks_unlockedById_fkey" FOREIGN KEY ("unlockedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "unlock_attempts" ADD CONSTRAINT "unlock_attempts_pendingId_fkey" FOREIGN KEY ("pendingId") REFERENCES "pending_unlocks"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "unlock_attempts" ADD CONSTRAINT "unlock_attempts_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

