// Servicio de equipos: las llamadas de la pestaña Equipos a la
// API, con nombre y tipos, para que el componente pida la
// acción («reinicia el servicio de estos equipos») en vez de
// montar la petición a mano. CSRF, serialización y errores
// viven en `mutacionJson`/`lecturaJson` (src/lib/http.ts).

import { lecturaJson, mutacionJson } from "@/lib/http";

/** Estado de la credencial de un equipo, tal como lo cuenta el servidor. */
export interface EstadoCredencial {
  ok: boolean;
  tieneClave: boolean;
  huella: string | null;
  credencialAt: string | null;
  codigoExpira: string | null;
  intentosFallidos: number;
  alertaCredencial: boolean;
  credencialRevocadaAt: string | null;
}

/** Respuesta al generar un código de enrolamiento. */
export interface CodigoGenerado {
  ok: boolean;
  codigo: string;
  pcName: string;
  computerId: string;
}

/**
 * La lista de equipos en bruto (la respuesta de la ruta tal
 * cual). Lista vacía si la lectura falla: quien la pide para
 * cruzar datos (el Escáner) simplemente se queda sin el cruce.
 */
export async function listarCrudo(): Promise<Record<string, unknown>[]> {
  try {
    const datos = await lecturaJson<Record<string, unknown>[]>(
      "/api/computers",
    );
    return Array.isArray(datos) ? datos : [];
  } catch {
    return [];
  }
}

/** Elimina un equipo del inventario. */
export function eliminar(id: string) {
  return mutacionJson<{ ok: boolean; item?: { name: string } }>(
    `/api/computers/${id}`,
    "DELETE",
  );
}

/** Elimina varios equipos del inventario. */
export function eliminarVarios(ids: string[]) {
  return mutacionJson<{ ok: boolean; deleted: number }>(
    "/api/computers",
    "DELETE",
    { ids },
  );
}

/**
 * Los dispositivos USB de un equipo (conectados o historial,
 * según el tipo). Lanza si el panel no responde bien: la
 * ficha distingue el error y su cancelación (AbortError).
 */
export async function dispositivosUsb(
  id: string,
  tipo: string,
  diasHistorial: number,
  signal?: AbortSignal,
): Promise<{ items: unknown[] }> {
  const datos = await lecturaJson<{ ok: boolean; items: unknown[] }>(
    `/api/computers/${encodeURIComponent(id)}/usb-devices?type=${tipo}&historyDays=${diasHistorial}`,
    { signal },
  );
  return { items: datos.items ?? [] };
}

/** Crea la orden «actualizar» para el agente de un equipo. */
export function crearOrdenActualizacion(pcName: string) {
  return mutacionJson<{ ok: boolean }>("/api/agent/comandos", "POST", {
    pcName,
    tipo: "actualizar",
  });
}

/** Crea la orden de detener la cuenta atrás de apagado de un equipo. */
export function cancelarApagado(id: string) {
  return mutacionJson<{ ok: boolean }>(
    `/api/computers/${id}/cancelar-apagado`,
    "POST",
  );
}

/** Crea las órdenes de reiniciar el servicio en los equipos dados. */
export function reiniciarServicio(ids: string[]) {
  return mutacionJson<{
    ok: boolean;
    creadas: { pcName: string }[];
    omitidas: { pcName?: string; motivo: string }[];
  }>("/api/computers/reiniciar-servicio", "POST", { ids });
}

/** Genera un código de enrolamiento nuevo para el equipo. */
export function generarCodigoEnrolamiento(pcName: string) {
  return mutacionJson<CodigoGenerado>("/api/agent/codigo-enrolamiento", "POST", {
    pcName,
  });
}

/** Revoca la credencial y el código en curso del equipo. */
export function revocarCodigoEnrolamiento(pcName: string) {
  return mutacionJson<{ ok: boolean }>(
    "/api/agent/codigo-enrolamiento",
    "DELETE",
    { pcName },
  );
}

/**
 * Consulta el estado de la credencial de un equipo. Devuelve
 * null si el servidor no responde bien: la ventana de la
 * credencial lo trata como «sin datos» y no enseña nada falso.
 */
export async function estadoCredencial(
  pcName: string,
): Promise<EstadoCredencial | null> {
  try {
    const datos = await lecturaJson<EstadoCredencial>(
      `/api/agent/codigo-enrolamiento?pcName=${encodeURIComponent(pcName)}`,
    );
    return datos?.ok ? datos : null;
  } catch {
    return null;
  }
}
