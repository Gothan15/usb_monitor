// Servicio de destinos guardados: los destinos de instalación
// que el panel recuerda entre sesiones (nombre, IP y usuario;
// las contraseñas no se guardan nunca).

import { lecturaJson, mutacionJson } from "@/lib/http";

/** Un destino guardado. */
export interface DestinoGuardado {
  id: string;
  nombre: string;
  ip: string;
  usuario: string;
}

/** Los destinos guardados; lista vacía si la lectura falla. */
export async function listar(): Promise<DestinoGuardado[]> {
  try {
    const datos = await lecturaJson<{ ok: boolean; destinos: DestinoGuardado[] }>(
      "/api/destinos-guardados",
    );
    return datos?.ok ? (datos.destinos ?? []) : [];
  } catch {
    return [];
  }
}

/** Guarda la lista de destinos y devuelve cómo quedó. */
export async function guardar(
  destinos: { nombre: string; ip: string; usuario: string }[],
): Promise<DestinoGuardado[]> {
  const datos = await mutacionJson<{ ok: boolean; destinos: DestinoGuardado[] }>(
    "/api/destinos-guardados",
    "POST",
    { destinos },
  );
  return datos.destinos ?? [];
}

/**
 * Quita un destino guardado. Es de fondo: si la petición
 * falla, la lista en pantalla ya lo quitó y la siguiente
 * apertura reconcilia con el servidor.
 */
export async function eliminar(id: string): Promise<void> {
  try {
    await mutacionJson(`/api/destinos-guardados/${id}`, "DELETE");
  } catch {
    // Sin más consecuencia: ver el comentario de arriba.
  }
}
