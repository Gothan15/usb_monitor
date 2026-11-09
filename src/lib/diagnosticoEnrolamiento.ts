/**
 * Diagnóstico del código de enrolamiento: MOTIVOS
 * distinguibles en vez del «no aceptado» genérico.
 *
 * Hasta este arreglo, un enrolamiento rechazado no decía nada
 * ni al agente («El panel no aceptó el código») ni al registro
 * del servidor, y el fallo real —código atado a otra fila,
 * caducado, invalidado por otro más nuevo— solo se podía
 * adivinar. Aquí vive la clasificación, pura y probable: la
 * usan la ruta de enrolar (el motivo viaja en la respuesta,
 * para que el agente lo enseñe tal cual) y la consulta de
 * estado sin gastar (`/api/agent/enroll/estado`), que es el
 * paso 3 de la prueba de enrolamiento del agente.
 *
 * Nada de esto toca el esquema criptográfico: el código sigue
 * siendo de un solo uso y el panel guarda solo su hash. Lo
 * que cambia es que el panel puede DECIR qué le pasa a un
 * código que alguien ya posee — el código es el secreto, y
 * quien lo presenta ya lo conoce.
 */

export const ESTADO_CODIGO = {
  /** El código es de este equipo y sigue vivo: enrolaría. */
  VIGENTE: "vigente",
  /** El código es de este equipo, pero su hora ya pasó. */
  CADUCADO: "caducado",
  /** El código consta en el panel, pero atado a OTRO equipo. */
  OTRO_EQUIPO: "otro-equipo",
  /** El equipo tiene un código vivo, pero no es este. */
  NO_COINCIDE: "no-coincide",
  /** El equipo no tiene código guardado (gastado o nunca generado). */
  SIN_CODIGO: "sin-codigo",
  /** No hay fila para ese nombre ni para la IP de origen. */
  SIN_EQUIPO: "sin-equipo",
} as const;

export type EstadoCodigo =
  (typeof ESTADO_CODIGO)[keyof typeof ESTADO_CODIGO];

export interface DiagnosticoCodigo {
  estado: EstadoCodigo;
  /** La frase lista para enseñar en el agente y en el registro. */
  detalle: string;
  /** Cuándo caduca el código de la fila, si lo hay. */
  expira: Date | null;
}

interface FilaConCodigo {
  id?: string;
  name: string;
  codigoEnrolamientoHash: string | null;
  codigoEnrolamientoExpira: Date | string | null;
}

/**
 * Clasifica un código presentado contra lo que el panel sabe:
 * la fila resuelta del equipo (por nombre/IP, ya fusionada),
 * si el hash presentado coincide con el de esa fila, y si ese
 * hash consta atado a otro equipo.
 */
export function diagnosticarCodigo(datos: {
  fila: FilaConCodigo | null;
  coincideConLaFila: boolean;
  duenoDelCodigo: { id?: string; name: string } | null;
  ahoraMs: number;
}): DiagnosticoCodigo {
  const { fila, coincideConLaFila, duenoDelCodigo, ahoraMs } = datos;
  const expira = fila?.codigoEnrolamientoExpira
    ? new Date(fila.codigoEnrolamientoExpira)
    : null;

  // El código consta, pero es de otra PC: el caso típico del
  // duplicado nombre/IP — se generó sobre la fila equivocada.
  // La comparación es por ID cuando se conoce: la resolución
  // puede haber RENOMBRADO la fila dueña (la «por IP» que
  // adopta el nombre real al reclamarse), y comparar por el
  // nombre de antes del renombrado la daría por «otra» siendo
  // la misma.
  const esDeOtro =
    duenoDelCodigo &&
    (!fila ||
      (duenoDelCodigo.id && fila.id
        ? duenoDelCodigo.id !== fila.id
        : duenoDelCodigo.name !== fila.name));
  if (esDeOtro && duenoDelCodigo) {
    return {
      estado: ESTADO_CODIGO.OTRO_EQUIPO,
      detalle:
        `Este código se generó para el equipo «${duenoDelCodigo.name}», ` +
        "no para esta PC. El agente se presenta con el nombre real de " +
        "su equipo: genera el código en Equipos para ese nombre exacto.",
      expira,
    };
  }

  if (!fila) {
    return {
      estado: ESTADO_CODIGO.SIN_EQUIPO,
      detalle:
        "El panel no tiene ningún equipo con este nombre (ni con la IP " +
        "de esta PC): el código no se puede emparejar. Genera el código " +
        "desde Equipos escribiendo el nombre exacto de esta PC.",
      expira: null,
    };
  }

  if (!fila.codigoEnrolamientoHash) {
    return {
      estado: ESTADO_CODIGO.SIN_CODIGO,
      detalle:
        `El equipo «${fila.name}» no tiene ningún código vigente en el ` +
        "panel: o ya se gastó (si este agente ya se enroló una vez, no " +
        "necesita otro), o se revocó la credencial, o nunca se generó. " +
        "Genera uno nuevo en Equipos → Credencial del equipo.",
      expira: null,
    };
  }

  if (!coincideConLaFila) {
    return {
      estado: ESTADO_CODIGO.NO_COINCIDE,
      detalle:
        `El equipo «${fila.name}» sí tiene un código vigente, pero no ` +
        "es este: casi seguro se generó otro después y este quedó " +
        "invalidado (cada código nuevo mata al anterior), o el código " +
        "pegado es de otra PC. Pide el código vigente en Equipos.",
      expira,
    };
  }

  if (expira && expira.getTime() < ahoraMs) {
    return {
      estado: ESTADO_CODIGO.CADUCADO,
      detalle:
        `El código de «${fila.name}» caducó el ` +
        `${expira.toLocaleString("es-ES")}: genera otro en Equipos ` +
        "(el de Equipos vale 30 minutos; el de una instalación remota, 12 horas).",
      expira,
    };
  }

  return {
    estado: ESTADO_CODIGO.VIGENTE,
    detalle:
      `El código es de «${fila.name}» y sigue vigente` +
      (expira ? ` hasta el ${expira.toLocaleString("es-ES")}` : "") +
      ": si se presenta al enrolar, el panel registrará la clave.",
    expira,
  };
}
