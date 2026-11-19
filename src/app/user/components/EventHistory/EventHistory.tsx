"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Activity,
  Clock,
  Shield,
  Usb,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { useAmbientScrollbar } from "@/hooks/useAmbientScrollbar";
import { formatDateTime } from "@/lib/time";
import { cn } from "@/lib/utils";
import { etiquetaEventoUsb } from "@/lib/eventosUsb";
import { fetchBasicUserSnapshot } from "../../utils";
import type { UsbConnection, UsbEvent } from "../../types";
import { Spinner } from "@/components/ui/spinner";

interface EventHistoryProps {
  userId: string;
}

type TimelineRecord = {
  id: string;
  timestamp: string;
  kind: "connected" | "disconnected" | "event";
  title: string;
  description?: string;
  status?: string | null;
  serialNumber?: string;
  driveLetter?: string;
};

export const EventHistory = ({ userId }: EventHistoryProps) => {
  const [history, setHistory] = useState<UsbConnection[]>([]);
  const [events, setEvents] = useState<UsbEvent[]>([]);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const {
    containerProps: timelineScrollProps,
    scrollbarClassName: timelineScrollbarClassName,
  } = useAmbientScrollbar();

  // Sin botón de «Actualizar»: el sondeo de 15 s del efecto
  // de abajo mantiene el historial al día por sí solo y
  // reintenta tras un fallo. La recuperación inmediata vive
  // en el aviso de error, con su «Reintentar».
  const loadHistory = useCallback(
    async (signal?: AbortSignal) => {
      if (!userId) return;
      try {
        setLoading(true);
        setError(null);
        const snapshot = await fetchBasicUserSnapshot(userId, signal);
        setHistory(snapshot.usbHistory);
        setEvents(snapshot.events);
        setWarnings(snapshot.warnings ?? []);
      } catch (fetchError) {
        const message =
          fetchError instanceof Error
            ? fetchError.message
            : "No se pudo obtener el historial de eventos.";
        setError(message);
      } finally {
        setLoading(false);
      }
    },
    [userId]
  );

  useEffect(() => {
    if (!userId) return;
    const controller = new AbortController();
    // Diferida a una microtarea: los setState de la carga ocurren
    // en un contexto asíncrono, no en el cuerpo síncrono del efecto.
    queueMicrotask(() => {
      if (!controller.signal.aborted) void loadHistory(controller.signal);
    });
    const interval = setInterval(() => {
      const nextController = new AbortController();
      loadHistory(nextController.signal).catch(() => {});
    }, 15000);
    return () => {
      controller.abort();
      clearInterval(interval);
    };
  }, [loadHistory, userId]);

  const timeline = useMemo<TimelineRecord[]>(() => {
    const connectionItems = history.flatMap((connection) => {
      const entries: TimelineRecord[] = [
        {
          id: `${connection.id}-connected-${connection.connectedAt}`,
          timestamp: connection.connectedAt,
          kind: "connected",
          title: `Dispositivo ${connection.volumeName} conectado`,
          description: `${connection.driveLetter} • ${connection.model}`,
          serialNumber: connection.serialNumber,
        },
      ];
      if (connection.disconnectedAt) {
        entries.push({
          id: `${connection.id}-disconnected-${connection.disconnectedAt}`,
          timestamp: connection.disconnectedAt,
          kind: "disconnected",
          title: `Dispositivo ${connection.volumeName} desconectado`,
          description: `${connection.driveLetter} • ${connection.model}`,
          serialNumber: connection.serialNumber,
        });
      }
      return entries;
    });

    const serviceEvents = events.map<TimelineRecord>((event) => ({
      id: `service-${event.id}`,
      timestamp: event.createdAt,
      kind: "event",
      title: event.whitelisted
        ? "Dispositivo autorizado"
        : "Evento de seguridad",
      // La descripción llega como el código crudo del evento
      // (BLOCKED, UNLOCKED…): se enseña con la misma etiqueta
      // en español que usa el panel de administración.
      description: etiquetaEventoUsb(event.message),
      status: event.whitelisted
        ? "Autorizado"
        : event.readonlyStatus || "Pendiente",
      serialNumber: event.serialNumber || undefined,
      driveLetter: event.driveLetter || undefined,
    }));

    return [...connectionItems, ...serviceEvents].sort((a, b) => {
      const dateA = new Date(a.timestamp).getTime();
      const dateB = new Date(b.timestamp).getTime();
      return dateB - dateA;
    });
  }, [events, history]);

  return (
    <section className="w-full" data-tour="history-main">
      {/* ── Cabecera, como las del panel de administración ── */}
      <div className="flex flex-col">
        <p className="smallcaps text-acero">Tu actividad</p>
        <h2 className="font-display mt-2 text-2xl font-bold text-foreground">
          Historial de tu equipo
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Las conexiones, desconexiones y eventos de seguridad de los
          USB de tu equipo, de más reciente a más antiguo. Se actualiza
          solo cada pocos segundos.
        </p>
      </div>

      <div className="mt-8 space-y-4">
        {loading && (
          <div className="flex h-48 items-center justify-center">
            <Spinner />
          </div>
        )}

        {!loading && error && (
          <div className="flex flex-wrap items-center justify-between gap-3 border border-[#B3382E]/40 bg-[#B3382E]/[0.06] px-4 py-3 text-sm text-foreground">
            <span>{error}</span>
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => void loadHistory()}
            >
              Reintentar
            </Button>
          </div>
        )}

        {!loading && !error && !timeline.length && (
          <div className="flex items-start gap-3 border-t border-border pt-6 text-sm text-muted-foreground">
            <Clock className="mt-0.5 size-4 shrink-0 text-[var(--acero)]" />
            <div>
              <p>No hay eventos registrados todavía.</p>
              <p className="mt-1 text-xs">
                Los eventos aparecerán aquí cuando se registre actividad
                USB.
              </p>
            </div>
          </div>
        )}

        {!loading && !error && warnings.length > 0 && (
          <div className="space-y-2 border border-[#C09A3B]/50 bg-[#C09A3B]/10 px-4 py-3 text-sm text-foreground">
            {warnings.map((warning, index) => (
              <p key={index}>{warning}</p>
            ))}
          </div>
        )}

        {!loading && !error && !!timeline.length && (
          <div
            {...timelineScrollProps}
            className={cn(
              "max-h-[520px] overflow-y-auto pr-2 scroll-smooth",
              timelineScrollbarClassName
            )}
            data-tour="user-history"
          >
            <div className="border-t border-border">
              {timeline.map((item) => (
                <article
                  key={item.id}
                  className="flex flex-col gap-2 border-b border-border py-4 md:flex-row md:items-start md:justify-between"
                >
                  <div className="flex items-start gap-3">
                    <span className="mt-0.5 text-[var(--acero)]">
                      {item.kind === "event" ? (
                        <Shield className="h-5 w-5" />
                      ) : item.kind === "connected" ? (
                        <Usb className="h-5 w-5" />
                      ) : (
                        <Activity className="h-5 w-5" />
                      )}
                    </span>
                    <div>
                      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                        <h3 className="text-[0.95rem] font-semibold text-foreground">
                          {item.title}
                        </h3>
                        {item.kind === "event" && item.status && (
                          <span className="smallcaps text-acero">
                            {item.status}
                          </span>
                        )}
                      </div>
                      {item.description && (
                        <p className="mt-1 text-sm text-muted-foreground">
                          {item.description}
                        </p>
                      )}
                      {(item.serialNumber || item.driveLetter) && (
                        <p className="mt-1 flex flex-wrap gap-x-2 text-xs text-muted-foreground">
                          {item.serialNumber && (
                            <span className="font-mono uppercase">
                              {item.serialNumber}
                            </span>
                          )}
                          {item.serialNumber && item.driveLetter && (
                            <span aria-hidden>·</span>
                          )}
                          {item.driveLetter && (
                            <span>Unidad {item.driveLetter}</span>
                          )}
                        </p>
                      )}
                    </div>
                  </div>
                  <p className="shrink-0 pl-8 text-xs text-muted-foreground md:pl-0 md:pt-1 md:text-right">
                    {formatDateTime(item.timestamp)}
                  </p>
                </article>
              ))}
            </div>
          </div>
        )}
      </div>
    </section>
  );
};
