-- CreateTable
CREATE TABLE "usb_connections" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "pcName" TEXT NOT NULL,
    "driveLetter" TEXT NOT NULL,
    "volumeName" TEXT NOT NULL,
    "serialNumber" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "size" BIGINT NOT NULL DEFAULT 0,
    "connectedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "disconnectedAt" DATETIME,
    "lastSeen" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "isConnected" BOOLEAN NOT NULL DEFAULT true
);

-- CreateIndex
CREATE INDEX "usb_connections_pcName_isConnected_idx" ON "usb_connections"("pcName", "isConnected");

-- CreateIndex
CREATE INDEX "usb_connections_serialNumber_idx" ON "usb_connections"("serialNumber");

-- CreateIndex
CREATE INDEX "usb_connections_connectedAt_idx" ON "usb_connections"("connectedAt");

-- CreateIndex
CREATE INDEX "usb_connections_disconnectedAt_idx" ON "usb_connections"("disconnectedAt");
