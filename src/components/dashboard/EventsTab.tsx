"use client";

import { useMemo } from "react";
import { motion } from "framer-motion";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { ScrollArea, ScrollBar } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  AlertTriangle,
  Clock3,
  Info,
  ShieldCheck,
  Siren,
  Trash2,
  Usb,
} from "lucide-react";
import { Spinner } from "@/components/ui/spinner";
import { cn } from "@/lib/utils";
import { USBEvent, formatDate, formatTime } from "./types";
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
  const { page, pageSize, setPage, setPageSize } = usePagination({
    totalItems: events.length,
  });

  const classifyEvent = (event: USBEvent) => {
    if (event.whitelisted) {
      return {
        badgeVariant: "success" as const,
        rowClassName:
          "bg-[oklch(0.92_0.03_160)] dark:bg-[oklch(0.55_0.12_160/0.10)] transition-colors",
        tone: "success" as const,
      };
    }

    const normalized = event.event.toLowerCase();
    const readonly = (event.readonlyStatus || "").toLowerCase();
    const isUnlock =
      normalized.includes("readonly removido") ||
      normalized.includes("desbloqueada") ||
      normalized.includes("desbloqueado") ||
      readonly.includes("removido");
    const isError =
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
        accent: "from-[oklch(0.70_0.05_280/0.20)] via-[oklch(0.65_0.04_280/0.08)]",
        icon: <Usb className="size-4" />,
      },
      {
        label: "Desbloqueos",
        value: unlocks.toString(),
        accent: "from-[oklch(0.75_0.12_160/0.25)] via-[oklch(0.80_0.08_160/0.10)]",
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
    useTableSort<USBEvent>(events);

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
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35, ease: "easeOut" }}
      className="w-full"
    >
      <Card className="relative w-full overflow-hidden rounded-2xl border border-border/60 bg-card/80 text-card-foreground shadow-xl backdrop-blur-xl">
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top_left,oklch(0.80_0.01_250/0.10),transparent_55%)]" />
        <CardHeader className="relative z-10 space-y-6">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
            <div className="flex items-center gap-3">
              <span className="inline-flex size-10 items-center justify-center rounded-xl bg-primary/10 text-primary">
                <Usb className="size-5" />
              </span>
              <div>
                <CardTitle className="text-lg font-semibold text-foreground">
                  Eventos USB recientes
                </CardTitle>
                <CardDescription className="text-xs text-muted-foreground">
                  Audita accesos, bloqueos y riesgos con contexto visual
                  inmediato.
                </CardDescription>
              </div>
            </div>
            <div className="flex flex-col gap-2 text-xs font-medium text-muted-foreground sm:flex-row sm:items-center sm:justify-between">
              <div className="flex flex-wrap items-center gap-2">
                <span className="inline-flex items-center gap-1.5 rounded-full border border-border/50 bg-muted/30 px-3 py-1 text-[11px]">
                  <span className="size-1.5 rounded-full bg-[oklch(0.55_0.12_160)] animate-pulse" />
                  Sincronizado
                </span>
                <span className="inline-flex items-center gap-1.5 rounded-full border border-border/50 bg-muted/30 px-3 py-1 text-[11px]">
                  <Clock3 className="size-3" />
                  Últimas 24h
                </span>
              </div>
              {onClear && (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="inline-flex items-center gap-2 font-semibold text-foreground"
                  onClick={handleClear}
                  disabled={clearDisabled}
                >
                  {clearing ? (
                    <Spinner size={16} />
                  ) : (
                    <Trash2 className="size-4" />
                  )}
                  {clearing ? "Limpiando..." : "Limpiar historial"}
                </Button>
              )}
            </div>
          </div>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {quickStats.map((stat) => (
              <div
                key={stat.label}
                className="relative overflow-hidden rounded-xl border border-border/40 bg-card/50 p-4 backdrop-blur-sm"
              >
                <div
                  className={cn(
                    "pointer-events-none absolute inset-0 rounded-xl bg-gradient-to-br opacity-50",
                    stat.accent,
                  )}
                />
                <div className="relative flex items-center justify-between gap-3">
                  <div>
                    <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-muted-foreground">
                      {stat.label}
                    </p>
                    <p className="mt-1.5 text-xl font-bold tabular-nums text-foreground">
                      {stat.value}
                    </p>
                  </div>
                  <span className="inline-flex size-8 items-center justify-center rounded-lg bg-muted/50 text-muted-foreground">
                    {stat.icon}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </CardHeader>
        <CardContent className="relative z-10 space-y-6">
          {loading ? (
            <div className="space-y-3">
              {[...Array(5)].map((_, i) => (
                <Skeleton key={i} className="h-12 rounded-lg bg-muted/40" />
              ))}
            </div>
          ) : events.length === 0 ? (
            <Alert className="rounded-xl border-[oklch(0.80_0.10_85/0.40)] bg-[oklch(0.95_0.03_85)] text-[oklch(0.45_0.10_85)] shadow-sm dark:border-[oklch(0.65_0.08_85/0.30)] dark:bg-[oklch(0.80_0.10_85/0.10)] dark:text-[oklch(0.90_0.04_85)]">
              <AlertTriangle className="h-4 w-4" />
              <AlertDescription>
                No se han registrado eventos USB aún.
              </AlertDescription>
            </Alert>
          ) : (
            <div className="flex flex-col gap-6">
              <div className="space-y-4 md:hidden">
                {paginatedEvents.map((event) => {
                  const occurredAt = event.timestamp ?? event.createdAt;
                  const { badgeVariant, tone } = classifyEvent(event);
                  return (
                    <motion.div
                      key={event.id}
                      whileHover={{ y: -2 }}
                      transition={{ duration: 0.15 }}
                      className={cn(
                        "rounded-xl border border-border/50 bg-card/80 p-4 backdrop-blur-sm",
                        tone === "success" &&
                          "border-[oklch(0.75_0.12_160/0.20)] bg-[oklch(0.75_0.12_160/0.06)]",
                        tone === "error" && "border-rose-500/20 bg-rose-500/5",
                      )}
                    >
                      <div className="flex items-center justify-between gap-3">
                        <div>
                          <p className="text-sm font-medium text-foreground">
                            {event.pcName}
                          </p>
                          <p className="text-[10px] uppercase tracking-wider text-muted-foreground">
                            {event.pcUser} · {event.pcIp}
                          </p>
                        </div>
                        <Badge
                          variant={badgeVariant}
                          className={cn(
                            "rounded-full px-2.5 py-0.5 text-[10px] font-semibold uppercase",
                            badgeVariant === "default" &&
                              "border border-border/50 bg-muted/40 text-muted-foreground",
                          )}
                        >
                          {badgeVariant === "success"
                            ? "Autorizado"
                            : badgeVariant === "destructive"
                              ? "Alerta"
                              : "Info"}
                        </Badge>
                      </div>
                      <p className="mt-3 text-sm text-muted-foreground">
                        {event.event}
                      </p>
                      <div className="mt-2 grid gap-1 text-xs text-muted-foreground font-mono">
                        {event.driveLetter && (
                          <span>{`Unidad: ${event.driveLetter}`}</span>
                        )}
                        {event.serialNumber && (
                          <span>{`Serial: ${event.serialNumber}`}</span>
                        )}
                        {event.readonlyStatus && (
                          <span>{`Modo: ${event.readonlyStatus}`}</span>
                        )}
                        <span>{`Autorizado: ${
                          event.whitelisted ? "Sí" : "No"
                        }`}</span>
                      </div>
                      <div className="mt-3 flex items-center justify-between text-xs text-muted-foreground">
                        <div className="flex flex-col">
                          <span className="text-sm font-medium text-foreground">
                            {formatDate(occurredAt)}
                          </span>
                          <span className="font-mono">
                            {formatTime(occurredAt)}
                          </span>
                        </div>
                        <span className="inline-flex items-center gap-1 rounded-full border border-border/50 bg-muted/30 px-2 py-0.5 text-[10px]">
                          <Usb className="size-3" />
                          Evento USB
                        </span>
                      </div>
                    </motion.div>
                  );
                })}
              </div>

              <div className="flex flex-col overflow-hidden rounded-xl border border-border/40 bg-card/60 shadow-inner backdrop-blur-sm">
                <div className="flex-1 overflow-hidden">
                  <ScrollArea className="hidden max-h-[min(75vh,650px)] w-full pr-3 md:block">
                <TooltipProvider delayDuration={120}>
                  <div className="w-full">
                    <Table className="w-full min-w-[850px]">
                      <TableHeader className="sticky top-0 z-10 bg-card/95 backdrop-blur-xl">
                        <TableRow>
                          <SortableTableHead
                            column="pcName"
                            currentSortKey={sortConfig.key}
                            currentSortDirection={sortConfig.direction}
                            onSort={requestSort}
                            className="text-muted-foreground"
                          >
                            Computadora
                          </SortableTableHead>
                          <SortableTableHead
                            column="pcUser"
                            currentSortKey={sortConfig.key}
                            currentSortDirection={sortConfig.direction}
                            onSort={requestSort}
                            className="text-muted-foreground"
                          >
                            Usuario / IP
                          </SortableTableHead>
                          <SortableTableHead
                            column="event"
                            currentSortKey={sortConfig.key}
                            currentSortDirection={sortConfig.direction}
                            onSort={requestSort}
                            className="text-muted-foreground"
                          >
                            Evento
                          </SortableTableHead>
                          <SortableTableHead
                            column="serialNumber"
                            currentSortKey={sortConfig.key}
                            currentSortDirection={sortConfig.direction}
                            onSort={requestSort}
                            className="text-muted-foreground"
                          >
                            Detalle dispositivo
                          </SortableTableHead>
                          <SortableTableHead
                            column="whitelisted"
                            currentSortKey={sortConfig.key}
                            currentSortDirection={sortConfig.direction}
                            onSort={requestSort}
                            className="text-muted-foreground"
                          >
                            Estado
                          </SortableTableHead>
                          <SortableTableHead
                            column="createdAt"
                            currentSortKey={sortConfig.key}
                            currentSortDirection={sortConfig.direction}
                            onSort={requestSort}
                            className="text-muted-foreground"
                          >
                            Fecha / Hora
                          </SortableTableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {paginatedEvents.map((event) => {
                          const occurredAt = event.timestamp ?? event.createdAt;
                          const { badgeVariant, rowClassName, tone } =
                            classifyEvent(event);
                          const toneLabel =
                            tone === "success"
                              ? "Autorizado"
                              : tone === "error"
                                ? "Alerta"
                                : "Info";
                          const toneIcon =
                            tone === "success" ? (
                              <ShieldCheck className="h-3.5 w-3.5" />
                            ) : tone === "error" ? (
                              <AlertTriangle className="h-3.5 w-3.5" />
                            ) : (
                              <Info className="h-3.5 w-3.5" />
                            );
                          const toneBadgeClass = cn(
                            "inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-[0.2em]",
                            badgeVariant === "default" &&
                              "border border-border/50 bg-muted/40 text-muted-foreground",
                          );
                          return (
                            <TableRow
                              key={event.id}
                              className={cn(
                                "group transition-colors duration-150",
                                rowClassName,
                              )}
                            >
                              <TableCell className="max-w-[120px] font-medium text-foreground">
                                <span
                                  className="block truncate"
                                  title={event.pcName}
                                >
                                  {event.pcName}
                                </span>
                              </TableCell>
                              <TableCell className="max-w-[140px] text-muted-foreground">
                                <div className="flex flex-col gap-0.5">
                                  <span
                                    className="truncate"
                                    title={event.pcUser}
                                  >
                                    {event.pcUser}
                                  </span>
                                  <span
                                    className="truncate text-xs font-mono text-muted-foreground/70"
                                    title={event.pcIp}
                                  >
                                    {event.pcIp}
                                  </span>
                                </div>
                              </TableCell>
                              <TableCell className="max-w-[200px] text-muted-foreground">
                                <div className="flex flex-col gap-1">
                                  <Badge
                                    variant={badgeVariant}
                                    className={toneBadgeClass}
                                  >
                                    {toneIcon}
                                    <span className="hidden xl:inline">
                                      {toneLabel}
                                    </span>
                                  </Badge>
                                  <span
                                    className="truncate text-xs text-muted-foreground/70"
                                    title={event.event}
                                  >
                                    {event.event}
                                  </span>
                                </div>
                              </TableCell>
                              <TableCell className="max-w-[160px] text-muted-foreground">
                                <Tooltip>
                                  <TooltipTrigger asChild>
                                    <div className="cursor-help space-y-1 text-xs leading-tight">
                                      <div
                                        className="truncate font-mono"
                                        title={
                                          event.serialNumber || "Sin serial"
                                        }
                                      >
                                        {event.serialNumber || "Sin serial"}
                                      </div>
                                      <div className="flex flex-wrap items-center gap-1">
                                        {event.driveLetter && (
                                          <Badge
                                            variant="outline"
                                            className="rounded-full px-2 py-0 text-[10px] uppercase tracking-wider"
                                          >
                                            {event.driveLetter}
                                          </Badge>
                                        )}
                                        {event.readonlyStatus && (
                                          <Badge
                                            variant="outline"
                                            className="max-w-[96px] truncate rounded-full px-2 py-0 text-[10px] uppercase tracking-wider"
                                          >
                                            {event.readonlyStatus}
                                          </Badge>
                                        )}
                                      </div>
                                    </div>
                                  </TooltipTrigger>
                                  <TooltipContent
                                    side="left"
                                    align="start"
                                    className="max-w-xs text-xs"
                                  >
                                    <div className="space-y-1.5">
                                      <p>
                                        <span className="font-semibold">
                                          Serial:
                                        </span>{" "}
                                        {event.serialNumber || "Sin serial"}
                                      </p>
                                      <p>
                                        <span className="font-semibold">
                                          Unidad:
                                        </span>{" "}
                                        {event.driveLetter || "Sin unidad"}
                                      </p>
                                      <p>
                                        <span className="font-semibold">
                                          Modo:
                                        </span>{" "}
                                        {event.readonlyStatus || "Sin modo"}
                                      </p>
                                    </div>
                                  </TooltipContent>
                                </Tooltip>
                              </TableCell>
                              <TableCell className="text-muted-foreground">
                                <Badge
                                  variant={
                                    event.whitelisted ? "success" : "secondary"
                                  }
                                  className={cn(
                                    "inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-semibold",
                                    event.whitelisted
                                      ? "border-[oklch(0.75_0.12_160/0.30)] bg-[oklch(0.75_0.12_160/0.10)] text-[oklch(0.40_0.12_160)] dark:border-[oklch(0.65_0.10_160/0.30)] dark:bg-[oklch(0.55_0.12_160/0.15)] dark:text-[oklch(0.90_0.04_160)]"
                                      : "border-[oklch(0.80_0.10_85/0.40)] bg-[oklch(0.95_0.03_85)] text-[oklch(0.45_0.10_85)] dark:border-[oklch(0.65_0.08_85/0.30)] dark:bg-[oklch(0.80_0.10_85/0.15)] dark:text-[oklch(0.90_0.04_85)]",
                                  )}
                                >
                                  {event.whitelisted ? (
                                    <ShieldCheck className="h-3.5 w-3.5" />
                                  ) : (
                                    <AlertTriangle className="h-3.5 w-3.5" />
                                  )}
                                  <span className="hidden xl:inline">
                                    {event.whitelisted
                                      ? "Autorizado"
                                      : "Sin autorizar"}
                                  </span>
                                </Badge>
                              </TableCell>
                              <TableCell className="text-muted-foreground">
                                <div className="flex flex-col">
                                  <span className="font-medium text-foreground text-sm">
                                    {formatDate(occurredAt)}
                                  </span>
                                  <span className="text-xs font-mono text-muted-foreground/70">
                                    {formatTime(occurredAt)}
                                  </span>
                                </div>
                              </TableCell>
                            </TableRow>
                          );
                        })}
                      </TableBody>
                    </Table>
                  </div>
                </TooltipProvider>
                <ScrollBar orientation="horizontal" />
              </ScrollArea>
              </div>

                <div className="shrink-0 border-t border-border/40 bg-card/50 p-4">
                  {/* Floating Pagination */}
                  {!loading && events.length > 0 && (
                    <DashboardPagination
                      page={page}
                      pageSize={pageSize}
                      totalItems={events.length}
                      onPageChange={setPage}
                      onPageSizeChange={setPageSize}
                      label="eventos"
                    />
                  )}
                </div>
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </motion.section>
  );
}
