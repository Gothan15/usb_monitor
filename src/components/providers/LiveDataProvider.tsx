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
import { useQueryClient } from "@tanstack/react-query";
import {
  useSocketEvents,
  type ConnectionStatus,
  type SocketUSBEvent,
} from "@/hooks/useSocketEvents";

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

  const onUSBEvent = useCallback(
    (event: SocketUSBEvent) => {
      // Append to local live feed
      setLiveEvents((prev) => [event, ...prev].slice(0, MAX_LIVE_EVENTS));
      eventCountRef.current += 1;
      setLiveEventCount(eventCountRef.current);

      // Invalidate React Query caches so tables/stats refresh
      void queryClient.invalidateQueries({ queryKey: ["events"] });
      void queryClient.invalidateQueries({ queryKey: ["computers"] });
    },
    [queryClient],
  );

  const onComputerStatus = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: ["computers"] });
  }, [queryClient]);

  const onWhitelistChange = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: ["whitelist"] });
  }, [queryClient]);

  const { status } = useSocketEvents({
    onUSBEvent,
    onComputerStatus,
    onWhitelistChange,
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
