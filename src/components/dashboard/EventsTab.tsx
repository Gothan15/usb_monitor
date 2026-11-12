"use client";

import { useMemo } from "react";
import { motion } from "framer-motion";
import {
  Table,
  TableBody,
  TableCell,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { ScrollArea, ScrollBar } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { ShieldCheck, Siren, Trash2, Usb, X } from "lucide-react";
import { Spinner } from "@/components/ui/spinner";
import { cn } from "@/lib/utils";
import { etiquetaEventoUsb, etiquetaCapaBloqueo } from "@/lib/eventosUsb";
import { filtrarEventosPorDestino } from "@/lib/eventoDestino";
import { useEventosFiltroStore } from "@/store/useEventosFiltroStore";
import { USBEvent, formatDate, formatTime } from "./types";

/* «hace 5 min» para leer el registro de un vistazo. */
function haceCuanto(iso: string): string {
  const segundos = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (segundos < 60) return "ahora mismo";
  const minutos = Math.floor(segundos / 60);
  if (minutos < 60) return `hace ${minutos} min`;
  const horas = Math.floor(minutos / 60);
  if (horas < 24) return `hace ${horas} h`;
  const dias = Math.floor(horas / 24);
  return dias === 1 ? "hace 1 día" : `hace ${dias} días`;
}
import { DashboardPagination } from "./DashboardPagination";
import { usePagination } from "@/hooks/usePagination";
import { useTableSort } from "@/hooks/useTableSort";
import { SortableTableHead } from "./SortableTableHead";

interface Props {
  events: USBEvent[];
  loading: boolean;
  onClear?: () => void;
  clearing?: boolean;
}

export function EventsTab({ events, loading, onClear, clearing }: Props) {
  // Destino dejado por la campana de notificaciones: si hay uno, el
  // registro se enseña filtrado a ese evento hasta que el usuario
  // pide ver todo. Se consume del store de forma reactiva, así
  // funciona tanto al navegar desde otra pestaña como al pulsar un
  // aviso estando ya en Eventos.
  const destinoPendiente = useEventosFiltroStore((s) => s.destinoPendiente);
  const limpiarDestino = useEventosFiltroStore((s) => s.limpiarDestino);

  const filtroDestino = useMemo(
    () =>
      destinoPendiente
        ? filtrarEventosPorDestino(events, destinoPendiente)
        : null,
    [events, destinoPendiente],
  );
  const eventosVisibles = filtroDestino ? filtroDestino.coincidencias : events;

  const { page, pageSize, setPage, setPageSize } = usePagination({
    totalItems: eventosVisibles.length,
  });

  const classifyEvent = (event: USBEvent) => {
    const normalized = event.event.toLowerCase();
    const code = event.event.trim().toUpperCase();
    const readonly = (event.readonlyStatus || "").toLowerCase();
    // El tono sale del TIPO de evento, no de la lista blanca:
    // que un dispositivo esté en la lista no convierte su
    // conexión en un desbloqueo (antes, cualquier evento de un
    // dispositivo listado se pintaba como éxito y contaba como
    // desbloqueo en el resumen de arriba).
    const isUnlock =
      code === "UNLOCKED" ||
      code === "EMERGENCY_UNLOCK" ||
      normalized.includes("readonly removido") ||
      normalized.includes("desbloqueada") ||
      normalized.includes("desbloqueado") ||
      readonly.includes("removido");
    const isError =
      code === "UNLOCK_RELEASE_FAILED" ||
      code === "UNLOCK_ATTEMPT_FAILED" ||
      (code === "BLOCKED" && !event.whitelisted) ||
      normalized.includes("error") ||
      normalized.includes("fallo") ||
      normalized.includes("denegado");

    if (isUnlock) {
      return {
        badgeVariant: "success" as const,
        rowClassName:
          "bg-emerald-50/60 dark:bg-emerald-500/10 transition-colors",
        tone: "success" as const,
      };
    }

    if (isError) {
      return {
        badgeVariant: "destructive" as const,
        rowClassName: "bg-red-50/70 dark:bg-red-500/10 transition-colors",
        tone: "error" as const,
      };
    }

    return {
      badgeVariant: "default" as const,
      rowClassName: "",
      tone: "neutral" as const,
    };
  };

  const quickStats = useMemo(() => {
    if (loading) {
      return [
        {
          label: "Eventos",
          value: "--",
          accent: "from-purple-400/30",
          icon: <Usb className="size-4" />,
        },
        {
          label: "Desbloqueos",
          value: "--",
          accent: "from-[oklch(0.75_0.12_160/0.25)]",
          icon: <ShieldCheck className="size-4" />,
        },
        {
          label: "Alertas",
          value: "--",
          accent: "from-rose-400/25",
          icon: <Siren className="size-4" />,
        },
      ];
    }

    const total = events.length;
    const unlocks = events.filter(
      (event) => classifyEvent(event).tone === "success",
    ).length;
    const alerts = events.filter(
      (event) => classifyEvent(event).tone === "error",
    ).length;

    return [
      {
        label: "Eventos",
        value: total.toString(),
        accent:
          "from-[oklch(0.70_0.05_280/0.20)] via-[oklch(0.65_0.04_280/0.08)]",
        icon: <Usb className="size-4" />,
      },
      {
        label: "Desbloqueos",
        value: unlocks.toString(),
        accent:
          "from-[oklch(0.75_0.12_160/0.25)] via-[oklch(0.80_0.08_160/0.10)]",
        icon: <ShieldCheck className="size-4" />,
      },
      {
        label: "Alertas",
        value: alerts.toString(),
        accent: "from-rose-400/30 via-[oklch(0.80_0.10_85/0.10)]",
        icon: <Siren className="size-4" />,
      },
    ];
  }, [events, loading]);

  const { sortedData, sortConfig, requestSort } =
    useTableSort<USBEvent>(eventosVisibles);

  const paginatedEvents = useMemo(() => {
    if (sortedData.length === 0) return [];
    const start = (page - 1) * pageSize;
    return sortedData.slice(start, start + pageSize);
  }, [sortedData, page, pageSize]);

  const handleClear = () => {
    if (!onClear) return;
    onClear();
  };

  const clearDisabled = loading || clearing || events.length === 0;

  return (
    <motion.section
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35, ease: "easeOut" }}
      className="w-full"
      data-tour="events-main"
    >
      {/* ── Cabecera del registro ── */}
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="flex flex-1 flex-col">
          <h2 className="font-display text-[1.45rem] font-bold leading-tight">
            Registro de eventos
          </h2>
          <p className="mt-1 text-[13px] text-muted-foreground">
            Cada conexión, bloqueo y desbloqueo, en orden de llegada.
          </p>
        </div>
        <div className="flex items-center gap-5">
          <span className="inline-flex items-center gap-1.5 text-[11px] text-muted-foreground">
            <span className="dot-pulse size-1.5 rounded-full bg-success" />
            Sincronizado
          </span>
          {onClear && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="inline-flex items-center gap-2 text-destructive hover:bg-destructive/10 hover:text-destructive"
              onClick={handleClear}
              disabled={clearDisabled}
            >
              {clearing ? <Spinner size={16} /> : <Trash2 className="size-4" />}
              {clearing ? "Limpiando..." : "Limpiar historial"}
            </Button>
          )}
        </div>
      </div>

      {/* ── Cifras del registro ── */}
      <div className="mt-6 flex flex-wrap gap-x-12 gap-y-3 border-t border-border pt-5">
        {quickStats.map((stat) => (
          <div key={stat.label} className="flex items-baseline gap-3">
            <span className="font-display text-[1.55rem] font-bold leading-none tabular-nums">
              {stat.value}
            </span>
            <span className="smallcaps text-muted-foreground">{stat.label}</span>
          </div>
        ))}
      </div>

      {/* ── Aviso de llegada desde la campana ── */}
      {destinoPendiente && (
        <div className="mt-8 flex flex-wrap items-center gap-x-4 gap-y-2 border border-border border-l-2 border-l-[var(--acero)] bg-primary/[0.04] px-4 py-3">
          <div className="min-w-0 flex-1">
            <p className="text-[13px] font-semibold text-foreground">
              Viendo el evento de la notificación:{" "}
              {etiquetaEventoUsb(destinoPendiente.tipo)} en{" "}
              {destinoPendiente.pcName}
            </p>
            <p className="mt-0.5 font-mono text-[11px] text-muted-foreground">
              {formatDate(destinoPendiente.createdAt)} ·{" "}
              {formatTime(destinoPendiente.createdAt)}
              {destinoPendiente.serialNumber &&
                ` · ${destinoPendiente.serialNumber}`}
            </p>
            {filtroDestino && !filtroDestino.exacto && (
              <p className="mt-1 text-xs text-muted-foreground">
                Ese evento ya salió de los últimos 50 del registro: se
                enseñan las coincidencias por equipo, tipo y dispositivo.
              </p>
            )}
          </div>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="inline-flex items-center gap-1.5"
            onClick={limpiarDestino}
          >
            <X className="size-3.5" />
            Ver todo el registro
          </Button>
        </div>
      )}

      {/* ── Cuerpo ── */}
      <div className={destinoPendiente ? "mt-5" : "mt-8"}>
        {loading ? (
          <div className="space-y-3">
            {[...Array(5)].map((_, i) => (
              <Skeleton key={i} className="h-12 bg-muted/50" />
            ))}
          </div>
        ) : destinoPendiente && eventosVisibles.length === 0 ? (
          <p className="border-t border-border py-10 text-sm text-muted-foreground">
            Ese evento ya no aparece entre los últimos 50 del registro y
            no quedan coincidencias suyas. Pulsa «Ver todo el registro»
            para volver a la lista completa.
          </p>
        ) : events.length === 0 ? (
          <p className="border-t border-border py-10 text-sm text-muted-foreground">
            No se ha registrado ningún evento USB todavía. Cuando un agente
            reporte la primera conexión, aparecerá aquí.
          </p>
        ) : (
          <>
            {/* Móvil: asientos en lista */}
            <div className="md:hidden">
              {paginatedEvents.map((event) => {
                const occurredAt = event.timestamp ?? event.createdAt;
                const { tone } = classifyEvent(event);
                return (
                  <article key={event.id} className="border-b border-border/70 py-4">
                    <div className="flex items-baseline justify-between gap-3">
                      <p className="font-display text-[1.05rem] font-bold">
                        {event.pcName}
                      </p>
                      <span
                        className={cn(
                          "smallcaps",
                          tone === "success" && "text-success",
                          tone === "error" && "text-destructive",
                          tone === "neutral" && "text-muted-foreground",
                        )}
                      >
                        {tone === "success"
                          ? "Desbloqueado"
                          : tone === "error"
                            ? "Alerta"
                            : "Info"}
                      </span>
                    </div>
                    <p className="mt-1 text-[13px] text-muted-foreground">
                      {etiquetaEventoUsb(event.event)}
                      {event.unlockedBy && <> · por {event.unlockedBy}</>}
                    </p>
                    <p className="mt-2 font-mono text-[11px] leading-relaxed text-muted-foreground/80">
                      {event.pcUser} · {event.pcIp}
                      {event.serialNumber && <> · {event.serialNumber}</>}
                      {event.driveLetter && <> · Unidad {event.driveLetter}</>}
                    </p>
                    <p className="mt-1 text-[11px] text-muted-foreground/70">
                      {formatDate(occurredAt)} · {formatTime(occurredAt)} · {haceCuanto(occurredAt)} ·{" "}
                      {event.whitelisted ? "En lista blanca" : "Fuera de la lista blanca"}
                    </p>
                  </article>
                );
              })}
            </div>

            {/* Escritorio: libro mayor */}
            <ScrollArea className="hidden w-full md:block">
              <TooltipProvider delayDuration={120}>
                <Table className="w-full min-w-[850px]">
                  <TableHeader className="sticky top-0 z-10 bg-background">
                    <TableRow>
                      <SortableTableHead column="pcName" currentSortKey={sortConfig.key} currentSortDirection={sortConfig.direction} onSort={requestSort}>
                        Computadora
                      </SortableTableHead>
                      <SortableTableHead column="pcUser" currentSortKey={sortConfig.key} currentSortDirection={sortConfig.direction} onSort={requestSort}>
                        Usuario / IP
                      </SortableTableHead>
                      <SortableTableHead column="event" currentSortKey={sortConfig.key} currentSortDirection={sortConfig.direction} onSort={requestSort}>
                        Evento
                      </SortableTableHead>
                      <SortableTableHead column="serialNumber" currentSortKey={sortConfig.key} currentSortDirection={sortConfig.direction} onSort={requestSort}>
                        Dispositivo
                      </SortableTableHead>
                      <SortableTableHead column="whitelisted" currentSortKey={sortConfig.key} currentSortDirection={sortConfig.direction} onSort={requestSort}>
                        Estado
                      </SortableTableHead>
                      <SortableTableHead column="createdAt" currentSortKey={sortConfig.key} currentSortDirection={sortConfig.direction} onSort={requestSort}>
                        Fecha / Hora
                      </SortableTableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {paginatedEvents.map((event) => {
                      const occurredAt = event.timestamp ?? event.createdAt;
                      const { tone } = classifyEvent(event);
                      return (
                        <TableRow key={event.id}>
                          <TableCell className="max-w-[140px]">
                            <span className="block truncate font-display text-[0.95rem] font-bold" title={event.pcName}>
                              {event.pcName}
                            </span>
                          </TableCell>
                          <TableCell className="max-w-[140px] text-muted-foreground">
                            <div className="flex flex-col gap-0.5">
                              <span className="truncate" title={event.pcUser}>{event.pcUser}</span>
                              <span className="truncate font-mono text-xs text-muted-foreground/70" title={event.pcIp}>
                                {event.pcIp}
                              </span>
                            </div>
                          </TableCell>
                          <TableCell className="max-w-[220px]">
                            <span
                              className={cn(
                                "smallcaps",
                                tone === "success" && "text-success",
                                tone === "error" && "text-destructive",
                                tone === "neutral" && "text-muted-foreground",
                              )}
                            >
                              {tone === "success" ? "Autorizado" : tone === "error" ? "Alerta" : "Info"}
                            </span>
                            <span className="mt-0.5 block truncate text-xs text-muted-foreground" title={event.event}>
                              {etiquetaEventoUsb(event.event)}
                            </span>
                            {event.unlockedBy && (
                              <span className="mt-0.5 block truncate text-xs text-muted-foreground" title={event.unlockedBy}>
                                por {event.unlockedBy}
                              </span>
                            )}
                          </TableCell>
                          <TableCell className="max-w-[180px] text-muted-foreground">
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <div className="cursor-help text-xs leading-tight">
                                  <div className="truncate font-mono" title={event.serialNumber || "Sin serial"}>
                                    {event.serialNumber || "Sin serial"}
                                  </div>
                                  <div className="mt-0.5 text-muted-foreground/75">
                                    {event.driveLetter && <>Unidad {event.driveLetter}</>}
                                    {event.driveLetter && event.readonlyStatus && " · "}
                                    {event.readonlyStatus ? etiquetaCapaBloqueo(event.readonlyStatus) : null}
                                  </div>
                                </div>
                              </TooltipTrigger>
                              <TooltipContent side="left" align="start" className="max-w-xs text-xs">
                                <div className="space-y-1.5">
                                  <p><span className="font-semibold">Serial:</span> {event.serialNumber || "Sin serial"}</p>
                                  <p><span className="font-semibold">Unidad:</span> {event.driveLetter || "Sin unidad"}</p>
                                  <p><span className="font-semibold">Capa de bloqueo:</span> {event.readonlyStatus ? etiquetaCapaBloqueo(event.readonlyStatus) : "Sin capa"}</p>
                                </div>
                              </TooltipContent>
                            </Tooltip>
                          </TableCell>
                          <TableCell>
                            <span className="inline-flex items-center gap-1.5 text-[13px]">
                              <span
                                className={cn(
                                  "size-1.5 rounded-full",
                                  event.whitelisted ? "bg-success" : "bg-warning",
                                )}
                              />
                              {event.whitelisted ? "En lista blanca" : "Fuera de la lista blanca"}
                            </span>
                          </TableCell>
                          <TableCell className="text-muted-foreground">
                            <div className="flex flex-col">
                              <span className="text-sm font-medium text-foreground">{formatDate(occurredAt)}</span>
                              <span className="font-mono text-xs text-muted-foreground/70">{formatTime(occurredAt)} · {haceCuanto(occurredAt)}</span>
                            </div>
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </TooltipProvider>
              <ScrollBar orientation="horizontal" />
            </ScrollArea>

            {!loading && eventosVisibles.length > 0 && (
              <DashboardPagination
                page={page}
                pageSize={pageSize}
                totalItems={eventosVisibles.length}
                onPageChange={setPage}
                onPageSizeChange={setPageSize}
                label="eventos"
              />
            )}
          </>
        )}
      </div>
    </motion.section>
  );
}
