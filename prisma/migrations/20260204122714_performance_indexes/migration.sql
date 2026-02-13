/*
  Warnings:

  - The values [agent] on the enum `Role` will be removed. If these variants are still used in the database, this will fail.

*/
-- AlterEnum
BEGIN;
CREATE TYPE "public"."Role_new" AS ENUM ('admin', 'user');
ALTER TABLE "public"."User" ALTER COLUMN "role" DROP DEFAULT;
ALTER TABLE "public"."User" ALTER COLUMN "role" TYPE "public"."Role_new" USING ("role"::text::"public"."Role_new");
ALTER TYPE "public"."Role" RENAME TO "Role_old";
ALTER TYPE "public"."Role_new" RENAME TO "Role";
DROP TYPE "public"."Role_old";
ALTER TABLE "public"."User" ALTER COLUMN "role" SET DEFAULT 'user';
COMMIT;

-- CreateIndex
CREATE INDEX "usb_events_pcName_idx" ON "public"."usb_events"("pcName");

-- CreateIndex
CREATE INDEX "usb_events_serialNumber_idx" ON "public"."usb_events"("serialNumber");
