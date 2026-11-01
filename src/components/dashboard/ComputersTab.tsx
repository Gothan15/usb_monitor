"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { motion } from "framer-motion";
import { Skeleton } from "@/components/ui/skeleton";
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
  ArrowDown,
  ArrowUp,
  Copy,
  KeyRound,
  Router,
  Search,
  Wifi,
} from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { getCsrfTokenFromDocument } from "@/lib/utils";
import { useToast } from "@/hooks/use-toast";
import { Computer, formatDateTime, formatTime } from "./types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { DashboardPagination } from "./DashboardPagination";
import {
  BulkBar,
  PageCheckbox,
  RowCheckbox,
  useBulkSelection,
} from "./BulkSelection";
import { useTableSort } from "@/hooks/useTableSort";
import { USBDevicesSheet } from "./USBDevicesSheet";
import { Spinner } from "@/components/ui/spinner";

interface Props {
  computers: Computer[];
  loading: boolean;
  onDelete?: (id: string) => Promise<void> | void;
  onBulkDelete?: (ids: string[]) => Promise<void> | void;
}

const COLUMNAS_ORDEN: { key: keyof Computer; label: string }[] = [
  { key: "name", label: "Nombre" },
  { key: "ipAddress", label: "Dirección IP" },
  { key: "isActive", label: "Estado" },
  { key: "serviceRunning", label: "Servicio" },
  { key: "lastSeen", label: "Última conexión" },
  { key: "createdAt", label: "Registro" },
];

/** Dato de registro: etiqueta en versalitas y valor debajo. */
function Dato({
  etiqueta,
  children,
}: {
  etiqueta: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <p className="smallcaps text-muted-foreground">{etiqueta}</p>
      <div className="mt-1.5">{children}</div>
    </div>
  );
}

/** Estado como palabra precedida de un punto de color. */
function PalabraEstado({
  activo,
  children,
}: {
  activo: boolean;
  children: React.ReactNode;
}) {
  return (
    <span className="inline-flex items-center gap-2 text-sm text-foreground">
      <span
        className={cn(
          "size-1.5 shrink-0 rounded-full",
          activo ? "bg-emerald-500" : "bg-muted-foreground/40",
        )}
      />
      {children}
    </span>
  );
}

