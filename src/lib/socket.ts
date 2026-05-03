import { Server } from "socket.io";
import { getCurrentIsoString } from "./time";

/* ── Singleton reference ── */

let _io: Server | null = null;

/** Returns the Socket.IO server instance (null before `setupSocket` is called). */
export function getIO(): Server | null {
  return _io;
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
  _io?.emit("usb:event", event);
}

export function broadcastComputerStatus(status: SocketComputerStatus): void {
  _io?.emit("computer:status", status);
}

export function broadcastWhitelistChange(): void {
  _io?.emit("whitelist:change");
}

/* ── Setup ── */

export const setupSocket = (io: Server) => {
  _io = io;

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
