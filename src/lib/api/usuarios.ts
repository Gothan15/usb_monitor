// Servicio de usuarios: lo que otras pestañas necesitan de la
// API de usuarios sin montar la petición a mano. La pestaña
// Usuarios migrará aquí sus propias mutaciones en la siguiente
// tanda de la capa de servicios.

import { lecturaJson, mutacionJson } from "@/lib/http";

/** Usuario en su forma mínima, para selectores de dueño. */
export interface UsuarioResumen {
  id: string;
  username: string;
}

/**
 * La lista de usuarios para un selector (id y nombre). Si la
 * petición falla devuelve la lista vacía: el selector se queda
 * sin opciones en vez de romper la ventana que lo contiene.
 */
export async function listarParaSelector(): Promise<UsuarioResumen[]> {
  try {
    const datos = await lecturaJson<{ items?: unknown[] }>(
      "/api/users?page=1&pageSize=100",
    );
    if (!Array.isArray(datos?.items)) return [];
    return datos.items.map((u) => {
      const fila = u as { id: unknown; username: unknown };
      return { id: String(fila.id), username: String(fila.username) };
    });
  } catch {
    return [];
  }
}

/** Asigna un equipo a un usuario (su PC asignada). */
export function asignarEquipo(usuarioId: string, computerId: string) {
  return mutacionJson<{ ok: boolean }>(`/api/users/${usuarioId}`, "PATCH", {
    computerId,
  });
}

/** Una página de usuarios del directorio, con su total. */
export async function listar(opciones: {
  page: number;
  pageSize: number;
  q?: string;
  signal?: AbortSignal;
}): Promise<{ items: unknown[]; total: number }> {
  const params = new URLSearchParams({
    page: String(opciones.page),
    pageSize: String(opciones.pageSize),
  });
  if (opciones.q) params.set("q", opciones.q);
  const datos = await lecturaJson<{
    ok: boolean;
    items?: unknown[];
    total?: number;
  }>(`/api/users?${params.toString()}`, { signal: opciones.signal });
  return {
    items: datos.items ?? [],
    total: datos.total ?? datos.items?.length ?? 0,
  };
}

/** Crea un usuario con los datos del formulario. */
export function crear(payload: Record<string, unknown>) {
  return mutacionJson<{ ok: boolean; item?: { username: string } }>(
    "/api/users",
    "POST",
    payload,
  );
}

/** Guarda los cambios de un usuario. */
export function actualizar(id: string, payload: Record<string, unknown>) {
  return mutacionJson<{ ok: boolean; item?: { username: string } }>(
    `/api/users/${id}`,
    "PATCH",
    payload,
  );
}

/** Elimina un usuario del directorio. */
export function eliminar(id: string) {
  return mutacionJson<{ ok: boolean }>(`/api/users/${id}`, "DELETE");
}

/** Elimina varios usuarios; el propio se omite en el servidor. */
export function eliminarVarios(ids: string[]) {
  return mutacionJson<{ ok: boolean; deleted: number; skippedSelf?: boolean }>(
    "/api/users",
    "DELETE",
    { ids },
  );
}
