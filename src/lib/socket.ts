import { Server } from "socket.io";
import { getCurrentIsoString } from "./time";

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

/** Returns the Socket.IO server instance (null before `setupSocket` is called). */
export function getIO(): Server | null {
  return ioActual();
}

/* ── Event types shared between server & client ── */

export interface SocketUSBEvent {
  id: string;
  pcName: string;
  pcIp: string;
  pcUser: string;
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

  io.on("connection", (socket) => {
    console.log("Client connected:", socket.id);

    socket.on("message", (msg: { text: string; senderId: string }) => {
      socket.emit("message", {
        text: `Echo: ${msg.text}`,
        senderId: "system",
        timestamp: getCurrentIsoString(),
      });
    });

    socket.on("disconnect", () => {
      console.log("Client disconnected:", socket.id);
    });

    socket.emit("welcome", {
      message: "Conectado al centro de control",
      timestamp: getCurrentIsoString(),
    });
  });
};
