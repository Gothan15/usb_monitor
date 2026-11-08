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
 */

export const ESTADO_ORDEN = {
  ESPERA: "ESPERA",
  ENTREGADA: "ENTREGADA",
  EN_CURSO: "EN_CURSO",
  HECHA: "HECHA",
  ERROR: "ERROR",
} as const;

export type EstadoOrden = (typeof ESTADO_ORDEN)[keyof typeof ESTADO_ORDEN];

export const TIPO_ORDEN_ACTUALIZAR = "actualizar";

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
