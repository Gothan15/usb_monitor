-- Desbloqueo por contraseña (2FA): pendientes, intentos y campos del equipo
ALTER TABLE "computers" ADD COLUMN "agentTokenHash" TEXT;
ALTER TABLE "computers" ADD COLUMN "agentTokenAt" TIMESTAMP(3);
ALTER TABLE "computers" ADD COLUMN "unlockMode" TEXT NOT NULL DEFAULT 'OWNER_OR_ADMIN';

CREATE TYPE "PendingStatus" AS ENUM ('BLOCKED', 'UNLOCKED', 'CLOSED');

CREATE TABLE "pending_unlocks" (
    "id" TEXT NOT NULL,
    "computerId" TEXT,
    "pcName" TEXT NOT NULL,
    "driveLetter" TEXT NOT NULL,
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

CREATE INDEX "pending_unlocks_pcName_status_idx" ON "pending_unlocks"("pcName", "status");
CREATE INDEX "pending_unlocks_createdAt_idx" ON "pending_unlocks"("createdAt");
CREATE INDEX "unlock_attempts_pcName_createdAt_idx" ON "unlock_attempts"("pcName", "createdAt");

ALTER TABLE "pending_unlocks" ADD CONSTRAINT "pending_unlocks_computerId_fkey" FOREIGN KEY ("computerId") REFERENCES "computers"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "pending_unlocks" ADD CONSTRAINT "pending_unlocks_unlockedById_fkey" FOREIGN KEY ("unlockedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "unlock_attempts" ADD CONSTRAINT "unlock_attempts_pendingId_fkey" FOREIGN KEY ("pendingId") REFERENCES "pending_unlocks"("id") ON DELETE SET NULL ON UPDATE CASCADE;
