import { logInfo } from "./logger";

/**
 * Depuración de la comunicación agente ↔ servidor (2026-11-01).
 *
 * Gothan reporta que el agente «no se comunica bien» con el servidor
 * y sospecha que el servicio se detiene solo. Para poder verlo sin
 * adivinar, cada ruta que habla con el agente registra aquí su
 * contacto (PC, ruta, código HTTP final) y, con la variable de
 * entorno USB_MONITOR_DEBUG=1, el servidor imprime en consola una
 * línea por contacto y un latido cada segundo con el resumen por PC:
 * hace cuánto fue el último contacto, su última ruta/estado y el
 * total de contactos. Si el latido deja de avanzar para una PC, el
 * agente dejó de llamar (servicio parado, compañero cerrado o red).
 *
 * El estado vive en globalThis por la misma razón que la instancia
 * de Socket.IO en socket.ts: server.ts y las rutas de la API se
 * cargan en registros de módulos distintos y una variable de módulo
 * normal no se compartiría entre ellos.
 */

export interface ContactoAgente {
  pc: string;
  ultimaRuta: string;
  ultimoEstado: number;
  ultimoContacto: Date;
  contactos: number;
}

type AgentDebugGlobal = typeof globalThis & {
  __usbMonitorAgentDebug?: {
    contactos: Map<string, ContactoAgente>;
    latido: ReturnType<typeof setInterval> | null;
  };
};

function estadoGlobal() {
  const g = globalThis as AgentDebugGlobal;
  if (!g.__usbMonitorAgentDebug) {
    g.__usbMonitorAgentDebug = { contactos: new Map(), latido: null };
  }
  return g.__usbMonitorAgentDebug;
}

/** true si el modo depuración está activo (USB_MONITOR_DEBUG=1). */
export function depuracionAgenteActiva(): boolean {
  return process.env.USB_MONITOR_DEBUG === "1";
}

/**
 * Registra un contacto del agente con el servidor. `pc` puede venir
 * vacío (rutas sin nombre de equipo, p. ej. agent/config): se guarda
 * bajo «?» para que el latido también cuente esos contactos.
 */
export function registrarContactoAgente(
  pc: string | null | undefined,
  ruta: string,
  estado: number
): void {
  const nombre = typeof pc === "string" && pc.trim() ? pc.trim() : "?";
  const { contactos } = estadoGlobal();
  const previo = contactos.get(nombre);
  contactos.set(nombre, {
    pc: nombre,
    ultimaRuta: ruta,
    ultimoEstado: estado,
    ultimoContacto: new Date(),
    contactos: (previo?.contactos ?? 0) + 1,
  });
  if (depuracionAgenteActiva()) {
    logInfo(`[AGENTE] ${nombre} ${ruta} -> ${estado}`);
  }
}

/** Copia del mapa de contactos (lectura para tests y diagnóstico). */
export function contactosAgente(): ContactoAgente[] {
  return [...estadoGlobal().contactos.values()].map((c) => ({ ...c }));
}

/**
 * Arranca el latido de depuración: cada segundo imprime una línea
 * [AGENTE-LATIDO] con el estado por PC. Solo actúa si el modo
 * depuración está activo; sin él no imprime nada ni crea timers.
 * Idempotente: llamadas repetidas no duplican el intervalo.
 * Devuelve una función de parada.
 */
export function iniciarLatidoDepuracionAgente(): () => void {
  const estado = estadoGlobal();
  if (!depuracionAgenteActiva() || estado.latido) {
    return () => undefined;
  }

  estado.latido = setInterval(() => {
    const ahora = Date.now();
    const lista = contactosAgente();
    if (lista.length === 0) {
      logInfo("[AGENTE-LATIDO] sin contactos de agentes todavía");
      return;
    }
    const partes = lista
      .sort((a, b) => a.pc.localeCompare(b.pc))
      .map((c) => {
        const haceSeg = Math.max(
          0,
          Math.round((ahora - c.ultimoContacto.getTime()) / 1000)
        );
        return `${c.pc}: último contacto hace ${haceSeg}s (${c.ultimaRuta} -> ${c.ultimoEstado}), ${c.contactos} contactos`;
      });
    logInfo(`[AGENTE-LATIDO] ${partes.join(" | ")}`);
  }, 1000);
  // No bloquear la salida del proceso por un timer de diagnóstico.
  estado.latido.unref?.();

  return () => {
    if (estado.latido) {
      clearInterval(estado.latido);
      estado.latido = null;
    }
  };
}
