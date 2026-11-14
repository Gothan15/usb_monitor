import { db } from "@/lib/db";
import { manifiestoPaquete } from "@/lib/paqueteAgente";

/**
 * Canal de órdenes del agente: constantes y reglas de estado de
 * `agent_commands`. El agente recoge las órdenes en su llamada de
 * configuración (el panel las marca ENTREGADA al servirlas) y reporta
 * el avance a POST /api/agent/comandos/:id.
 *
 * ESPERA → ENTREGADA → EN_CURSO → HECHA | ERROR
 * EN_CURSO → EN_CURSO es un reintento tras un reinicio del servicio
 * (la actualización se confirma al volver con la versión nueva).
 * CANCELADA la pone el administrador desde cualquier estado vivo;
 * el agente la ve en su siguiente configuración y abandona la
 * orden en su siguiente punto de control.
 */

export const ESTADO_ORDEN = {
  ESPERA: "ESPERA",
  ENTREGADA: "ENTREGADA",
  EN_CURSO: "EN_CURSO",
  HECHA: "HECHA",
  ERROR: "ERROR",
  CANCELADA: "CANCELADA",
} as const;

export type EstadoOrden = (typeof ESTADO_ORDEN)[keyof typeof ESTADO_ORDEN];

export const TIPO_ORDEN_ACTUALIZAR = "actualizar";

export const TIPO_ORDEN_DESINSTALAR = "desinstalar";

/** Qué hace DELETE /api/computers/:id según el estado del equipo. */
export type AccionBorradoEquipo =
  | "borrar"
  | "pedir-desinstalacion"
  | "ya-pedida";

/**
 * Al borrar un equipo CON agente enrolado no basta con borrar la
 * fila: se le deja una orden «desinstalar» y la fila la borra el
 * panel cuando el agente informe HECHA (el agente se desinstala
 * solo, con su carpeta; si está apagado, la orden le espera). Sin
 * credencial no hay agente que desinstalar: borrado directo. Y si
 * la orden ya vive, no se duplica.
 */
export function accionAlBorrarEquipo(
  tieneCredencial: boolean,
  ordenDesinstalarActiva: boolean,
): AccionBorradoEquipo {
  if (!tieneCredencial) return "borrar";
  return ordenDesinstalarActiva ? "ya-pedida" : "pedir-desinstalacion";
}

/** Tope de intentos de una orden antes de darla por fallida. */
export const MAX_INTENTOS_ORDEN = 3;

/** Estados en los que la orden aún vive y se sirve al agente. */
export const ESTADOS_ORDEN_ACTIVA: EstadoOrden[] = [
  ESTADO_ORDEN.ESPERA,
  ESTADO_ORDEN.ENTREGADA,
  ESTADO_ORDEN.EN_CURSO,
];

/**
 * ¿Puede el agente reportar el paso `desde → hacia`? Solo informa de
 * EN_CURSO, HECHA y ERROR; la entrega la marca el propio panel.
 */
export function transicionInformeValida(
  desde: string,
  hacia: string,
): boolean {
  switch (hacia) {
    case ESTADO_ORDEN.EN_CURSO:
      return (
        desde === ESTADO_ORDEN.ESPERA ||
        desde === ESTADO_ORDEN.ENTREGADA ||
        desde === ESTADO_ORDEN.EN_CURSO
      );
    case ESTADO_ORDEN.HECHA:
      return desde === ESTADO_ORDEN.EN_CURSO;
    case ESTADO_ORDEN.ERROR:
      return (
        desde === ESTADO_ORDEN.ESPERA ||
        desde === ESTADO_ORDEN.ENTREGADA ||
        desde === ESTADO_ORDEN.EN_CURSO
      );
    default:
      return false;
  }
}

/**
 * ¿Puede el administrador cancelar esta orden? Solo mientras
 * viva: una orden terminada (HECHA, ERROR o ya CANCELADA) no se
 * toca. Cancelar una «desinstalar» además hace que el equipo
 * reaparezca en la lista, porque su fila solo se borra con la
 * HECHA.
 */
export function sePuedeCancelar(estado: string): boolean {
  return (ESTADOS_ORDEN_ACTIVA as string[]).includes(estado);
}

/** Minutos durante los que una orden cancelada se sigue sirviendo al agente. */
export const MINUTOS_CANCELADA_SERVIDA = 10;

/**
 * Una orden recién cancelada viaja en la configuración durante
 * unos minutos, marcada CANCELADA, para que el agente que la
 * está ejecutando la abandone; si nunca la empezó, ya no está
 * en las activas y ni la ve. Pasada la ventana deja de servirse:
 * el agente que vuelva tarde ya no la encuentra viva y la
 * ignora igual.
 */
