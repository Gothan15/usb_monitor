-- Add USB metadata fields to usb_events
ALTER TABLE "usb_events"
  ADD COLUMN "driveLetter" TEXT,
  ADD COLUMN "serialNumber" TEXT,
  ADD COLUMN "readonlyStatus" TEXT,
  ADD COLUMN "whitelisted" BOOLEAN NOT NULL DEFAULT false;
