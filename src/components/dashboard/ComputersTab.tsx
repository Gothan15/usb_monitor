"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { motion } from "framer-motion";
import { useQuery, useQueryClient } from "@tanstack/react-query";
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
import { cn, getCsrfTokenFromDocument } from "@/lib/utils";
import { DashboardPagination } from "./DashboardPagination";
import { USBDevicesSheet } from "./USBDevicesSheet";
import { Spinner } from "@/components/ui/spinner";
import { fetchJson, HttpError } from "@/lib/http";
import { useToast } from "@/hooks/use-toast";

function StatusBadge({ active }: { active: boolean }) {
  return (
    <Badge
      variant={active ? "success" : "secondary"}
      className={cn(
        "shadow-sm",
        !active &&
          "border border-slate-200 bg-slate-100 text-slate-700 dark:border-white/10 dark:bg-white/10 dark:text-white"
      )}
    >
      {active ? "Activo" : "Inactivo"}
    </Badge>
  );
}

interface ComputersResponse {
  data: Computer[];
  meta: {
    total: number;
    page: number;
    limit: number;
    totalPages: number;
  };
}

export function ComputersTab() {
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [pendingDelete, setPendingDelete] = useState<Computer | null>(null);
  const [selectedComputer, setSelectedComputer] = useState<Computer | null>(
    null
  );

  const queryClient = useQueryClient();
  const { toast } = useToast();

  const { data, isLoading, isPlaceholderData } = useQuery<ComputersResponse>({
    queryKey: ["computers", page, pageSize],
    queryFn: () =>
      fetchJson<ComputersResponse>(
        `/api/computers?page=${page}&limit=${pageSize}`
      ),
    placeholderData: (previousData) => previousData,
    staleTime: 10000,
  });

  const computers = data?.data || [];
  const meta = data?.meta || { total: 0, totalPages: 1 };
  const loading = isLoading;

  const quickStats = useMemo(() => {
    if (loading && !data) {
      return [
        { label: "Total", value: "--", accent: "from-slate-300/30" },
        { label: "En línea", value: "--", accent: "from-emerald-400/30" },
        { label: "Página", value: "--", accent: "from-cyan-400/30" },
      ];
    }

    // Since we only have page data, we can't calculate global stats easily on client side accurately
    // except for Total which comes from meta.
    // We'll show Total from meta, and maybe "Visible" count?
    // Or just simple stats.
    
    return [
      {
        label: "Total",
        value: meta.total.toString(),
        accent: "from-slate-400/20 via-slate-300/10",
      },
      {
        label: "Página",
        value: `${page}/${meta.totalPages}`,
        accent: "from-sky-400/25 via-cyan-300/10",
      },
       {
        label: "Visibles",
        value: computers.length.toString(),
        accent: "from-emerald-400/25 via-emerald-300/10",
      },
    ];
  }, [loading, data, meta, page, computers.length]);

  const handlePageChange = useCallback(
    (nextPage: number) => {
      const clamped = Math.min(Math.max(nextPage, 1), meta.totalPages);
      setPage(clamped);
    },
    [meta.totalPages]
  );

  const handlePageSizeChange = useCallback((nextSize: number) => {
    setPageSize(nextSize);
    setPage(1);
  }, []);

  const handleDelete = useCallback(async (id: string) => {
      const csrfToken = getCsrfTokenFromDocument();
      if (!csrfToken) {
        throw new Error(
          "Sesión sin token de seguridad. Vuelve a iniciar sesión."
        );
      }
      const response = await fetch(`/api/computers/${id}`, {
        method: "DELETE",
        headers: {
          "x-csrf-token": csrfToken,
        },
        credentials: "include",
      });

      const data = await response.json().catch(() => null);
      if (!response.ok || !data?.ok) {
         throw new Error(data?.error || `Error HTTP ${response.status}`);
      }
      return data;
  }, []);

  const prefetchComputer = useCallback((id: string) => {
    queryClient.prefetchQuery({
      queryKey: ["computer", id],
      queryFn: () => fetchJson(`/api/computers/${id}`),
      staleTime: 1000 * 30, // 30s
    });
  }, [queryClient]);

  const handleConfirmDelete = useCallback(async () => {
    if (!pendingDelete) return;

    try {
      setDeletingId(pendingDelete.id);
      await handleDelete(pendingDelete.id);
      
      await queryClient.invalidateQueries({ queryKey: ["computers"] });
      
      toast({
        title: "Equipo eliminado",
        description: `Se eliminó ${pendingDelete.name} del inventario.`,
      });
      setPendingDelete(null);
    } catch (error: any) {
      console.error("Error al eliminar computadora", error);
       toast({
        title: "No se pudo eliminar el equipo",
        description: error.message || "Error desconocido",
        variant: "destructive",
      });
    } finally {
      setDeletingId(null);
    }
  }, [pendingDelete, handleDelete, queryClient, toast]);

  return (
    <motion.section
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35, ease: "easeOut" }}
      className="w-full"
    >
      <Card className="relative w-full overflow-hidden rounded-3xl border border-slate-200/70 bg-white/85 text-slate-900 shadow-xl supports-[backdrop-filter]:backdrop-blur-2xl dark:border-white/10 dark:bg-slate-900/50 dark:text-white">
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top_left,_rgba(16,185,129,0.12),transparent_55%),radial-gradient(circle_at_bottom_right,_rgba(14,165,233,0.12),transparent_55%)] dark:bg-[radial-gradient(circle_at_top_left,_rgba(16,185,129,0.16),transparent_45%),radial-gradient(circle_at_bottom_right,_rgba(14,165,233,0.18),transparent_50%)]" />
        <CardHeader className="relative z-10 space-y-6">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
            <div className="flex items-center gap-3">
              <span className="inline-flex size-12 items-center justify-center rounded-2xl border border-emerald-200/60 bg-white/80 text-emerald-600 shadow-sm dark:border-emerald-400/40 dark:bg-white/10 dark:text-emerald-200">
                <MonitorSmartphone className="size-5" />
              </span>
              <div>
                <CardTitle className="text-2xl font-semibold text-slate-900 dark:text-slate-100">
                  Computadoras monitoreadas
                </CardTitle>
                <CardDescription className="text-sm text-slate-600 dark:text-slate-300/80">
                  Visibilidad integral de hosts con el agente USB y su servicio.
                </CardDescription>
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-2 text-xs font-medium text-slate-600 dark:text-slate-300/80">
              <span className="inline-flex items-center gap-1 rounded-full border border-white/70 bg-white/80 px-3 py-1 shadow-sm backdrop-blur-sm dark:border-white/10 dark:bg-white/10">
                <Wifi className="size-3" />
                Estado de conectividad
              </span>
              <span className="inline-flex items-center gap-1 rounded-full border border-white/70 bg-white/80 px-3 py-1 shadow-sm backdrop-blur-sm dark:border-white/10 dark:bg-white/10">
                <Router className="size-3" />
                Agente USB
              </span>
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
                    {stat.label === "Total" ? (
                      <Cpu className="size-4" />
                    ) : stat.label === "Página" ? (
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
          {loading && !data ? (
            <div className="space-y-3">
              {[...Array(5)].map((_, i) => (
                <Skeleton
                  key={i}
                  className="h-12 rounded-2xl bg-slate-100/80 dark:bg-white/10"
                />
              ))}
            </div>
          ) : computers.length === 0 ? (
            <Alert className="rounded-2xl border-amber-200/60 bg-amber-50/90 text-amber-700 shadow-sm dark:border-amber-300/40 dark:bg-amber-500/10 dark:text-amber-100">
              <AlertTriangle className="h-4 w-4" />
              <AlertDescription>
                No hay computadoras en esta vista.
              </AlertDescription>
            </Alert>
          ) : (
            <div className="flex flex-col gap-6">
              <div className="space-y-4 md:hidden">
                {computers.map((computer) => {
                  const canViewUsb =
                    computer.isActive && computer.serviceRunning;
                  return (
                    <motion.div
                      key={computer.id}
                      whileHover={{ y: -4 }}
                      transition={{ duration: 0.2 }}
                      className="rounded-3xl border border-white/70 bg-white/85 p-5 shadow-lg supports-[backdrop-filter]:backdrop-blur-xl dark:border-white/10 dark:bg-white/5"
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <p className="text-sm font-semibold text-slate-900 dark:text-white">
                            {computer.name}
                          </p>
                          <p className="text-xs uppercase tracking-[0.2em] text-slate-500 dark:text-slate-400">
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
                                : "cursor-not-allowed border border-slate-200/60 bg-slate-100/50 text-slate-400 dark:border-white/5 dark:bg-white/5 dark:text-slate-500"
                            )}
                          >
                            <Usb className="h-3.5 w-3.5 transition-transform group-hover:scale-110" />
                            <span className="hidden lg:inline">Ver USB</span>
                          </Button>
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
                                : "border border-rose-200/60 bg-rose-500/10 text-rose-700 shadow-sm hover:-translate-y-0.5 hover:border-rose-300 hover:bg-rose-500/20 hover:shadow-md dark:border-rose-400/40 dark:bg-rose-500/15 dark:text-rose-100"
                            )}
                          >
                            {deletingId === computer.id ? (
                              <Spinner size={14} />
                            ) : (
                              <Trash2 className="h-3.5 w-3.5 transition-transform group-hover:scale-110" />
                            )}
                            <span className="hidden sm:inline">Eliminar</span>
                          </Button>
                        </div>
                      </div>
                      <div className="mt-4 grid gap-3 text-xs text-slate-600 dark:text-slate-300">
                        <div className="flex items-center justify-between">
                          <span className="font-semibold uppercase tracking-[0.18em] text-slate-400 dark:text-slate-500">
                            Servicio
                          </span>
                          <Badge
                            variant={
                              computer.serviceRunning ? "success" : "secondary"
                            }
                            className={cn(
                              "rounded-full border border-white/60 bg-white/80 px-3 py-1 text-[0.65rem] font-semibold uppercase tracking-[0.2em] text-slate-600 shadow-sm dark:border-white/15 dark:bg-white/10 dark:text-slate-200",
                              !computer.serviceRunning &&
                                "border border-slate-200 bg-slate-100 text-slate-700 dark:border-white/10 dark:bg-white/10 dark:text-white"
                            )}
                          >
                            {computer.serviceRunning
                              ? "200 OK"
                              : "Sin respuesta"}
                          </Badge>
                        </div>
                        {computer.lastServiceCheck && (
                          <div className="flex items-center justify-between">
                            <span className="font-semibold uppercase tracking-[0.18em] text-slate-400 dark:text-slate-500">
                              Último ping
                            </span>
                            <span>{formatTime(computer.lastServiceCheck)}</span>
                          </div>
                        )}
                        <div className="flex items-center justify-between">
                          <span className="font-semibold uppercase tracking-[0.18em] text-slate-400 dark:text-slate-500">
                            Última conexión
                          </span>
                          <span>
                            {computer.lastSeen
                              ? formatDateTime(computer.lastSeen)
                              : "Nunca"}
                          </span>
                        </div>
                        <div className="flex items-center justify-between">
                          <span className="font-semibold uppercase tracking-[0.18em] text-slate-400 dark:text-slate-500">
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
                  <TableHeader className="sticky top-0 z-10 bg-white/95 backdrop-blur-xl dark:bg-slate-900/80">
                    <TableRow className="border-white/60 dark:border-white/10">
                      <TableHead className="text-slate-600 dark:text-slate-200">
                        Nombre
                      </TableHead>
                      <TableHead className="text-slate-600 dark:text-slate-200">
                        Dirección IP
                      </TableHead>
                      <TableHead className="text-slate-600 dark:text-slate-200">
                        Estado
                      </TableHead>
                      <TableHead className="text-slate-600 dark:text-slate-200">
                        Servicio
                      </TableHead>
                      <TableHead className="text-slate-600 dark:text-slate-200">
                        Última conexión
                      </TableHead>
                      <TableHead className="text-slate-600 dark:text-slate-200">
                        Fecha registro
                      </TableHead>
                      <TableHead className="text-slate-600 dark:text-slate-200">
                        USB
                      </TableHead>
                      <TableHead
                        className="text-slate-600 dark:text-slate-200"
                        align="right"
                      >
                        Acciones
                      </TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {computers.map((computer) => (
                      <TableRow
                        key={computer.id}
                        onMouseEnter={() => prefetchComputer(computer.id)}
                        className="group border border-white/70 bg-white/75 transition-all duration-200 hover:-translate-y-0.5 hover:border-emerald-300/60 hover:bg-emerald-50/60 dark:border-white/5 dark:bg-white/5 dark:hover:border-emerald-400/30 dark:hover:bg-emerald-500/10"
                      >
                        <TableCell className="font-semibold text-slate-700 dark:text-slate-100">
                          {computer.name}
                        </TableCell>
                        <TableCell className="text-slate-600 dark:text-slate-300/80">
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
                                  "border border-slate-200 bg-slate-100 text-slate-700 dark:border-white/10 dark:bg-white/10 dark:text-white"
                              )}
                            >
                              {computer.serviceRunning
                                ? "200 OK"
                                : "Sin respuesta"}
                            </Badge>
                            {computer.lastServiceCheck && (
                              <span className="text-[10px] text-slate-500 dark:text-slate-400">
                                {formatTime(computer.lastServiceCheck)}
                              </span>
                            )}
                          </div>
                        </TableCell>
                        <TableCell className="text-slate-600 dark:text-slate-200">
                          {computer.lastSeen
                            ? formatDateTime(computer.lastSeen)
                            : "Nunca"}
                        </TableCell>
                        <TableCell className="text-slate-600 dark:text-slate-200">
                          {formatDateTime(computer.createdAt)}
                        </TableCell>
                        <TableCell className="text-slate-600 dark:text-slate-200">
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
                                    : "cursor-not-allowed border border-slate-200/60 bg-slate-100/50 text-slate-400 dark:border-white/5 dark:bg-white/5 dark:text-slate-500"
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
                                  : "border border-rose-200/60 bg-rose-500/10 text-rose-700 shadow-sm hover:-translate-y-0.5 hover:border-rose-300 hover:bg-rose-500/20 hover:shadow-md dark:border-rose-400/40 dark:bg-rose-500/15 dark:text-rose-100"
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
                  totalItems={meta.total}
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
