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
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "failedAttempts" INTEGER NOT NULL DEFAULT 0,
    "lockedUntil" DATETIME
);

-- CreateIndex
CREATE INDEX "usb_events_createdAt_idx" ON "usb_events"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "computers_name_key" ON "computers"("name");

-- CreateIndex
CREATE INDEX "computers_lastSeen_idx" ON "computers"("lastSeen");

-- CreateIndex
CREATE INDEX "usb_authorizations_pcName_idx" ON "usb_authorizations"("pcName");

-- CreateIndex
CREATE INDEX "usb_authorizations_status_requestedAt_idx" ON "usb_authorizations"("status", "requestedAt");

-- CreateIndex
CREATE INDEX "usb_authorization_logs_authorizationId_createdAt_idx" ON "usb_authorization_logs"("authorizationId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "User_username_key" ON "User"("username");

-- CreateIndex
CREATE UNIQUE INDEX "User_apiKey_key" ON "User"("apiKey");
