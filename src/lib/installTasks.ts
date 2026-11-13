/**
 * Tareas de instalación (fase D): constantes y reglas puras.
 * La ejecución vive en installExecutor.ts; esto es solo el
 * vocabulario compartido entre el ejecutor, las rutas y la
 * vista, para poder probarlo sin procesos ni base de datos.
 */

export const ESTADO_TAREA = {
  EN_CURSO: "EN_CURSO",
  COMPLETADA: "COMPLETADA",
  CON_ERRORES: "CON_ERRORES",
} as const;

export const ESTADO_DESTINO = {
  EN_COLA: "EN_COLA",
  COMPROBANDO: "COMPROBANDO",
  COPIANDO: "COPIANDO",
  INSTALANDO: "INSTALANDO",
  ESPERANDO_SENAL: "ESPERANDO_SENAL",
  INSTALADO: "INSTALADO",
  OMITIDO: "OMITIDO",
  ERROR: "ERROR",
  INTERRUMPIDO: "INTERRUMPIDO",
} as const;

export type EstadoDestino =
  (typeof ESTADO_DESTINO)[keyof typeof ESTADO_DESTINO];

export const METODO = {
  EMPUJE: "EMPUJE",
  AGENTE: "AGENTE",
} as const;

export type MetodoInstalacion = (typeof METODO)[keyof typeof METODO];

/** Estados de destino que ya no se mueven solos. */
export const ESTADOS_DESTINO_FINALES: EstadoDestino[] = [
  ESTADO_DESTINO.INSTALADO,
  ESTADO_DESTINO.OMITIDO,
  ESTADO_DESTINO.ERROR,
  ESTADO_DESTINO.INTERRUMPIDO,
];

/** Cuántas instalaciones corren a la vez en todo el panel. */
export const CONCURRENCIA_INSTALACION = 2;

/** Datos mínimos de un equipo para decidir por dónde se instala. */
export interface DatosMetodo {
  /** Última señal del agente (null si nunca ha reportado). */
  lastSeen: Date | string | null;
  /** El equipo tiene credencial de agente registrada (su clave). */
  tieneCredencial: boolean;
  /** Ahora, inyectable para las pruebas. */
  ahora: number;
  /** Umbral de silencio del método 3 en ms (mínimo 2 minutos). */
  umbralMs: number;
}

/**
 * Método de un destino: AGENTE si el equipo ya reporta dentro
 * del umbral de silencio (el canal llega sin empujar ni pedir
 * credenciales al destino); EMPUJE en cualquier otro caso.
 */
export function resolverMetodo(datos: DatosMetodo): MetodoInstalacion {
  if (!datos.tieneCredencial || !datos.lastSeen) return METODO.EMPUJE;
  const ultima = new Date(datos.lastSeen).getTime();
  if (Number.isNaN(ultima)) return METODO.EMPUJE;
  return datos.ahora - ultima <= datos.umbralMs
    ? METODO.AGENTE
    : METODO.EMPUJE;
}

/** Credencial efectiva para empujar a un destino. */
export interface CredencialDestino {
  usuario: string;
  clave: string;
}

/**
 * Ajuste opcional de credencial para UN destino concreto:
 * lo que traiga manda sobre la credencial general de la
 * tarea solo para ese equipo.
 */
export interface AjusteCredencialDestino {
  usuario?: string;
  clave?: string;
}

/**
 * La credencial con la que se empuja a un destino: la
 * general de la tarea, salvo que ese destino traiga la suya.
 * Así una misma tarea puede instalar a la vez en equipos con
 * contraseñas de administrador distintas, sin fallar en los
 * que no coinciden con la general.
 */
export function resolverCredencialDestino(
  base: CredencialDestino,
  ajuste?: AjusteCredencialDestino | null,
): CredencialDestino {
  if (!ajuste) return base;
  return {
    usuario: ajuste.usuario?.trim() ? ajuste.usuario.trim() : base.usuario,
    clave: ajuste.clave ? ajuste.clave : base.clave,
  };
}

/** Estado final de la tarea según cómo acabaron sus destinos. */
export function estadoFinalTarea(
  estados: string[],
): typeof ESTADO_TAREA.COMPLETADA | typeof ESTADO_TAREA.CON_ERRORES {
  const algunoMal = estados.some(
    (e) => e === ESTADO_DESTINO.ERROR || e === ESTADO_DESTINO.INTERRUMPIDO,
  );
  return algunoMal ? ESTADO_TAREA.CON_ERRORES : ESTADO_TAREA.COMPLETADA;
}

/** Etapa de progreso del empujador → estado del destino. */
export function estadoDesdeEtapaEmpujador(etapa: string): EstadoDestino {
  switch (etapa) {
    case "copia":
      return ESTADO_DESTINO.COPIANDO;
    case "servicio":
      return ESTADO_DESTINO.INSTALANDO;
    case "conexion":
    default:
      return ESTADO_DESTINO.COMPROBANDO;
  }
}

/** Etiqueta legible de cada estado de destino, para la vista. */
export const ETIQUETA_ESTADO_DESTINO: Record<string, string> = {
  EN_COLA: "En cola",
  COMPROBANDO: "Comprobando",
  COPIANDO: "Copiando",
  INSTALANDO: "Instalando",
  ESPERANDO_SENAL: "Esperando señal",
  INSTALADO: "Instalado",
  OMITIDO: "Omitido",
  ERROR: "Error",
  INTERRUMPIDO: "Interrumpido",
};

/**
 * ¿Se puede borrar una tarea? Solo si ya terminó de verdad:
 * la tarea no está EN_CURSO, el ejecutor no la tiene entre
 * manos en este proceso y NINGÚN destino sigue en un estado
 * en curso. Borrar una tarea viva dejaría procesos empujando
 * contra filas que ya no existen; para esas, primero hay que
 * dejar que acaben (o que el panel las marque interrumpidas
 * al reiniciar).
 */
export function tareaPuedeBorrarse(datos: {
  status: string;
  estadosDestinos: string[];
  enEjecucion: boolean;
}): boolean {
  if (datos.enEjecucion) return false;
  if (datos.status === ESTADO_TAREA.EN_CURSO) return false;
  return datos.estadosDestinos.every((e) =>
    (ESTADOS_DESTINO_FINALES as string[]).includes(e),
  );
}
