-- Detección amplia: los móviles (WPD) no tienen letra de unidad;
-- su bloqueo se identifica por serial.
ALTER TABLE "pending_unlocks" ALTER COLUMN "driveLetter" DROP NOT NULL;
