// Servicio de tareas: las instalaciones remotas y las órdenes
// del agente que enseña la pestaña Tareas, y la creación de
// tareas desde su diálogo. Los tipos son el contrato de las
// rutas /api/install-tasks y /api/agent/comandos.

import { lecturaJson, mutacionJson } from "@/lib/http";
import type { RequisitoEmpujeVista } from "@/components/dashboard/EmpujeChecklist";

/** Un destino dentro de una tarea de instalación. */
export interface DestinoTareaVista {
  id: string;
  pcName: string;
  ipAddress: string;
  method: string | null;
  status: string;
  message: string | null;
  attempts: number;
  checks: RequisitoEmpujeVista[] | null;
  startedAt: string | null;
  finishedAt: string | null;
}

/** Una tarea de instalación tal como la sirve la lista. */
export interface TareaVista {
  id: string;
  status: string;
  username: string;
  omitIfInstalled: boolean;
  maxAttempts: number;
  createdBy: string | null;
  createdAt: string;
  finishedAt: string | null;
  targets: DestinoTareaVista[];
}

/** Una orden del agente tal como la sirve la lista global. */
export interface OrdenVista {
  id: string;
  pcName: string;
  tipo: string;
  estado: string;
  etiquetaEstado: string;
  viva: boolean;
  detalle: string | null;
  versionObjetivo: string | null;
  intentos: number;
  creadaEn: string;
  terminadaEn: string | null;
}

/** La lista de tareas de instalación. Lanza si el panel no responde bien. */
export async function listar(): Promise<TareaVista[]> {
  const datos = await lecturaJson<{ ok: boolean; tareas: TareaVista[] }>(
    "/api/install-tasks",
  );
  return datos.tareas ?? [];
}

/**
 * La lista de órdenes del agente. Devuelve null si falla: su
 * fallo no debe tapar la lista de tareas, y la siguiente
 * recarga lo reintenta sola.
 */
export async function listarOrdenes(): Promise<OrdenVista[] | null> {
  try {
    const datos = await lecturaJson<{ ok: boolean; comandos: OrdenVista[] }>(
      "/api/agent/comandos",
    );
    return datos?.ok ? (datos.comandos ?? []) : null;
  } catch {
    return null;
  }
}

/** Crea una tarea de instalación con sus destinos y credenciales. */
export function crear(payload: Record<string, unknown>) {
  return mutacionJson<{ ok: boolean }>("/api/install-tasks", "POST", payload);
}

/** Reintenta una tarea terminada, con la clave y ajustes dados. */
export function reintentar(id: string, payload: Record<string, unknown>) {
  return mutacionJson<{ ok: boolean }>(
    `/api/install-tasks/${id}/reintentar`,
    "POST",
    payload,
  );
}

/** Detiene una tarea de instalación en curso. */
export function cancelar(id: string) {
  return mutacionJson<{ ok: boolean }>(
    `/api/install-tasks/${id}/cancelar`,
    "POST",
  );
}

/** Cancela una orden viva del agente (actualización u otra). */
export function cancelarOrden(id: string) {
  return mutacionJson<{ ok: boolean }>(
    `/api/agent/comandos/${id}/cancelar`,
    "POST",
  );
}

/** Borra una tarea ya terminada. */
export function eliminar(id: string) {
  return mutacionJson<{ ok: boolean }>(`/api/install-tasks/${id}`, "DELETE");
}

/** Limpia todas las tareas terminadas. */
export function limpiarTerminadas() {
  return mutacionJson<{ ok: boolean }>("/api/install-tasks", "DELETE");
}

/** Limpia las órdenes del agente ya terminadas. */
export function limpiarOrdenesTerminadas() {
  return mutacionJson<{ ok: boolean }>("/api/agent/comandos", "DELETE");
}