export function ComputersTab({ computers, loading, onDelete, onBulkDelete }: Props) {
  const { toast } = useToast();
  const [busqueda, setBusqueda] = useState("");
  const [tokenAbierto, setTokenAbierto] = useState(false);
  const [tokenPc, setTokenPc] = useState("");
  const [tokenValor, setTokenValor] = useState<string | null>(null);
  const [tokenOcupado, setTokenOcupado] = useState(false);

  const llamarProvision = useCallback(
    async (metodo: "POST" | "DELETE") => {
      const nombre = tokenPc.trim();
      if (!nombre) {
        toast({
          title: "Escribe el nombre del equipo",
          variant: "destructive",
        });
        return;
      }
      const csrfToken = getCsrfTokenFromDocument();
      if (!csrfToken) {
        toast({ title: "Sesión sin token CSRF", variant: "destructive" });
        return;
      }
      setTokenOcupado(true);
      try {
        const respuesta = await fetch("/api/agent/provision-token", {
          method: metodo,
          headers: {
            "Content-Type": "application/json",
            "x-csrf-token": csrfToken,
          },
          body: JSON.stringify({ pcName: nombre }),
        });
        const datos = await respuesta.json().catch(() => null);
        if (!respuesta.ok || !datos?.ok) {
          throw new Error(datos?.error || "El servidor no respondió bien");
        }
        if (metodo === "POST") {
          setTokenValor(datos.token);
          toast({ title: `Token generado para ${datos.pcName}` });
        } else {
          setTokenValor(null);
          toast({ title: `Token revocado para ${datos.pcName}` });
        }
      } catch (error: any) {
        toast({
          title: "No se pudo completar",
          description: error?.message,
          variant: "destructive",
        });
      } finally {
        setTokenOcupado(false);
      }
    },
    [tokenPc, toast],
  );
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [pendingDelete, setPendingDelete] = useState<Computer | null>(null);
  const [selectedComputer, setSelectedComputer] = useState<Computer | null>(
    null,
  );

  const { sortedData, sortConfig, requestSort } =
    useTableSort<Computer>(computers);

  const bulk = useBulkSelection();
  const [bulkBusy, setBulkBusy] = useState(false);

  const handleBulkConfirm = useCallback(async () => {
    if (!onBulkDelete || bulk.count === 0) return;
    try {
      setBulkBusy(true);
      await onBulkDelete([...bulk.selected]);
      bulk.clear();
    } catch (error) {
      console.error("Error al eliminar equipos por lotes", error);
    } finally {
      setBulkBusy(false);
    }
  }, [onBulkDelete, bulk]);

  const quickStats = useMemo(() => {
    if (loading) {
      return [
        { label: "Activos", value: "--" },
        { label: "Servicio OK", value: "--" },
        { label: "Inventario", value: "--" },
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
      { label: "Activos", value: activeCount.toString() },
      { label: "Servicio OK", value: runningCount.toString() },
      { label: "Inventario", value: total.toString() },
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

  const filtrados = useMemo(() => {
    const q = busqueda.trim().toLowerCase();
    if (!q) return sortedData;
    return sortedData.filter(
      (c) =>
        c.name.toLowerCase().includes(q) ||
        (c.ipAddress ?? "").toLowerCase().includes(q),
    );
  }, [sortedData, busqueda]);

  useEffect(() => {
    setPage(1);
  }, [busqueda]);

  const paginatedComputers = useMemo(() => {
    if (filtrados.length === 0) return [];
    const start = (page - 1) * pageSize;
    return filtrados.slice(start, start + pageSize);
  }, [filtrados, page, pageSize]);

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
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35, ease: "easeOut" }}
      className="w-full"
    >
      {/* ── Cabecera plana ── */}
      <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
        <div className="flex flex-1 flex-col">
          <h2 className="font-display text-[1.7rem] font-bold leading-tight text-foreground">
            Registro de agentes
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Inventario de equipos con el agente USB instalado y el estado de
            su servicio.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-5 pb-1 text-xs text-muted-foreground">
          <span className="inline-flex items-center gap-1.5">
            <Wifi className="size-3.5 text-[var(--acero)]" />
            Estado de conectividad
          </span>
          <span className="inline-flex items-center gap-1.5">
            <Router className="size-3.5 text-[var(--acero)]" />
            Agente USB
          </span>
        </div>
      </div>

      {/* ── Tira de cifras ── */}
      <div className="mt-8 flex flex-wrap gap-x-14 gap-y-4 border-t border-border pt-5">
        {quickStats.map((stat) => (
          <div key={stat.label} className="flex items-baseline gap-3">
            <span className="font-display text-[1.7rem] font-bold leading-none tabular-nums text-foreground">
              {stat.value}
            </span>
            <span className="smallcaps text-muted-foreground">
              {stat.label}
            </span>
          </div>
        ))}
      </div>

      {loading ? (
        <div className="mt-4">
          {[...Array(5)].map((_, i) => (
            <div key={i} className="border-t border-border py-6">
              <Skeleton className="h-5 w-52 rounded-none bg-muted/40" />
              <Skeleton className="mt-2.5 h-3 w-28 rounded-none bg-muted/40" />
            </div>
          ))}
        </div>
      ) : computers.length === 0 ? (
        <div className="mt-4 flex items-start gap-3 border-t border-border pt-6 text-sm text-muted-foreground">
          <AlertTriangle className="mt-0.5 size-4 shrink-0 text-[var(--acero)]" />
          <p>No hay computadoras monitoreadas aún.</p>
        </div>
      ) : (
        <>
          {/* ── Ordenación y búsqueda ── */}
          <div className="mt-10 flex flex-wrap items-center gap-x-5 gap-y-2">
            {onBulkDelete && (
              <PageCheckbox
                pageIds={paginatedComputers.map((c) => c.id)}
                selected={bulk.selected}
                onChange={bulk.setMany}
              />
            )}
            <Button
              type="button"
              variant="outline"
              className="rounded-none"
              onClick={() => {
                setTokenValor(null);
                setTokenAbierto(true);
              }}
            >
              <KeyRound className="mr-2 size-4" />
              Token del agente
            </Button>
            <div className="relative order-last w-full sm:order-none sm:ml-auto sm:w-auto">
              <Search className="pointer-events-none absolute left-0 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={busqueda}
                onChange={(event) => setBusqueda(event.target.value)}
                placeholder="Buscar por nombre o IP"
                className="w-full rounded-none border-0 border-b border-border bg-transparent pl-6 shadow-none focus-visible:border-[var(--acero)] focus-visible:ring-0 sm:w-[220px]"
              />
            </div>
            <span className="smallcaps text-muted-foreground/70">
              Ordenar por
            </span>
            {COLUMNAS_ORDEN.map((columna) => {
              const activo = sortConfig.key === columna.key;
              return (
                <button
                  key={columna.key}
                  type="button"
                  onClick={() => requestSort(columna.key)}
                  className={cn(
                    "smallcaps inline-flex items-center gap-1 transition-colors",
                    activo
                      ? "text-foreground underline decoration-[var(--acero)] decoration-2 underline-offset-4"
                      : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  {columna.label}
                  {activo &&
                    (sortConfig.direction === "desc" ? (
                      <ArrowDown className="size-3" />
                    ) : (
                      <ArrowUp className="size-3" />
                    ))}
                </button>
              );
            })}
          </div>

          {/* ── La flota, como lista de registros ── */}
          <ul className="mt-4 divide-y divide-border border-t border-border">
            {paginatedComputers.map((computer) => {
              const canViewUsb =
                computer.isActive && computer.serviceRunning;
              const eliminando = deletingId === computer.id;
              return (
                <li
                  key={computer.id}
                  className="flex flex-col gap-5 py-6 md:flex-row md:items-center md:gap-8"
                >
                  {onBulkDelete && (
                    <div className="pt-1.5 md:shrink-0">
                      <RowCheckbox
                        checked={bulk.selected.has(computer.id)}
                        onChange={() => bulk.toggle(computer.id)}
                        label={`Seleccionar ${computer.name}`}
                      />
                    </div>
                  )}

                  {/* Nombre e IP */}
                  <div className="min-w-0 md:w-60 md:shrink-0">
                    <p className="font-display truncate text-xl font-bold leading-snug text-foreground">
                      {computer.name}
                    </p>
                    <p className="mt-1 font-mono text-xs text-muted-foreground">
                      {computer.ipAddress}
                    </p>
                  </div>

                  {/* Estado y servicio, como palabras con punto */}
                  <div className="flex flex-wrap gap-x-10 gap-y-4 md:w-72 md:shrink-0">
                    <Dato etiqueta="Estado">
                      <PalabraEstado activo={computer.isActive}>
                        {computer.isActive ? "Activo" : "Inactivo"}
                      </PalabraEstado>
                    </Dato>
                    <Dato etiqueta="Servicio">
                      <PalabraEstado activo={Boolean(computer.serviceRunning)}>
                        {computer.serviceRunning
                          ? "200 OK"
                          : "Sin respuesta"}
                      </PalabraEstado>
                      {computer.lastServiceCheck && (
                        <p className="mt-1 text-[11px] tabular-nums text-muted-foreground">
                          Ping {formatTime(computer.lastServiceCheck)}
                        </p>
                      )}
                    </Dato>
                  </div>

                  {/* Fechas */}
                  <div className="flex flex-wrap gap-x-10 gap-y-4 md:flex-1">
                    <Dato etiqueta="Última conexión">
                      <span className="text-sm tabular-nums text-foreground">
                        {computer.lastSeen
                          ? formatDateTime(computer.lastSeen)
                          : "Nunca"}
                      </span>
                    </Dato>
                    <Dato etiqueta="Registro">
                      <span className="text-sm tabular-nums text-foreground">
                        {formatDateTime(computer.createdAt)}
                      </span>
                    </Dato>
                  </div>

                  {/* Acciones de texto */}
                  <div className="flex items-center gap-1 md:ml-auto md:shrink-0">
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      disabled={!canViewUsb}
                      onClick={() => setSelectedComputer(computer)}
                      aria-label={`Ver USB de ${computer.name}`}
                      title="Ver USB conectados"
                    >
                      Ver USB
                    </Button>
                    {onDelete && (
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        disabled={eliminando}
                        onClick={() => setPendingDelete(computer)}
                        aria-label={`Eliminar ${computer.name}`}
                        title="Eliminar equipo"
                        className="text-destructive hover:text-destructive"
                      >
                        {eliminando ? <Spinner size={14} /> : "Eliminar"}
                      </Button>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>

          {busqueda.trim() && filtrados.length === 0 && (
            <p className="border-t border-border pt-6 text-sm text-muted-foreground">
              Ningún equipo coincide con «{busqueda.trim()}».
            </p>
          )}

          {onBulkDelete && (
            <BulkBar
              count={bulk.count}
              unidad="equipo"
              busy={bulkBusy}
              onConfirm={() => void handleBulkConfirm()}
              onCancel={bulk.clear}
            />
          )}

          {/* ── Paginación ── */}
            <DashboardPagination
              page={page}
              pageSize={pageSize}
              totalItems={filtrados.length}
              onPageChange={handlePageChange}
              onPageSizeChange={handlePageSizeChange}
              label="computadoras"
            />

        </>
      )}

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

      <Dialog
        open={tokenAbierto}
        onOpenChange={(open) => {
          setTokenAbierto(open);
          if (!open) setTokenValor(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Token del agente</DialogTitle>
            <DialogDescription>
              Cada equipo se acredita ante el panel con su propio token.
              Genera uno y cópialo en la caja de herramientas del agente
              de ese equipo: se muestra una sola vez y generar otro
              invalida el anterior.
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-2">
            <label className="smallcaps text-muted-foreground">
              Nombre del equipo
            </label>
            <Input
              value={tokenPc}
              onChange={(event) => setTokenPc(event.target.value)}
              placeholder="PC-RECEPCION"
              list="nombres-equipos-token"
              className="rounded-none font-mono"
            />
            <datalist id="nombres-equipos-token">
              {computers.map((c) => (
                <option key={c.id} value={c.name} />
              ))}
            </datalist>
            {tokenValor && (
              <div className="mt-2 flex items-center gap-2 border border-border bg-muted/30 p-3">
                <code className="flex-1 break-all font-mono text-xs">
                  {tokenValor}
                </code>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  className="rounded-none"
                  onClick={() => {
                    void navigator.clipboard.writeText(tokenValor);
                    toast({ title: "Token copiado" });
                  }}
                >
                  <Copy className="mr-1 size-3.5" />
                  Copiar
                </Button>
              </div>
            )}
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              className="rounded-none"
              disabled={tokenOcupado}
              onClick={() => void llamarProvision("DELETE")}
            >
              Revocar
            </Button>
            <Button
              type="button"
              className="rounded-none"
              disabled={tokenOcupado}
              onClick={() => void llamarProvision("POST")}
            >
              {tokenOcupado ? "Trabajando..." : "Generar token"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

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
