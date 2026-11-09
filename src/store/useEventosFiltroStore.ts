import { create } from "zustand";
import type { EventoDestino } from "@/lib/eventoDestino";

/**
 * Filtro pendiente para la pestaña de Eventos.
 *
 * La campana de notificaciones vive en el armazón (por encima de las
 * páginas) y el registro es una página aparte: este store mínimo es
 * el puente entre ambos. Al pulsar un aviso se deja aquí su destino
 * y se navega a Eventos; la pestaña lo consume de forma reactiva
 * (también si el aviso se pulsa estando ya en Eventos) y lo mantiene
 * hasta que el usuario pide ver todo el registro.
 *
 * Sin persistencia: es una intención de navegación del momento, no
 * una preferencia; al recargar la página no debe reaparecer.
 */
interface EventosFiltroState {
  destinoPendiente: EventoDestino | null;
  solicitarDestino: (destino: EventoDestino) => void;
  limpiarDestino: () => void;
}

export const useEventosFiltroStore = create<EventosFiltroState>()((set) => ({
  destinoPendiente: null,
  solicitarDestino: (destino) => set({ destinoPendiente: destino }),
  limpiarDestino: () => set({ destinoPendiente: null }),
}));
