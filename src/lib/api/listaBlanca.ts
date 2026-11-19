// Servicio de la lista blanca: el alta que otras pestañas
// ofrecen sobre un dispositivo (Desbloqueos, la ficha USB) sin
// montar la petición a mano. La pestaña Lista blanca migrará
// aquí el resto de sus operaciones en la siguiente tanda.

import { lecturaJson, mutacionJson } from "@/lib/http";

/**
 * Da de alta un serial en la lista blanca. El servidor solo lo
 * acepta desde su propia PC: desde otro equipo responde 403 y
 * el `HttpError` lleva su motivo, listo para enseñar.
 */
export function agregar(entrada: {
  serialNumber: string;
  label?: string;
  notes?: string;
}) {
  return mutacionJson<{
    ok: boolean;
    item?: { id: string; serialNumber: string };
  }>("/api/whitelist", "POST", entrada);
}

/** Quita un serial de la lista blanca. */
export function eliminar(id: string) {
  return mutacionJson<{
    ok: boolean;
    item?: { serialNumber: string };
  }>(`/api/whitelist/${id}`, "DELETE");
}

/** Quita varios seriales de la lista blanca. */
export function eliminarVarias(ids: string[]) {
  return mutacionJson<{ ok: boolean; deleted: number }>(
    "/api/whitelist",
    "DELETE",
    { ids },
  );
}

/** Un dispositivo conectado ahora mismo, tal como lo sirve la ruta de conectados. */
export interface SerialConectado {
  serialNumber: string;
  pcName: string;
  driveLetter: string | null;
  volumeName: string;
  model: string;
}

/**
 * Los dispositivos conectados ahora mismo en toda la flota,
 * para el desplegable de seriales del alta de la lista blanca.
 * Devuelve [] si el panel no responde: el alta sigue pudiendo
 * teclear el serial a mano, como siempre.
 */
export async function conectados(): Promise<SerialConectado[]> {
  try {
    const datos = await lecturaJson<{
      ok: boolean;
      items: SerialConectado[];
    }>("/api/whitelist/conectados");
    return datos?.items ?? [];
  } catch {
    return [];
  }
}
