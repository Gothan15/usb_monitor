-- Relación UnlockAttempt.user (auditoría de la vista Desbloqueos, fase 5)
ALTER TABLE "unlock_attempts" ADD CONSTRAINT "unlock_attempts_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
