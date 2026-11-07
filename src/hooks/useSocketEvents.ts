"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { io, type Socket } from "socket.io-client";

/* ── Types ── */

export type ConnectionStatus = "connected" | "reconnecting" | "disconnected";

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

interface UseSocketEventsOptions {
  /** Callback fired on each new USB event. */
  onUSBEvent?: (event: SocketUSBEvent) => void;
  /** Callback fired on computer status change. */
  onComputerStatus?: (status: SocketComputerStatus) => void;
  /** Callback fired when whitelist changes. */
  onWhitelistChange?: () => void;
  /** Callback fired when users change. */
  onUserChange?: () => void;
  /** Callback fired when unlock-related state changes. */
  onUnlockChange?: () => void;
  /** Callback fired when an install task changes. */
  onInstallChange?: () => void;
  /** Callback fired when a computer's connected-USB set changes. */
  onUsbDevices?: (payload: { pcName: string }) => void;
  /** Disable the connection entirely. */
  enabled?: boolean;
}

/* ── Hook ── */

export function useSocketEvents({
  onUSBEvent,
  onComputerStatus,
  onWhitelistChange,
  onUserChange,
  onUnlockChange,
  onInstallChange,
  onUsbDevices,
  enabled = true,
}: UseSocketEventsOptions = {}) {
  const [statusInterno, setStatus] = useState<ConnectionStatus>("disconnected");
  // Sin conexión permitida, el estado visible es «desconectado»
  // aunque el interno conserve el último valor del socket.
  const status: ConnectionStatus = enabled ? statusInterno : "disconnected";
  const socketRef = useRef<Socket | null>(null);

  // Keep callback refs stable to avoid reconnect on handler change.
  const onUSBEventRef = useRef(onUSBEvent);
  const onComputerStatusRef = useRef(onComputerStatus);
  const onWhitelistChangeRef = useRef(onWhitelistChange);
  const onUserChangeRef = useRef(onUserChange);
  const onUnlockChangeRef = useRef(onUnlockChange);
  const onInstallChangeRef = useRef(onInstallChange);
  const onUsbDevicesRef = useRef(onUsbDevices);

  useEffect(() => {
    onUSBEventRef.current = onUSBEvent;
  }, [onUSBEvent]);
  useEffect(() => {
    onComputerStatusRef.current = onComputerStatus;
  }, [onComputerStatus]);
  useEffect(() => {
    onWhitelistChangeRef.current = onWhitelistChange;
  }, [onWhitelistChange]);
  useEffect(() => {
    onUserChangeRef.current = onUserChange;
  }, [onUserChange]);
  useEffect(() => {
    onUnlockChangeRef.current = onUnlockChange;
  }, [onUnlockChange]);

  useEffect(() => {
    onInstallChangeRef.current = onInstallChange;
  }, [onInstallChange]);

  useEffect(() => {
    onUsbDevicesRef.current = onUsbDevices;
  }, [onUsbDevices]);

  useEffect(() => {
    if (!enabled) {
      socketRef.current?.disconnect();
      socketRef.current = null;
      return;
    }

    const socket = io({
      path: "/api/socketio",
      transports: ["websocket", "polling"],
      reconnectionAttempts: Infinity,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 10000,
    });

    socketRef.current = socket;

    socket.on("connect", () => setStatus("connected"));

    socket.on("disconnect", () => setStatus("disconnected"));

    socket.on("reconnect_attempt", () => setStatus("reconnecting"));

    socket.on("reconnect", () => setStatus("connected"));

    socket.on("usb:event", (data: SocketUSBEvent) => {
      onUSBEventRef.current?.(data);
    });

    socket.on("computer:status", (data: SocketComputerStatus) => {
      onComputerStatusRef.current?.(data);
    });

    socket.on("whitelist:change", () => {
      onWhitelistChangeRef.current?.();
    });

    socket.on("user:change", () => {
      onUserChangeRef.current?.();
    });

    socket.on("unlock:change", () => {
      onUnlockChangeRef.current?.();
    });

    socket.on("install:change", () => {
      onInstallChangeRef.current?.();
    });

    socket.on("usb:devices", (data: { pcName: string }) => {
      onUsbDevicesRef.current?.(data);
    });

    return () => {
      socket.disconnect();
      socketRef.current = null;
    };
  }, [enabled]);

  const emit = useCallback((event: string, data?: unknown) => {
    socketRef.current?.emit(event, data);
  }, []);

  return { status, emit } as const;
}
