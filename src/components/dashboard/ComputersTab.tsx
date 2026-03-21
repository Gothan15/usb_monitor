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
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { ScrollArea, ScrollBar } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  AlertTriangle,
  Cpu,
  MonitorSmartphone,
  Router,
  Sparkles,
  Trash2,
  Usb,
  Wifi,
} from "lucide-react";
import { Computer, formatDateTime, formatTime } from "./types";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { DashboardPagination } from "./DashboardPagination";
import { useTableSort } from "@/hooks/useTableSort";
import { SortableTableHead } from "./SortableTableHead";
import { USBDevicesSheet } from "./USBDevicesSheet";
import { Spinner } from "@/components/ui/spinner";

interface Props {
  computers: Computer[];
  loading: boolean;
  onDelete?: (id: string) => Promise<void> | void;
}

function StatusBadge({ active }: { active: boolean }) {
  return (
    <Badge
      variant={active ? "success" : "secondary"}
      className={cn(
        "shadow-sm",
        !active && "border border-border/50 bg-muted/40 text-muted-foreground",
      )}
    >
      {active ? "Activo" : "Inactivo"}
    </Badge>
  );
}

export function ComputersTab({ computers, loading, onDelete }: Props) {
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [pendingDelete, setPendingDelete] = useState<Computer | null>(null);
  const [selectedComputer, setSelectedComputer] = useState<Computer | null>(
    null,
  );

  const { sortedData, sortConfig, requestSort } =
    useTableSort<Computer>(computers);

  const quickStats = useMemo(() => {
    if (loading) {
      return [
        { label: "Activos", value: "--", accent: "from-emerald-400/30" },
        { label: "Servicios", value: "--", accent: "from-cyan-400/30" },
        { label: "Total", value: "--", accent: "from-muted/40" },
      ];
    }

    const activeCount = sortedData.filter(
      (computer) => computer.isActive,
    ).length;
    const runningCount = sortedData.filter(
      (computer) => computer.serviceRunning,
    ).length;
    const total = sortedData.length;

    return [
      {
        label: "Activos",
        value: activeCount.toString(),
        accent: "from-emerald-400/25 via-emerald-300/10",
      },
      {
        label: "Servicio OK",
        value: runningCount.toString(),
        accent: "from-sky-400/25 via-cyan-300/10",
      },
      {
        label: "Inventario",
        value: total.toString(),
        accent: "from-muted/30 via-muted/10",
      },
    ];
  }, [sortedData, loading]);

  const pageCount = useMemo(() => {
    if (sortedData.length === 0) return 1;
    return Math.max(1, Math.ceil(sortedData.length / Math.max(pageSize, 1)));
  }, [sortedData.length, pageSize]);

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
    [pageCount],
  );

  const handlePageSizeChange = useCallback((nextSize: number) => {
    setPageSize(nextSize);
    setPage(1);
  }, []);

  const paginatedComputers = useMemo(() => {
    if (sortedData.length === 0) return [];
    const start = (page - 1) * pageSize;
    return sortedData.slice(start, start + pageSize);
  }, [sortedData, page, pageSize]);

  const handleConfirmDelete = useCallback(async () => {
    if (!onDelete || !pendingDelete) return;

    try {
      setDeletingId(pendingDelete.id);
      await onDelete(pendingDelete.id);
      setPendingDelete(null);
    } catch (error) {
      console.error("Error al eliminar computadora", error);
    } finally {
      setDeletingId(null);
    }
  }, [onDelete, pendingDelete]);

  return (
    <motion.section
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35, ease: "easeOut" }}
      className="w-full"
    >
      <Card className="relative w-full overflow-hidden rounded-xl border border-border/60 bg-card/80 shadow-xl backdrop-blur-xl">
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top_left,oklch(0.82_0.01_250/0.10),transparent_55%),radial-gradient(circle_at_bottom_right,oklch(0.78_0.015_250/0.10),transparent_55%)]" />
        <CardHeader className="relative z-10 space-y-6">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
            <div className="flex items-center gap-3">
              <span className="inline-flex size-12 items-center justify-center rounded-xl border border-emerald-200/60 bg-emerald-500/10 text-emerald-600 shadow-sm dark:border-emerald-400/30 dark:bg-emerald-500/15 dark:text-emerald-300">
                <MonitorSmartphone className="size-5" />
              </span>
              <div>
                <CardTitle className="text-2xl font-semibold text-foreground">
                  Computadoras monitoreadas
                </CardTitle>
                <CardDescription className="text-sm text-muted-foreground">
                  Visibilidad integral de hosts con el agente USB y su servicio.
                </CardDescription>
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-2 text-xs font-medium text-muted-foreground">
              <span className="inline-flex items-center gap-1 rounded-full border border-border/40 bg-muted/30 px-3 py-1 shadow-sm backdrop-blur-sm">
                <Wifi className="size-3" />
                Estado de conectividad
              </span>
              <span className="inline-flex items-center gap-1 rounded-full border border-border/40 bg-muted/30 px-3 py-1 shadow-sm backdrop-blur-sm">
                <Router className="size-3" />
                Agente USB
              </span>
            </div>
          </div>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {quickStats.map((stat) => (
              <div
                key={stat.label}
                className="relative overflow-hidden rounded-xl border border-border/40 bg-card/80 p-4 backdrop-blur-sm"
              >
                <div
                  className={cn(
                    "pointer-events-none absolute inset-0 rounded-xl bg-gradient-to-br opacity-70",
                    stat.accent,
                  )}
                />
                <div className="relative flex items-center justify-between gap-3">
                  <div>
                    <p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-muted-foreground">
                      {stat.label}
                    </p>
                    <p className="mt-2 text-2xl font-semibold tracking-tight text-foreground">
                      {stat.value}
                    </p>
                  </div>
                  <span className="inline-flex size-8 items-center justify-center rounded-lg bg-muted/50 text-muted-foreground">
                    {stat.label === "Activos" ? (
                      <Cpu className="size-4" />
                    ) : stat.label === "Servicio OK" ? (
                      <Sparkles className="size-4" />
                    ) : (
                      <MonitorSmartphone className="size-4" />
                    )}
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
                <Skeleton key={i} className="h-12 rounded-xl bg-muted/40" />
              ))}
            </div>
          ) : computers.length === 0 ? (
            <Alert className="rounded-xl border-amber-200/60 bg-amber-50/90 text-amber-700 shadow-sm dark:border-amber-300/40 dark:bg-amber-500/10 dark:text-amber-100">
              <AlertTriangle className="h-4 w-4" />
              <AlertDescription>
                No hay computadoras monitoreadas aún.
              </AlertDescription>
            </Alert>
          ) : (
            <div className="flex flex-col gap-6">
              <div className="space-y-4 md:hidden">
                {paginatedComputers.map((computer) => {
                  const canViewUsb =
                    computer.isActive && computer.serviceRunning;
                  return (
                    <motion.div
                      key={computer.id}
                      whileHover={{ y: -4 }}
                      transition={{ duration: 0.2 }}
                      className="rounded-xl border border-border/40 bg-card/80 p-5 shadow-lg backdrop-blur-xl"
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <p className="text-sm font-semibold text-foreground">
                            {computer.name}
                          </p>
                          <p className="text-xs uppercase tracking-[0.2em] text-muted-foreground">
                            {computer.ipAddress}
                          </p>
                        </div>
                        <div className="flex items-center gap-2">
                          <StatusBadge active={computer.isActive} />
                          <Button
                            type="button"
                            size="sm"
                            disabled={!canViewUsb}
                            onClick={() => setSelectedComputer(computer)}
                            aria-label={`Ver USB de ${computer.name}`}
                            title="Ver USB conectados"
                            className={cn(
                              "group relative h-8 gap-1.5 rounded-full px-3 text-xs font-semibold transition-all duration-200",
                              canViewUsb
                                ? "border border-emerald-200/60 bg-emerald-500/10 text-emerald-700 shadow-sm hover:-translate-y-0.5 hover:border-emerald-300 hover:bg-emerald-500/20 hover:shadow-md dark:border-emerald-400/40 dark:bg-emerald-500/15 dark:text-emerald-100"
                                : "cursor-not-allowed border border-border/30 bg-muted/20 text-muted-foreground/40",
                            )}
                          >
                            <Usb className="h-3.5 w-3.5 transition-transform group-hover:scale-110" />
                            <span className="hidden lg:inline">Ver USB</span>
                          </Button>
                          {onDelete && (
                            <Button
                              type="button"
                              size="sm"
                              disabled={deletingId === computer.id}
                              onClick={() => setPendingDelete(computer)}
                              aria-label={`Eliminar ${computer.name}`}
                              title="Eliminar equipo"
                              className={cn(
                                "group relative h-8 gap-1.5 rounded-full px-3 text-xs font-semibold transition-all duration-200",
                                deletingId === computer.id
                                  ? "cursor-wait border border-rose-300/60 bg-rose-500/20 text-rose-50 dark:border-rose-400/40 dark:bg-rose-500/25 dark:text-rose-100"
                                  : "border border-rose-200/60 bg-rose-500/10 text-rose-700 shadow-sm hover:-translate-y-0.5 hover:border-rose-300 hover:bg-rose-500/20 hover:shadow-md dark:border-rose-400/40 dark:bg-rose-500/15 dark:text-rose-100",
                              )}
                            >
                              {deletingId === computer.id ? (
                                <Spinner size={14} />
                              ) : (
                                <Trash2 className="h-3.5 w-3.5 transition-transform group-hover:scale-110" />
                              )}
                              <span className="hidden sm:inline">Eliminar</span>
                            </Button>
                          )}
                        </div>
                      </div>
                      <div className="mt-4 grid gap-3 text-xs text-muted-foreground">
                        <div className="flex items-center justify-between">
                          <span className="font-semibold uppercase tracking-[0.18em] text-muted-foreground/70">
                            Servicio
                          </span>
                          <Badge
                            variant={
                              computer.serviceRunning ? "success" : "secondary"
                            }
                            className={cn(
                              "rounded-full border border-border/50 bg-muted/30 px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground",
                              !computer.serviceRunning &&
                                "border border-border/50 bg-muted/40 text-muted-foreground",
                            )}
                          >
                            {computer.serviceRunning
                              ? "200 OK"
                              : "Sin respuesta"}
                          </Badge>
                        </div>
                        {computer.lastServiceCheck && (
                          <div className="flex items-center justify-between">
                            <span className="font-semibold uppercase tracking-[0.18em] text-muted-foreground/70">
                              Último ping
                            </span>
                            <span>{formatTime(computer.lastServiceCheck)}</span>
                          </div>
                        )}
                        <div className="flex items-center justify-between">
                          <span className="font-semibold uppercase tracking-[0.18em] text-muted-foreground/70">
                            Última conexión
                          </span>
                          <span>
                            {computer.lastSeen
                              ? formatDateTime(computer.lastSeen)
                              : "Nunca"}
                          </span>
                        </div>
                        <div className="flex items-center justify-between">
                          <span className="font-semibold uppercase tracking-[0.18em] text-muted-foreground/70">
                            Alta
                          </span>
                          <span>{formatDateTime(computer.createdAt)}</span>
                        </div>
                      </div>
                    </motion.div>
                  );
                })}
              </div>

              <ScrollArea className="hidden max-h-[min(65vh,500px)] pr-3 md:block">
                <Table className="w-full min-w-[1100px]">
                  <TableHeader className="sticky top-0 z-10 bg-card/95 backdrop-blur-xl">
                    <TableRow className="border-border/40">
                      <SortableTableHead
                        column="name"
                        currentSortKey={sortConfig.key}
                        currentSortDirection={sortConfig.direction}
                        onSort={requestSort}
                        className="text-muted-foreground"
                      >
                        Nombre
                      </SortableTableHead>
                      <SortableTableHead
                        column="ipAddress"
                        currentSortKey={sortConfig.key}
                        currentSortDirection={sortConfig.direction}
                        onSort={requestSort}
                        className="text-muted-foreground"
                      >
                        Dirección IP
                      </SortableTableHead>
                      <SortableTableHead
                        column="isActive"
                        currentSortKey={sortConfig.key}
                        currentSortDirection={sortConfig.direction}
                        onSort={requestSort}
                        className="text-muted-foreground"
                      >
                        Estado
                      </SortableTableHead>
                      <SortableTableHead
                        column="serviceRunning"
                        currentSortKey={sortConfig.key}
                        currentSortDirection={sortConfig.direction}
                        onSort={requestSort}
                        className="text-muted-foreground"
                      >
                        Servicio
                      </SortableTableHead>
                      <SortableTableHead
                        column="lastSeen"
                        currentSortKey={sortConfig.key}
                        currentSortDirection={sortConfig.direction}
                        onSort={requestSort}
                        className="text-muted-foreground"
                      >
                        Última conexión
                      </SortableTableHead>
                      <SortableTableHead
                        column="createdAt"
                        currentSortKey={sortConfig.key}
                        currentSortDirection={sortConfig.direction}
                        onSort={requestSort}
                        className="text-muted-foreground"
                      >
                        Fecha registro
                      </SortableTableHead>
                      <SortableTableHead
                        column="id"
                        currentSortKey={sortConfig.key}
                        currentSortDirection={sortConfig.direction}
                        onSort={requestSort}
                        className="text-muted-foreground"
                      >
                        USB
                      </SortableTableHead>
                      {onDelete && (
                        <SortableTableHead
                          column="id"
                          currentSortKey={sortConfig.key}
                          currentSortDirection={sortConfig.direction}
                          onSort={requestSort}
                          className="text-muted-foreground"
                          align="right"
                        >
                          Acciones
                        </SortableTableHead>
                      )}
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {paginatedComputers.map((computer) => (
                      <TableRow
                        key={computer.id}
                        className="group group transition-colors duration-150"
                      >
                        <TableCell className="font-semibold text-foreground">
                          {computer.name}
                        </TableCell>
                        <TableCell className="text-muted-foreground">
                          {computer.ipAddress}
                        </TableCell>
                        <TableCell>
                          <StatusBadge active={computer.isActive} />
                        </TableCell>
                        <TableCell>
                          <div className="flex flex-col gap-1">
                            <Badge
                              variant={
                                computer.serviceRunning
                                  ? "success"
                                  : "secondary"
                              }
                              className={cn(
                                "shadow-sm",
                                !computer.serviceRunning &&
                                  "border border-border/50 bg-muted/40 text-muted-foreground",
                              )}
                            >
                              {computer.serviceRunning
                                ? "200 OK"
                                : "Sin respuesta"}
                            </Badge>
                            {computer.lastServiceCheck && (
                              <span className="text-[10px] text-muted-foreground">
                                {formatTime(computer.lastServiceCheck)}
                              </span>
                            )}
                          </div>
                        </TableCell>
                        <TableCell className="text-muted-foreground">
                          {computer.lastSeen
                            ? formatDateTime(computer.lastSeen)
                            : "Nunca"}
                        </TableCell>
                        <TableCell className="text-muted-foreground">
                          {formatDateTime(computer.createdAt)}
                        </TableCell>
                        <TableCell className="text-muted-foreground">
                          {(() => {
                            const canViewUsb =
                              computer.isActive && computer.serviceRunning;
                            return (
                              <Button
                                type="button"
                                size="sm"
                                disabled={!canViewUsb}
                                onClick={() => setSelectedComputer(computer)}
                                aria-label={`Ver USB de ${computer.name}`}
                                title="Ver USB conectados"
                                className={cn(
                                  "group relative h-8 gap-1.5 rounded-full px-3 text-xs font-semibold transition-all duration-200",
                                  canViewUsb
                                    ? "border border-emerald-200/60 bg-emerald-500/10 text-emerald-700 shadow-sm hover:-translate-y-0.5 hover:border-emerald-300 hover:bg-emerald-500/20 hover:shadow-md dark:border-emerald-400/40 dark:bg-emerald-500/15 dark:text-emerald-100"
                                    : "cursor-not-allowed border border-border/30 bg-muted/20 text-muted-foreground/40",
                                )}
                              >
                                <Usb className="h-3.5 w-3.5 transition-transform group-hover:scale-110" />
                                <span className="hidden lg:inline">
                                  Ver USB
                                </span>
                              </Button>
                            );
                          })()}
                        </TableCell>
                        {onDelete && (
                          <TableCell className="text-center">
                            <div className="flex justify-center">
                              <Button
                                type="button"
                                size="sm"
                                disabled={deletingId === computer.id}
                                onClick={() => setPendingDelete(computer)}
                                aria-label={`Eliminar ${computer.name}`}
                                title="Eliminar equipo"
                                className={cn(
                                  "group relative h-8 gap-1.5 rounded-full px-3 text-xs font-semibold transition-all duration-200",
                                  deletingId === computer.id
                                    ? "cursor-wait border border-rose-300/60 bg-rose-500/20 text-rose-50 dark:border-rose-400/40 dark:bg-rose-500/25 dark:text-rose-100"
                                    : "border border-rose-200/60 bg-rose-500/10 text-rose-700 shadow-sm hover:-translate-y-0.5 hover:border-rose-300 hover:bg-rose-500/20 hover:shadow-md dark:border-rose-400/40 dark:bg-rose-500/15 dark:text-rose-100",
                                )}
                              >
                                {deletingId === computer.id ? (
                                  <Spinner size={14} />
                                ) : (
                                  <Trash2 className="h-3.5 w-3.5 transition-transform group-hover:scale-110" />
                                )}
                                <span className="hidden xl:inline">
                                  Eliminar
                                </span>
                              </Button>
                            </div>
                          </TableCell>
                        )}
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
                <ScrollBar orientation="horizontal" />
              </ScrollArea>

              <div className="mt-4 w-full">
                <DashboardPagination
                  page={page}
                  pageSize={pageSize}
                  totalItems={computers.length}
                  onPageChange={handlePageChange}
                  onPageSizeChange={handlePageSizeChange}
                  label="computadoras"
                />
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      <AlertDialog
        open={Boolean(pendingDelete)}
        onOpenChange={(open) => {
          if (!open && deletingId === null) {
            setPendingDelete(null);
          }
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              ¿Eliminar {pendingDelete?.name ?? "este equipo"}?
            </AlertDialogTitle>
            <AlertDialogDescription>
              Esta acción removerá {pendingDelete?.name ?? "el equipo"} del
              inventario y no se puede deshacer.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deletingId !== null}>
              Cancelar
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={() => void handleConfirmDelete()}
              disabled={deletingId !== null}
              className="bg-rose-600 hover:bg-rose-700"
            >
              {deletingId !== null ? "Eliminando..." : "Eliminar"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {selectedComputer && (
        // Sheet para ver dispositivos USB del equipo seleccionado
        <USBDevicesSheet
          computer={selectedComputer}
          open={Boolean(selectedComputer)}
          onOpenChange={(open) => {
            if (!open) setSelectedComputer(null);
          }}
        />
      )}
    </motion.section>
  );
}
