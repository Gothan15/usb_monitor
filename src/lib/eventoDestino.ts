/**
 * Destino de un aviso del centro de notificaciones: la referencia al
 * evento USB que lo originó, para poder saltar desde la campana al
 * registro de Eventos enseñando ese evento.
 *
 * El evento que llega por Socket.IO trae el `id` del registro tal y
 * como quedó guardado en la base de datos (la ruta de ingesta emite
 * el aviso con el id recién creado), así que la coincidencia
 * principal es por id exacto. La coincidencia de reserva (equipo +
 * tipo + dispositivo) cubre el caso de que el evento ya haya salido
 * de la ventana que enseña el registro (los últimos 50).
 */

export interface EventoDestino {
  /** Id del evento en la base de datos (el mismo que emite el socket). */
  eventoId: string;
  /** Equipo donde ocurrió. */
  pcName: string;
  /** Código crudo del tipo de evento («BLOCKED», «UNLOCKED»…). */
  tipo: string;
  /** Serial del dispositivo, si el evento lo trae. */
  serialNumber: string | null;
  /** Fecha del evento (ISO), para describir el destino en pantalla. */
  createdAt: string;
}

/** Forma mínima del evento que llega por Socket.IO. */
export interface EventoSocketMinimo {
  id: string;
  pcName: string;
  event: string;
  serialNumber?: string | null;
  createdAt: string;
}

/** Construye el destino de un aviso a partir de su evento de socket. */
export function destinoDesdeEventoSocket(
  evento: EventoSocketMinimo,
): EventoDestino {
  return {
    eventoId: evento.id,
    pcName: evento.pcName,
    tipo: evento.event,
    serialNumber: evento.serialNumber ?? null,
    createdAt: evento.createdAt,
  };
}

/** Forma mínima de una fila del registro de eventos. */
export interface EventoRegistroMinimo {
  id: string;
  pcName: string;
  event: string;
  serialNumber?: string | null;
}

export interface ResultadoFiltroDestino<T> {
  coincidencias: T[];
  /** true si la coincidencia fue por id exacto; false si fue la de reserva. */
  exacto: boolean;
}

function mismoTexto(a: string, b: string): boolean {
  return a.trim().toLowerCase() === b.trim().toLowerCase();
}

function mismoTipo(a: string, b: string): boolean {
  return a.trim().toUpperCase() === b.trim().toUpperCase();
}

/**
 * Filtra el registro para enseñar el evento de un aviso.
 *
 * Primero busca el id exacto: si está, es la única coincidencia.
 * Si el id ya no está entre los eventos cargados, cae al conjunto
 * mínimo que lo contiene: mismo equipo, mismo tipo y, cuando el
 * aviso trae serial, mismo dispositivo.
 */
export function filtrarEventosPorDestino<T extends EventoRegistroMinimo>(
  eventos: T[],
  destino: EventoDestino,
): ResultadoFiltroDestino<T> {
  const porId = eventos.filter((e) => e.id === destino.eventoId);
  if (porId.length > 0) {
    return { coincidencias: porId, exacto: true };
  }

  const deReserva = eventos.filter((e) => {
    if (!mismoTexto(e.pcName, destino.pcName)) return false;
    if (!mismoTipo(e.event, destino.tipo)) return false;
    if (destino.serialNumber) {
      if (!e.serialNumber) return false;
      if (!mismoTexto(e.serialNumber, destino.serialNumber)) return false;
    }
    return true;
  });
  return { coincidencias: deReserva, exacto: false };
}
