-- CreateTable
CREATE TABLE "usb_events" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "pcName" TEXT NOT NULL,
    "pcIp" TEXT NOT NULL,
    "pcUser" TEXT NOT NULL,
    "event" TEXT NOT NULL,
    "timestamp" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "computers" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "ipAddress" TEXT NOT NULL,
    "lastSeen" DATETIME,
    "isActive" BOOLEAN NOT NULL DEFAULT false,
    "serviceInstalled" BOOLEAN NOT NULL DEFAULT false,
    "serviceRunning" BOOLEAN NOT NULL DEFAULT false,
    "lastServiceCheck" DATETIME,
    "agentVersion" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "username" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "apiKey" TEXT NOT NULL,
    "role" TEXT NOT NULL DEFAULT 'user',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "failedAttempts" INTEGER NOT NULL DEFAULT 0,
    "lockedUntil" DATETIME
);

-- CreateTable
CREATE TABLE "pending_unlocks" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "pcName" TEXT NOT NULL,
    "driveLetter" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" DATETIME NOT NULL,
    "unlocked" BOOLEAN NOT NULL DEFAULT false
);

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
CREATE INDEX "pending_unlocks_pcName_unlocked_idx" ON "pending_unlocks"("pcName", "unlocked");

-- CreateIndex
CREATE INDEX "pending_unlocks_expiresAt_idx" ON "pending_unlocks"("expiresAt");
