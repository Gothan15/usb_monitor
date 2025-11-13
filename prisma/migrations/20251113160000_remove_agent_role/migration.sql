-- Remove 'agent' from Role enum
DO $$
BEGIN
  -- 1) Update any 'agent' users to 'user' first
  UPDATE "public"."User" SET "role" = 'user'::text::"Role" WHERE "role"::text = 'agent';

  -- 2) Drop default constraint temporarily
  ALTER TABLE "public"."User" ALTER COLUMN "role" DROP DEFAULT;

  -- 3) Create new enum without 'agent'
  CREATE TYPE "Role_new" AS ENUM ('admin', 'user');

  -- 4) Convert column to new type
  ALTER TABLE "public"."User" 
    ALTER COLUMN "role" TYPE "Role_new" USING ("role"::text::"Role_new");

  -- 5) Drop old enum and rename new one
  DROP TYPE "Role";
  ALTER TYPE "Role_new" RENAME TO "Role";

  -- 6) Restore default
  ALTER TABLE "public"."User" ALTER COLUMN "role" SET DEFAULT 'user'::"Role";
END $$;