export function canceladaServible(
  finishedAt: Date | string | null,
  ahora: Date,
): boolean {
  if (!finishedAt) return false;
  const fin =
    finishedAt instanceof Date
      ? finishedAt.getTime()
      : new Date(finishedAt).getTime();
  if (Number.isNaN(fin)) return false;
  return ahora.getTime() - fin <= MINUTOS_CANCELADA_SERVIDA * 60_000;
}

/** Compara dos versiones «X.Y.Z»: -1, 0 o 1. Lo ilegible cuenta como 0.0.0. */
export function compararVersiones(a: string | null, b: string | null): number {
  const partes = (v: string | null): number[] => {
    const m = (v ?? "").match(/^(\d+)\.(\d+)\.(\d+)/);
    return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : [0, 0, 0];
  };
  const pa = partes(a);
  const pb = partes(b);
  for (let i = 0; i < 3; i++) {
    if (pa[i] !== pb[i]) return pa[i] < pb[i] ? -1 : 1;
  }
  return 0;
}

/** Etiqueta legible de cada estado de una orden, para las vistas. */
export const ETIQUETA_ESTADO_ORDEN: Record<string, string> = {
  [ESTADO_ORDEN.ESPERA]: "En espera",
  [ESTADO_ORDEN.ENTREGADA]: "Entregada",
  [ESTADO_ORDEN.EN_CURSO]: "En curso",
  [ESTADO_ORDEN.HECHA]: "Hecha",
  [ESTADO_ORDEN.ERROR]: "Error",
  [ESTADO_ORDEN.CANCELADA]: "Cancelada",
};

/** Una fila de `agent_commands` tal como sale de la base de datos. */
export interface OrdenActualizacionFila {
  id: string;
  pcName: string;
  type: string;
  status: string;
  detail: string | null;
  targetVersion: string | null;
  attempts: number;
  createdAt: Date | string;
  deliveredAt: Date | string | null;
  startedAt: Date | string | null;
  finishedAt: Date | string | null;
}

/** La misma orden lista para pintar: fechas en ISO y estado con etiqueta. */
export interface VistaOrdenActualizacion {
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

function aIso(fecha: Date | string | null): string | null {
  if (fecha === null) return null;
  return fecha instanceof Date ? fecha.toISOString() : fecha;
}

/**
 * Da forma de vista a una orden de actualización (las de la
 * pestaña de Tareas): normaliza las fechas a ISO, traduce el
 * estado a su etiqueta y dice si la orden sigue viva. Un estado
 * desconocido se enseña tal cual, sin romper la lista.
 */
export function vistaOrdenActualizacion(
  fila: OrdenActualizacionFila,
): VistaOrdenActualizacion {
  return {
    id: fila.id,
    pcName: fila.pcName,
    tipo: fila.type,
    estado: fila.status,
    etiquetaEstado: ETIQUETA_ESTADO_ORDEN[fila.status] ?? fila.status,
    viva: (ESTADOS_ORDEN_ACTIVA as string[]).includes(fila.status),
    detalle: fila.detail?.trim() ? fila.detail : null,
    versionObjetivo: fila.targetVersion,
    intentos: fila.attempts,
    creadaEn: aIso(fila.createdAt) ?? "",
    terminadaEn: aIso(fila.finishedAt),
  };
}

export type ResultadoOrdenActualizacion =
  | { resultado: "creada"; versionObjetivo: string }
  | { resultado: "ya-activa"; versionObjetivo: string | null }
  | { resultado: "al-dia"; versionObjetivo: string }
  | { resultado: "sin-paquete" };

/**
 * Deja una orden «actualizar» en ESPERA para el equipo si el
 * paquete del panel es más nuevo que su versión, sin duplicar la
 * que ya viva. Lo comparten la petición del propio agente (su
 * caja de herramientas) y la actualización automática al servir
 * la configuración. La ruta del administrador conserva sus
 * respuestas detalladas y no pasa por aquí.
 */
export async function asegurarOrdenActualizacion(
  computerId: string,
  agentVersion: string | null,
): Promise<ResultadoOrdenActualizacion> {
  const manifiesto = await manifiestoPaquete();
  if (!manifiesto?.version) return { resultado: "sin-paquete" };
  if (compararVersiones(manifiesto.version, agentVersion) <= 0) {
    return { resultado: "al-dia", versionObjetivo: manifiesto.version };
  }
  const activa = await db.agentCommand.findFirst({
    where: {
      computerId,
      type: TIPO_ORDEN_ACTUALIZAR,
      status: { in: ESTADOS_ORDEN_ACTIVA },
    },
    select: { id: true },
  });
  if (activa) {
    return { resultado: "ya-activa", versionObjetivo: manifiesto.version };
  }
  await db.agentCommand.create({
    data: {
      computerId,
      type: TIPO_ORDEN_ACTUALIZAR,
      targetVersion: manifiesto.version,
    },
  });
  return { resultado: "creada", versionObjetivo: manifiesto.version };
}
