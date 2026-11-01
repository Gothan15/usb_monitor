"use client";

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useQueryClient, type QueryClient } from "@tanstack/react-query";
import {
  useSocketEvents,
  type ConnectionStatus,
  type SocketUSBEvent,
} from "@/hooks/useSocketEvents";
import { useLiveSyncStore } from "@/store/useLiveSyncStore";
import { emitNotification } from "@/lib/notificationBus";
import { Usb } from "lucide-react";

/* ── Context types ── */

interface LiveDataContextValue {
  /** Socket.IO connection status */
  connectionStatus: ConnectionStatus;
  /** Recent live events (last 50, newest first) */
  liveEvents: SocketUSBEvent[];
  /** Count of events received since page load */
  liveEventCount: number;
  /** Clear the live events buffer */
  clearLiveEvents: () => void;
}

const LiveDataContext = createContext<LiveDataContextValue | null>(null);

/* ── Provider ── */

const MAX_LIVE_EVENTS = 50;

function createDebouncedInvalidator(queryClient: QueryClient, delay: number) {
  const pendingKeys = new Set<string>();
  let timeout: ReturnType<typeof setTimeout> | null = null;

  return (queryKey: string[]) => {
    pendingKeys.add(JSON.stringify(queryKey));
    if (timeout) clearTimeout(timeout);
    timeout = setTimeout(() => {
      const keys = Array.from(pendingKeys).map((k) => JSON.parse(k) as string[]);
      pendingKeys.clear();
      keys.forEach((key) => {
        void queryClient.invalidateQueries({ queryKey: key });
      });
    }, delay);
  };
}

interface LiveDataProviderProps {
  children: ReactNode;
  /** Disable socket connection (useful during initial loading) */
  enabled?: boolean;
}

export function LiveDataProvider({
  children,
  enabled = true,
}: LiveDataProviderProps) {
  const queryClient = useQueryClient();
  const [liveEvents, setLiveEvents] = useState<SocketUSBEvent[]>([]);
  const eventCountRef = useRef(0);
  const [liveEventCount, setLiveEventCount] = useState(0);

  const notificadosRef = useRef<Set<string>>(new Set());

  const invalidatorRef = useRef<ReturnType<typeof createDebouncedInvalidator> | null>(null);
  if (!invalidatorRef.current) {
    invalidatorRef.current = createDebouncedInvalidator(queryClient, 3000);
  }
  const debouncedInvalidate = invalidatorRef.current;

  const onUSBEvent = useCallback(
    (event: SocketUSBEvent) => {
      // Append to local live feed
      setLiveEvents((prev) => [event, ...prev].slice(0, MAX_LIVE_EVENTS));

      // Avisos del centro de notificaciones: solo lo que importa
      // (bloqueos y USB sin autorizar; lo autorizado es rutina).
      if (event.id && !notificadosRef.current.has(event.id)) {
        const esBloqueo = event.event.toUpperCase().includes("BLOCK");
        const esDesbloqueo = event.event.toUpperCase().includes("UNLOCK");
        if (esBloqueo || esDesbloqueo || event.whitelisted === false) {
          notificadosRef.current.add(event.id);
          if (notificadosRef.current.size > 200) {
            notificadosRef.current = new Set(
              Array.from(notificadosRef.current).slice(-100),
            );
          }
          const detalle =
            [event.serialNumber, event.driveLetter ? `Unidad ${event.driveLetter}` : null]
              .filter(Boolean)
              .join(" · ") || undefined;
          if (esDesbloqueo) {
            emitNotification({
              title: `USB desbloqueado en ${event.pcName}`,
              description: detalle,
              icon: Usb,
              tone: "success",
            });
          } else {
            emitNotification({
              title: esBloqueo
                ? `USB bloqueado en ${event.pcName}`
                : `USB sin autorizar en ${event.pcName}`,
              description: detalle,
              icon: Usb,
              tone: esBloqueo ? "danger" : "warning",
            });
          }
        }
      }
      eventCountRef.current += 1;
      setLiveEventCount(eventCountRef.current);

      if (useLiveSyncStore.getState().isLiveSyncEnabled) {
        debouncedInvalidate(["events"]);
        debouncedInvalidate(["computers"]);
      }
    },
    [debouncedInvalidate],
  );

  const onComputerStatus = useCallback(() => {
    if (useLiveSyncStore.getState().isLiveSyncEnabled) {
      debouncedInvalidate(["computers"]);
    }
  }, [debouncedInvalidate]);

  const onWhitelistChange = useCallback(() => {
    if (useLiveSyncStore.getState().isLiveSyncEnabled) {
      debouncedInvalidate(["whitelist"]);
    }
  }, [debouncedInvalidate]);

  const onUserChange = useCallback(() => {
    if (useLiveSyncStore.getState().isLiveSyncEnabled) {
      debouncedInvalidate(["users", "summary"]);
    }
  }, [debouncedInvalidate]);

  const { status } = useSocketEvents({
    onUSBEvent,
    onComputerStatus,
    onWhitelistChange,
    onUserChange,
    enabled,
  });

  const clearLiveEvents = useCallback(() => {
    setLiveEvents([]);
    eventCountRef.current = 0;
    setLiveEventCount(0);
  }, []);

  const value = useMemo<LiveDataContextValue>(
    () => ({
      connectionStatus: status,
      liveEvents,
      liveEventCount,
      clearLiveEvents,
    }),
    [status, liveEvents, liveEventCount, clearLiveEvents],
  );

  return (
    <LiveDataContext.Provider value={value}>
      {children}
    </LiveDataContext.Provider>
  );
}

/* ── Hook ── */

export function useLiveData(): LiveDataContextValue {
  const ctx = useContext(LiveDataContext);
  if (!ctx) {
    throw new Error("useLiveData debe usarse dentro de <LiveDataProvider>");
  }
  return ctx;
}
