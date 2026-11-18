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

/**
 * Tipo de la desinstalación remota, retirada por ahora
 * (2026-11-16): las desinstalaciones por orden fallaban en la
 * práctica y Gothan mandó quitarlas. Ya no nace ninguna orden
 * de este tipo y la configuración del agente no las sirve
 * aunque quede alguna viva de antes en la tabla; la constante
 * queda para que las filas históricas se sigan etiquetando
 * bien en Tareas.
 */
export const TIPO_ORDEN_DESINSTALAR = "desinstalar";

/**
 * Orden de detener la cuenta atrás de apagado en curso en un
 * equipo. La ejecuta el propio trabajador del agente (no el
 * actualizador) en cuanto la configuración la sirve — y con
 * una cuenta en curso, la configuración se sondea cada pocos
 * segundos —.
 */
export const TIPO_ORDEN_CANCELAR_APAGADO = "cancelar-apagado";

/**
 * Orden de reiniciar el servicio del agente en el equipo: el
 * botón «Reiniciar» de Equipos. Al volver a arrancar, el agente
 * relee la configuración nada más nacer, así que los ajustes
 * guardados en el panel quedan aplicados al momento en vez de
 * esperar al siguiente sondeo. La ejecuta el trabajador con un
 * marcador en disco (si la orden vuelve tras el reinicio, se
 * informa HECHA sin reiniciar dos veces).
 */
export const TIPO_ORDEN_REINICIAR = "reiniciar";

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
 * toca.
 */
export function sePuedeCancelar(estado: string): boolean {
  return (ESTADOS_ORDEN_ACTIVA as string[]).includes(estado);
}

/**
 * ¿Tiene este equipo un reinicio del servicio en curso? Hay una
 * orden «reiniciar» viva (ESPERA, ENTREGADA o EN_CURSO): la
 * pestaña de Equipos enseña el botón con su ruleta mientras
 * dure y la ruta de creación no duplica la orden.
 */
export function reinicioEnCurso(
  ordenes: { type: string; status: string }[],
): boolean {
  return ordenes.some(
    (o) =>
      o.type === TIPO_ORDEN_REINICIAR &&
      (ESTADOS_ORDEN_ACTIVA as string[]).includes(o.status),
  );
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

/**
 * ¿Puede borrarse esta orden en la limpieza de terminadas de
 * la pestaña de Tareas? Solo las terminales: HECHA y ERROR,
 * siempre; CANCELADA, solo cuando ya no es servible al agente
 * — borrarla dentro de su ventana de 10 minutos le quitaría
 * al agente que la está abandonando la señal de que pare —.
 * Las vivas (ESPERA, ENTREGADA, EN_CURSO) no se tocan nunca.
 */
export function ordenEliminable(
  estado: string,
  finishedAt: Date | string | null,
  ahora: Date,
): boolean {
  if (estado === ESTADO_ORDEN.HECHA || estado === ESTADO_ORDEN.ERROR) {
    return true;
  }
  if (estado === ESTADO_ORDEN.CANCELADA) {
    return !canceladaServible(finishedAt, ahora);
  }
  return false;
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
  | { resultado: "sin-paquete" }
  | { resultado: "en-espera-oleada"; versionObjetivo: string };

/**
 * Oleadas de la actualización automática: ¿puede nacer otra
 * orden automática para la versión en curso? Solo si la oleada
 * actual no está llena (órdenes vivas de esa versión en toda la
 * flota) y si ninguna orden de esa versión ha acabado en error:
 * un error congela el despliegue automático de esa versión para
 * que un paquete malo no caiga en cascada; el administrador
 * sigue pudiendo ordenar equipo a equipo a mano.
 */
export function puedeCrearOrdenAutomatica(
  activas: number,
  errores: number,
  tamanoOleada: number,
): boolean {
  if (errores > 0) return false;
  return activas < Math.max(1, Math.floor(tamanoOleada) || 1);
}

/**
 * ¿Suma intento un informe del agente? Solo el que ABRE un
 * intento (la orden entra en EN_CURSO desde otro estado). Los
 * informes de progreso dentro del mismo intento (la descarga al
 * 25 %, al 50 %…) repiten EN_CURSO y no deben quemar el cupo de
 * intentos ni chocar con su tope.
 */
export function informeSumaIntento(
  estadoDesde: string,
  estadoHacia: string,
): boolean {
  return (
    estadoHacia === ESTADO_ORDEN.EN_CURSO &&
    estadoDesde !== ESTADO_ORDEN.EN_CURSO
  );
}

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
  opciones?: { automatica?: boolean; tamanoOleada?: number },
): Promise<ResultadoOrdenActualizacion> {
  const manifiesto = await manifiestoPaquete();
  if (!manifiesto?.version) return { resultado: "sin-paquete" };
  if (compararVersiones(manifiesto.version, agentVersion) <= 0) {
    return { resultado: "al-dia", versionObjetivo: manifiesto.version };
  }
  const vivas = await db.agentCommand.findMany({
    where: {
      computerId,
      status: { in: ESTADOS_ORDEN_ACTIVA },
    },
    select: { type: true },
  });
  if (vivas.some((v) => v.type === TIPO_ORDEN_ACTUALIZAR)) {
    return { resultado: "ya-activa", versionObjetivo: manifiesto.version };
  }
  if (opciones?.automatica) {
    // Oleadas: se cuenta contra la versión en curso en TODA la
    // flota, no por equipo.
    const [activasFlota, erroresFlota] = await Promise.all([
      db.agentCommand.count({
        where: {
          type: TIPO_ORDEN_ACTUALIZAR,
          status: { in: ESTADOS_ORDEN_ACTIVA },
          targetVersion: manifiesto.version,
        },
      }),
      db.agentCommand.count({
        where: {
          type: TIPO_ORDEN_ACTUALIZAR,
          status: ESTADO_ORDEN.ERROR,
          targetVersion: manifiesto.version,
        },
      }),
    ]);
    if (
      !puedeCrearOrdenAutomatica(
        activasFlota,
        erroresFlota,
        opciones.tamanoOleada ?? 3,
      )
    ) {
      return {
        resultado: "en-espera-oleada",
        versionObjetivo: manifiesto.version,
      };
    }
  }
  await db.agentCommand.create({
    data: {
      computerId,
      type: TIPO_ORDEN_ACTUALIZAR,
      targetVersion: manifiesto.version,
      targetSha256: manifiesto.sha256,
    },
  });
  return { resultado: "creada", versionObjetivo: manifiesto.version };
}
