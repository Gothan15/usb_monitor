"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
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
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  AlertTriangle,
  Clock3,
  Loader2,
  ShieldCheck,
  Siren,
  Trash2,
  Usb,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { USBEvent, formatDateTime } from "./types";
import { DashboardPagination } from "./DashboardPagination";

interface Props {
  events: USBEvent[];
  loading: boolean;
  onClear?: () => void;
  clearing?: boolean;
}

export function EventsTab({ events, loading, onClear, clearing }: Props) {
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);

  const classifyEvent = (message: string) => {
    const normalized = message.toLowerCase();
    const isUnlock =
      normalized.includes("readonly removido") ||
      normalized.includes("desbloqueada") ||
      normalized.includes("desbloqueado");
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
          accent: "from-emerald-400/25",
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
      (event) => classifyEvent(event.event).tone === "success"
    ).length;
    const alerts = events.filter(
      (event) => classifyEvent(event.event).tone === "error"
    ).length;

    return [
      {
        label: "Eventos",
        value: total.toString(),
        accent: "from-purple-400/25 via-indigo-400/10",
        icon: <Usb className="size-4" />,
      },
      {
        label: "Desbloqueos",
        value: unlocks.toString(),
        accent: "from-emerald-400/25 via-emerald-300/10",
        icon: <ShieldCheck className="size-4" />,
      },
      {
        label: "Alertas",
        value: alerts.toString(),
        accent: "from-rose-400/30 via-amber-300/10",
        icon: <Siren className="size-4" />,
      },
    ];
  }, [events, loading]);

  const pageCount = useMemo(() => {
    if (events.length === 0) return 1;
    return Math.max(1, Math.ceil(events.length / Math.max(pageSize, 1)));
  }, [events.length, pageSize]);

  useEffect(() => {
    if (page > pageCount) {
      setPage(pageCount);
    }
  }, [page, pageCount]);

  const handlePageChange = useCallback(
    (nextPage: number) => {
      const clamped = Math.min(Math.max(nextPage, 1), pageCount);
      setPage(clamped);
    },
    [pageCount]
  );

  const handlePageSizeChange = useCallback((nextSize: number) => {
    setPageSize(nextSize);
    setPage(1);
  }, []);

  const paginatedEvents = useMemo(() => {
    if (events.length === 0) return [];
    const start = (page - 1) * pageSize;
    return events.slice(start, start + pageSize);
  }, [events, page, pageSize]);

  const handleClear = useCallback(() => {
    if (!onClear) return;
    onClear();
  }, [onClear]);

  const clearDisabled = loading || clearing || events.length === 0;

  return (
    <motion.section
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35, ease: "easeOut" }}
    >
      <Card className="relative overflow-hidden rounded-3xl border border-slate-200/70 bg-white/85 text-slate-900 shadow-xl supports-[backdrop-filter]:backdrop-blur-2xl dark:border-white/10 dark:bg-slate-900/50 dark:text-white">
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top_left,_rgba(147,51,234,0.12),transparent_55%),radial-gradient(circle_at_bottom_right,_rgba(99,102,241,0.12),transparent_55%)] dark:bg-[radial-gradient(circle_at_top_left,_rgba(147,51,234,0.16),transparent_45%),radial-gradient(circle_at_bottom_right,_rgba(99,102,241,0.18),transparent_50%)]" />
        <CardHeader className="relative z-10 space-y-6">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
            <div className="flex items-center gap-3">
              <span className="inline-flex size-12 items-center justify-center rounded-2xl border border-purple-200/60 bg-white/80 text-purple-600 shadow-sm dark:border-purple-400/40 dark:bg-white/10 dark:text-purple-200">
                <Usb className="size-5" />
              </span>
              <div>
                <CardTitle className="text-2xl font-semibold text-slate-900 dark:text-slate-100">
                  Eventos USB recientes
                </CardTitle>
                <CardDescription className="text-sm text-slate-600 dark:text-slate-300/80">
                  Audita accesos, bloqueos y riesgos con contexto visual
                  inmediato.
                </CardDescription>
              </div>
            </div>
            <div className="flex flex-col gap-2 text-xs font-medium text-slate-600 dark:text-slate-300/80 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex flex-wrap items-center gap-2">
                <span className="inline-flex items-center gap-1 rounded-full border border-white/70 bg-white/80 px-3 py-1 shadow-sm backdrop-blur-sm dark:border-white/10 dark:bg-white/10">
                  <span className="size-2 rounded-full bg-emerald-500 dark:bg-emerald-400" />
                  Tiempo real sincronizado
                </span>
                <span className="inline-flex items-center gap-1 rounded-full border border-white/70 bg-white/80 px-3 py-1 shadow-sm backdrop-blur-sm dark:border-white/10 dark:bg-white/10">
                  <Clock3 className="size-3" />
                  Últimas 24h
                </span>
              </div>
              {onClear && (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="inline-flex items-center gap-2 font-semibold text-slate-700 dark:text-slate-100"
                  onClick={handleClear}
                  disabled={clearDisabled}
                >
                  {clearing ? (
                    <Loader2 className="size-4 animate-spin" />
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
                className="relative overflow-hidden rounded-2xl border border-white/70 bg-white/85 p-4 text-slate-700 shadow-md supports-[backdrop-filter]:backdrop-blur-xl dark:border-white/10 dark:bg-white/5 dark:text-slate-200"
              >
                <div
                  className={cn(
                    "pointer-events-none absolute inset-0 rounded-2xl bg-gradient-to-br opacity-70",
                    stat.accent
                  )}
                />
                <div className="relative flex items-center justify-between gap-3">
                  <div>
                    <p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-slate-500 dark:text-slate-400">
                      {stat.label}
                    </p>
                    <p className="mt-2 text-2xl font-semibold tracking-tight text-slate-900 dark:text-white">
                      {stat.value}
                    </p>
                  </div>
                  <span className="inline-flex size-9 items-center justify-center rounded-xl border border-white/60 bg-white/80 text-slate-500 shadow-sm dark:border-white/15 dark:bg-white/10 dark:text-slate-200">
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
                <Skeleton
                  key={i}
                  className="h-12 rounded-2xl bg-slate-100/80 dark:bg-white/10"
                />
              ))}
            </div>
          ) : events.length === 0 ? (
            <Alert className="rounded-2xl border-amber-200/60 bg-amber-50/90 text-amber-700 shadow-sm dark:border-amber-300/40 dark:bg-amber-500/10 dark:text-amber-100">
              <AlertTriangle className="h-4 w-4" />
              <AlertDescription>
                No se han registrado eventos USB aún.
              </AlertDescription>
            </Alert>
          ) : (
            <>
              <div className="space-y-4 md:hidden">
                {paginatedEvents.map((event) => {
                  const { badgeVariant, tone } = classifyEvent(event.event);
                  return (
                    <motion.div
                      key={event.id}
                      whileHover={{ y: -4 }}
                      transition={{ duration: 0.2 }}
                      className={cn(
                        "rounded-3xl border border-white/70 bg-white/85 p-5 shadow-lg supports-[backdrop-filter]:backdrop-blur-xl dark:border-white/10 dark:bg-white/5",
                        tone === "success" &&
                          "border-emerald-200/60 bg-emerald-50/70 dark:border-emerald-400/30 dark:bg-emerald-500/10",
                        tone === "error" &&
                          "border-rose-200/60 bg-rose-50/70 dark:border-rose-400/30 dark:bg-rose-500/10"
                      )}
                    >
                      <div className="flex items-center justify-between gap-3">
                        <div>
                          <p className="text-sm font-semibold text-slate-900 dark:text-white">
                            {event.pcName}
                          </p>
                          <p className="text-xs uppercase tracking-[0.2em] text-slate-500 dark:text-slate-400">
                            {event.pcUser} · {event.pcIp}
                          </p>
                        </div>
                        <Badge
                          variant={badgeVariant}
                          className={cn(
                            "rounded-full px-3 py-1 text-[0.65rem] font-semibold uppercase tracking-[0.18em]",
                            badgeVariant === "default" &&
                              "border border-slate-200 bg-slate-100 text-slate-700 shadow-sm dark:border-white/10 dark:bg-white/10 dark:text-white"
                          )}
                        >
                          {badgeVariant === "success"
                            ? "Autorizado"
                            : badgeVariant === "destructive"
                            ? "Alerta"
                            : "Info"}
                        </Badge>
                      </div>
                      <p className="mt-3 text-sm text-slate-600 dark:text-slate-300">
                        {event.event}
                      </p>
                      <div className="mt-4 flex items-center justify-between text-xs text-slate-500 dark:text-slate-300">
                        <span>{formatDateTime(event.createdAt)}</span>
                        <span className="inline-flex items-center gap-1 rounded-full border border-white/70 bg-white/80 px-2 py-0.5 shadow-sm backdrop-blur-sm dark:border-white/10 dark:bg-white/10">
                          <Usb className="size-3" />
                          Evento USB
                        </span>
                      </div>
                    </motion.div>
                  );
                })}
              </div>

              <ScrollArea className="hidden max-h-[min(60vh,460px)] pr-3 [--scrollbar-size:0px] [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden md:block">
                <Table className="min-w-full">
                  <TableHeader className="sticky top-0 z-10 bg-white/95 backdrop-blur-xl dark:bg-slate-900/80">
                    <TableRow className="border-white/60 dark:border-white/10">
                      <TableHead className="text-slate-600 dark:text-slate-200">
                        Computadora
                      </TableHead>
                      <TableHead className="text-slate-600 dark:text-slate-200">
                        Usuario
                      </TableHead>
                      <TableHead className="text-slate-600 dark:text-slate-200">
                        IP
                      </TableHead>
                      <TableHead className="text-slate-600 dark:text-slate-200">
                        Evento
                      </TableHead>
                      <TableHead className="text-slate-600 dark:text-slate-200">
                        Fecha / Hora
                      </TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {paginatedEvents.map((event) => {
                      const { badgeVariant, rowClassName } = classifyEvent(
                        event.event
                      );
                      const badgeClass =
                        badgeVariant === "default"
                          ? "border border-slate-200 bg-slate-100 text-slate-700 shadow-sm dark:border-white/10 dark:bg-white/10 dark:text-white"
                          : "border border-transparent shadow-sm";
                      return (
                        <TableRow
                          key={event.id}
                          className={cn(
                            "group border border-white/70 bg-white/75 transition-all duration-200 hover:-translate-y-0.5 hover:border-slate-400/60 hover:bg-slate-100/70 dark:border-white/5 dark:bg-white/5 dark:hover:border-white/20",
                            rowClassName
                          )}
                        >
                          <TableCell className="font-semibold text-slate-700 dark:text-slate-100">
                            {event.pcName}
                          </TableCell>
                          <TableCell className="text-slate-600 dark:text-slate-300/80">
                            {event.pcUser}
                          </TableCell>
                          <TableCell className="text-slate-600 dark:text-slate-300/80">
                            {event.pcIp}
                          </TableCell>
                          <TableCell>
                            <Badge
                              variant={badgeVariant}
                              className={badgeClass}
                            >
                              {event.event}
                            </Badge>
                          </TableCell>
                          <TableCell className="text-slate-600 dark:text-slate-200">
                            {formatDateTime(event.createdAt)}
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </ScrollArea>
              <DashboardPagination
                page={page}
                pageSize={pageSize}
                totalItems={events.length}
                onPageChange={handlePageChange}
                onPageSizeChange={handlePageSizeChange}
                label="eventos"
              />
            </>
          )}
        </CardContent>
      </Card>
    </motion.section>
  );
}
