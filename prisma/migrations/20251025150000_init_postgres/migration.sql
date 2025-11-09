-- CreateTable
CREATE TABLE "usb_events" (
    "id" TEXT NOT NULL,
    "pcName" TEXT NOT NULL,
    "pcIp" TEXT NOT NULL,
    "pcUser" TEXT NOT NULL,
    "event" TEXT NOT NULL,
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
    "role" TEXT NOT NULL DEFAULT 'user',
    "computerId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "failedAttempts" INTEGER NOT NULL DEFAULT 0,
    "lockedUntil" TIMESTAMP(3),
    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pending_unlocks" (
    "id" TEXT NOT NULL,
    "pcName" TEXT NOT NULL,
    "driveLetter" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "unlocked" BOOLEAN NOT NULL DEFAULT false,
    CONSTRAINT "pending_unlocks_pkey" PRIMARY KEY ("id")
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
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdById" TEXT,
    CONSTRAINT "usb_whitelist_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_computerId_fkey" FOREIGN KEY ("computerId") REFERENCES "computers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "usb_whitelist" ADD CONSTRAINT "usb_whitelist_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- CreateIndex
CREATE INDEX "usb_events_createdAt_idx" ON "usb_events"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "computers_name_key" ON "computers"("name");

-- CreateIndex
CREATE INDEX "computers_lastSeen_idx" ON "computers"("lastSeen");

-- CreateIndex
CREATE UNIQUE INDEX "User_username_key" ON "User"("username");

-- CreateIndex
CREATE UNIQUE INDEX "User_apiKey_key" ON "User"("apiKey");

-- CreateIndex
CREATE INDEX "User_computerId_idx" ON "User"("computerId");

-- CreateIndex
CREATE INDEX "pending_unlocks_pcName_unlocked_idx" ON "pending_unlocks"("pcName", "unlocked");

-- CreateIndex
CREATE INDEX "pending_unlocks_expiresAt_idx" ON "pending_unlocks"("expiresAt");

-- CreateIndex
CREATE INDEX "usb_connections_pcName_isConnected_idx" ON "usb_connections"("pcName", "isConnected");

-- CreateIndex
CREATE INDEX "usb_connections_serialNumber_idx" ON "usb_connections"("serialNumber");

-- CreateIndex
CREATE INDEX "usb_connections_connectedAt_idx" ON "usb_connections"("connectedAt");

-- CreateIndex
CREATE INDEX "usb_connections_disconnectedAt_idx" ON "usb_connections"("disconnectedAt");

-- CreateIndex
CREATE UNIQUE INDEX "usb_whitelist_serialNumber_key" ON "usb_whitelist"("serialNumber");
