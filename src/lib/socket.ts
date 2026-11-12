import { Server } from "socket.io";
import { verifySessionFromRequest } from "./auth";
import { logInfo } from "./logger";

/* ── Singleton reference ──
   La instancia vive en globalThis: el servidor personalizado (server.ts)
   y las rutas de la API se cargan en registros de módulos distintos, así
   que una variable de módulo en la ruta quedaba siempre a null y los
   avisos en tiempo real nunca salían. */

type SocketGlobal = typeof globalThis & {
  __usbMonitorIO?: Server | null;
};

function setIO(io: Server | null): void {
  (globalThis as SocketGlobal).__usbMonitorIO = io;
}

function ioActual(): Server | null {
  return (globalThis as SocketGlobal).__usbMonitorIO ?? null;
}

/* ── Event types shared between server & client ── */

export interface SocketUSBEvent {
  id: string;
  pcName: string;
  pcIp: string;
  pcUser: string;
  unlockedBy?: string | null;
  event: string;
  driveLetter?: string | null;
  serialNumber?: string | null;
  readonlyStatus?: string | null;
  whitelisted?: boolean;
  timestamp: string;
  createdAt: string;
}

export interface SocketComputerStatus {
  name: string;
  ipAddress: string;
  isActive: boolean;
  lastSeen: string;
}

/* ── Broadcast helpers (called from API routes) ── */

export function broadcastUSBEvent(event: SocketUSBEvent): void {
  ioActual()?.emit("usb:event", event);
}

export function broadcastComputerStatus(status: SocketComputerStatus): void {
  ioActual()?.emit("computer:status", status);
}

export function broadcastWhitelistChange(): void {
  ioActual()?.emit("whitelist:change");
}

export function broadcastUserChange(): void {
  ioActual()?.emit("user:change");
}

/**
 * Aviso de que algo cambió en el mundo de los desbloqueos: un
 * bloqueo nuevo, un intento de contraseña, un cierre o una
 * entrega al agente. La pestaña Desbloqueos se refresca con
 * este empuje en vez de sondear.
 */
export function broadcastUnlockChange(): void {
  ioActual()?.emit("unlock:change");
}

/**
 * Aviso de que una tarea de instalación cambió (un destino
 * avanzó de estado o la tarea terminó). La vista de Tareas se
 * refresca con este empuje en vez de sondear.
 */
export function broadcastInstallChange(): void {
  ioActual()?.emit("install:change");
}

/**
 * Aviso de que el conjunto de USB conectados de un equipo cambió
 * (el agente lo reporta por connected-status y el servidor compara
 * antes de guardar). La hoja de «Ver USB» y el distintivo de
 * Equipos se refrescan con este empuje, como los eventos, en vez
 * de quedarse con la foto del momento en que se abrieron.
 */
export function broadcastUsbDevices(pcName: string): void {
  ioActual()?.emit("usb:devices", { pcName });
}

/* ── Setup ── */

export const setupSocket = (io: Server) => {
  setIO(io);

  // El canal en vivo también exige sesión: sin esta comprobación,
  // cualquier cliente que alcanzara el puerto recibía todos los
  // eventos (qué USB se conecta en qué PC, bloqueos, estados) sin
  // haber iniciado sesión. Se verifica la misma cookie «session»
  // del panel, con la misma función que usan las rutas de la API.
  io.use(async (socket, next) => {
    try {
      const cookie = socket.handshake.headers.cookie ?? "";
      const req = new Request("http://localhost", {
        headers: { cookie },
      });
      const sesion = await verifySessionFromRequest(req);
      if (!sesion) {
        return next(new Error("Sesión no válida"));
      }
      socket.data.usuario = sesion.username;
      return next();
    } catch {
      return next(new Error("Sesión no válida"));
    }
  });

  io.on("connection", (socket) => {
    logInfo("Cliente conectado al canal en vivo", { id: socket.id });

    socket.on("disconnect", () => {
      logInfo("Cliente desconectado del canal en vivo", { id: socket.id });
    });
  });
};
