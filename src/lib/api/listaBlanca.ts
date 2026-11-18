// Servicio de la lista blanca: el alta que otras pestañas
// ofrecen sobre un dispositivo (Desbloqueos, la ficha USB) sin
// montar la petición a mano. La pestaña Lista blanca migrará
// aquí el resto de sus operaciones en la siguiente tanda.

import { mutacionJson } from "@/lib/http";

/**
 * Da de alta un serial en la lista blanca. El servidor solo lo
 * acepta desde su propia PC: desde otro equipo responde 403 y
 * el `HttpError` lleva su motivo, listo para enseñar.
 */
export function agregar(entrada: { serialNumber: string; label?: string }) {
  return mutacionJson<{ ok: boolean }>("/api/whitelist", "POST", entrada);
}
