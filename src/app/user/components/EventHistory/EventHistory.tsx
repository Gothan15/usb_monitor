"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Activity,
  Calendar,
  Clock,
  RefreshCw,
  Shield,
  Usb,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Separator } from "@/components/ui/separator";
import { useToast } from "@/hooks/use-toast";
import { useAmbientScrollbar } from "@/hooks/useAmbientScrollbar";
import { formatDateTime } from "@/lib/time";
import { cn } from "@/lib/utils";
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
  const { toast } = useToast();
  const [history, setHistory] = useState<UsbConnection[]>([]);
  const [events, setEvents] = useState<UsbEvent[]>([]);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const {
    containerProps: timelineScrollProps,
    scrollbarClassName: timelineScrollbarClassName,
  } = useAmbientScrollbar();

  const loadHistory = useCallback(
    async (signal?: AbortSignal, manual = false) => {
      if (!userId) return;
      try {
        if (manual) {
          setRefreshing(true);
        } else {
          setLoading(true);
        }
        setError(null);
        const snapshot = await fetchBasicUserSnapshot(userId, signal);
        setHistory(snapshot.usbHistory);
        setEvents(snapshot.events);
        setWarnings(snapshot.warnings ?? []);
        if (manual) {
          toast({
            title: "Historial actualizado",
            description: "Los eventos se sincronizaron correctamente.",
          });
        }
      } catch (fetchError) {
        const message =
          fetchError instanceof Error
            ? fetchError.message
            : "No se pudo obtener el historial de eventos.";
        setError(message);
        if (manual) {
          toast({
            title: "Error al actualizar",
            description: message,
            variant: "destructive",
          });
        }
      } finally {
        if (manual) {
          setRefreshing(false);
        } else {
          setLoading(false);
        }
      }
    },
    [toast, userId]
  );

  useEffect(() => {
    if (!userId) return;
    const controller = new AbortController();
    loadHistory(controller.signal);
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
      description: event.message,
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
    <Card className="border-border/60 bg-card/80 shadow-sm backdrop-blur-xl">
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle className="flex items-center gap-2 text-lg text-foreground">
          <Clock className="h-5 w-5 text-muted-foreground" />
          Historial de eventos
        </CardTitle>
        <Button
          type="button"
          size="sm"
          variant="outline"
          className="inline-flex items-center gap-2 border-border/60 text-xs font-semibold text-muted-foreground transition-colors hover:bg-muted/50"
          disabled={refreshing}
          onClick={() => loadHistory(undefined, true)}
        >
          {refreshing ? (
            <div className="mr-2">
              <Spinner size={16} />
            </div>
          ) : (
            <RefreshCw className="mr-2 h-4 w-4 text-muted-foreground" />
          )}
          {refreshing ? "Actualizando..." : "Actualizar"}
        </Button>
      </CardHeader>
      <CardContent className="space-y-4">
        {loading && (
          <div className="flex h-48 items-center justify-center">
            <Spinner />
          </div>
        )}

        {!loading && error && (
          <Alert className="border-red-200 bg-red-50 text-red-900 dark:border-red-700 dark:bg-red-950/20 dark:text-red-100">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}

        {!loading && !error && !timeline.length && (
          <div className="flex h-48 flex-col items-center justify-center gap-2 text-center text-sm text-muted-foreground">
            <Clock className="h-10 w-10 text-muted-foreground/40" />
            <span>No hay eventos registrados todavía.</span>
            <span className="text-xs text-muted-foreground/60">
              Los eventos aparecerán aquí cuando se registre actividad USB.
            </span>
          </div>
        )}

        {!loading && !error && warnings.length > 0 && (
          <Alert className="border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-500/40 dark:bg-amber-500/10 dark:text-amber-100">
            <AlertDescription className="space-y-2">
              {warnings.map((warning, index) => (
                <p key={index}>{warning}</p>
              ))}
            </AlertDescription>
          </Alert>
        )}

        {!loading && !error && !!timeline.length && (
          <div
            {...timelineScrollProps}
            className={cn(
              "max-h-[520px] space-y-3 overflow-y-auto pr-2 scroll-smooth",
              timelineScrollbarClassName
            )}
          >
            {timeline.map((item, index) => (
              <div
                key={item.id}
                className="group animate-in fade-in-50 slide-in-from-bottom-2 duration-300 rounded-xl border border-border/40 bg-card/80 p-4 shadow-sm transition-all hover:-translate-y-0.5 hover:shadow-md backdrop-blur-sm"
                style={{ animationDelay: `${index * 70}ms` }}
              >
                <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                  <div className="flex items-start gap-3">
                    <div className="rounded-lg bg-muted/40 p-3 text-muted-foreground transition-colors group-hover:bg-muted/60">
                      {item.kind === "event" ? (
                        <Shield className="h-5 w-5" />
                      ) : item.kind === "connected" ? (
                        <Usb className="h-5 w-5" />
                      ) : (
                        <Activity className="h-5 w-5" />
                      )}
                    </div>
                    <div className="space-y-2">
                      <div className="flex flex-wrap items-center gap-2">
                        <h3 className="text-base font-semibold text-foreground">
                          {item.title}
                        </h3>
                        {item.kind === "event" && item.status && (
                          <Badge
                            variant="outline"
                            className="border-border/40 text-xs text-muted-foreground"
                          >
                            {item.status}
                          </Badge>
                        )}
                        {item.serialNumber && (
                          <Badge
                            variant="outline"
                            className="border-border/40 text-xs font-mono uppercase text-muted-foreground"
                          >
                            {item.serialNumber}
                          </Badge>
                        )}
                        {item.driveLetter && (
                          <Badge
                            variant="secondary"
                            className="text-xs uppercase tracking-[0.18em]"
                          >
                            {item.driveLetter}
                          </Badge>
                        )}
                      </div>
                      {item.description && (
                        <p className="text-sm text-muted-foreground">
                          {item.description}
                        </p>
                      )}
                    </div>
                  </div>
                  <div className="flex shrink-0 items-center gap-2 rounded-lg border border-border/40 bg-muted/30 px-3 py-1.5 text-xs font-medium text-muted-foreground transition-colors">
                    <Calendar className="h-4 w-4" />
                    {formatDateTime(item.timestamp)}
                  </div>
                </div>
                {index < timeline.length - 1 && <Separator className="mt-3" />}
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
};
