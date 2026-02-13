-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "public"."Role" AS ENUM ('admin', 'user', 'agent');

-- CreateTable
CREATE TABLE "public"."User" (
    "id" TEXT NOT NULL,
    "username" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "apiKey" TEXT NOT NULL,
    "role" "public"."Role" NOT NULL DEFAULT 'user',
    "computerId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "failedAttempts" INTEGER NOT NULL DEFAULT 0,
    "lockedUntil" TIMESTAMP(3),

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."computers" (
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
CREATE TABLE "public"."usb_connections" (
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
CREATE TABLE "public"."usb_events" (
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
CREATE TABLE "public"."usb_whitelist" (
    "id" TEXT NOT NULL,
    "serialNumber" TEXT NOT NULL,
    "label" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdById" TEXT,

    CONSTRAINT "usb_whitelist_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_apiKey_key" ON "public"."User"("apiKey" ASC);

-- CreateIndex
CREATE INDEX "User_computerId_idx" ON "public"."User"("computerId" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "User_username_key" ON "public"."User"("username" ASC);

-- CreateIndex
CREATE INDEX "computers_ipAddress_idx" ON "public"."computers"("ipAddress" ASC);

-- CreateIndex
CREATE INDEX "computers_lastSeen_idx" ON "public"."computers"("lastSeen" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "computers_name_key" ON "public"."computers"("name" ASC);

-- CreateIndex
CREATE INDEX "usb_connections_connectedAt_idx" ON "public"."usb_connections"("connectedAt" ASC);

-- CreateIndex
CREATE INDEX "usb_connections_disconnectedAt_idx" ON "public"."usb_connections"("disconnectedAt" ASC);

-- CreateIndex
CREATE INDEX "usb_connections_pcName_connectedAt_idx" ON "public"."usb_connections"("pcName" ASC, "connectedAt" ASC);

-- CreateIndex
CREATE INDEX "usb_connections_pcName_isConnected_idx" ON "public"."usb_connections"("pcName" ASC, "isConnected" ASC);

-- CreateIndex
CREATE INDEX "usb_connections_pcName_serialNumber_isConnected_idx" ON "public"."usb_connections"("pcName" ASC, "serialNumber" ASC, "isConnected" ASC);

-- CreateIndex
CREATE INDEX "usb_connections_serialNumber_idx" ON "public"."usb_connections"("serialNumber" ASC);

-- CreateIndex
CREATE INDEX "usb_events_createdAt_idx" ON "public"."usb_events"("createdAt" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "usb_whitelist_serialNumber_key" ON "public"."usb_whitelist"("serialNumber" ASC);

-- AddForeignKey
ALTER TABLE "public"."User" ADD CONSTRAINT "User_computerId_fkey" FOREIGN KEY ("computerId") REFERENCES "public"."computers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."usb_whitelist" ADD CONSTRAINT "usb_whitelist_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "public"."User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

