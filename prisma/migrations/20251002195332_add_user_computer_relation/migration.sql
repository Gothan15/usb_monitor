-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_User" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "username" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "apiKey" TEXT NOT NULL,
    "role" TEXT NOT NULL DEFAULT 'user',
    "computerId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "failedAttempts" INTEGER NOT NULL DEFAULT 0,
    "lockedUntil" DATETIME,
    CONSTRAINT "User_computerId_fkey" FOREIGN KEY ("computerId") REFERENCES "computers" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_User" ("apiKey", "createdAt", "failedAttempts", "id", "lockedUntil", "passwordHash", "role", "updatedAt", "username") SELECT "apiKey", "createdAt", "failedAttempts", "id", "lockedUntil", "passwordHash", "role", "updatedAt", "username" FROM "User";
DROP TABLE "User";
ALTER TABLE "new_User" RENAME TO "User";
CREATE UNIQUE INDEX "User_username_key" ON "User"("username");
CREATE UNIQUE INDEX "User_apiKey_key" ON "User"("apiKey");
CREATE INDEX "User_computerId_idx" ON "User"("computerId");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
