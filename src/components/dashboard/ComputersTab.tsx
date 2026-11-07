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
  ArrowUpCircle,
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
import { Computer, formatDateTime } from "./types";
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
import { InstallTaskDialog } from "./InstallTaskDialog";
import { useRouter } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Rocket } from "lucide-react";

/**
 * Copia texto al portapapeles devolviendo si lo logró. La API
 * moderna solo existe en contextos seguros (HTTPS o localhost):
 * entrando al panel por la IP de la LAN en HTTP no está disponible
 * y el botón quedaba muerto; en ese caso se usa el método clásico
 * con un textarea temporal, que funciona en cualquier contexto.
 */
async function copiarAlPortapapeles(texto: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(texto);
      return true;
    }
  } catch {
    // Se intenta el método clásico.
  }
  try {
    const area = document.createElement("textarea");
    area.value = texto;
    area.style.position = "fixed";
    area.style.opacity = "0";
    document.body.appendChild(area);
    area.focus();
    area.select();
    const ok = document.execCommand("copy");
    area.remove();
    return ok;
  } catch {
    return false;
  }
}

interface Props {
  computers: Computer[];
  loading: boolean;
  onDelete?: (id: string) => Promise<void> | void;
  onBulkDelete?: (ids: string[]) => Promise<void> | void;
}

const COLUMNAS_ORDEN: { key: keyof Computer; label: string }[] = [
  { key: "name", label: "Nombre" },
  { key: "ipAddress", label: "Dirección IP" },
  { key: "isActive", label: "Servicio" },
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
  const router = useRouter();
  const queryClient = useQueryClient();
  const [instalarAbierto, setInstalarAbierto] = useState(false);
  const [actualizandoId, setActualizandoId] = useState<string | null>(null);
  const [ordenesCreadas, setOrdenesCreadas] = useState<ReadonlySet<string>>(
    new Set(),
  );

  const actualizarAgente = useCallback(
    async (computer: Computer) => {
      const csrfToken = getCsrfTokenFromDocument();
      if (!csrfToken) {
        toast({
          title: "Sesión sin token de seguridad",
          description: "Inicia sesión nuevamente.",
          variant: "destructive",
        });
        return;
      }
      try {
        setActualizandoId(computer.id);
        const res = await fetch("/api/agent/comandos", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-csrf-token": csrfToken,
          },
          credentials: "include",
          body: JSON.stringify({
            pcName: computer.name,
            tipo: "actualizar",
          }),
        });
        const datos = await res.json().catch(() => null);
        if (!res.ok || !datos?.ok) {
          toast({
            title: "No se pudo crear la orden",
            description:
              datos?.error || "El panel no aceptó la orden de actualización.",
            variant: "destructive",
          });
          return;
        }
        setOrdenesCreadas((prev) => new Set(prev).add(computer.id));
        toast({
          title: "Orden de actualización creada",
          description: `${computer.name} se actualizará solo por su canal en cuanto recoja la orden.`,
        });
      } catch {
        toast({
          title: "No se pudo contactar con el panel",
          variant: "destructive",
        });
      } finally {
        setActualizandoId(null);
      }
    },
    [toast],
  );
  const [busqueda, setBusqueda] = useState("");
  const [tokenAbierto, setTokenAbierto] = useState(false);
  const [tokenPc, setTokenPc] = useState("");
  const [tokenValor, setTokenValor] = useState<string | null>(null);
  const [tokenUsuarioId, setTokenUsuarioId] = useState("");
  const [usuariosToken, setUsuariosToken] = useState<
    { id: string; username: string }[]
  >([]);

  // La lista de usuarios para el selector de dueño se pide al
  // abrir el diálogo: no hace falta tenerla cargada en la pestaña.
  useEffect(() => {
    if (!tokenAbierto) return;
    let cancelado = false;
    void fetch("/api/users?page=1&pageSize=100")
      .then((r) => (r.ok ? r.json() : null))
      .then((datos) => {
        if (cancelado || !datos?.items) return;
        setUsuariosToken(
          (datos.items as any[]).map((u) => ({
            id: String(u.id),
            username: String(u.username),
          })),
        );
      })
      .catch(() => undefined);
    return () => {
      cancelado = true;
    };
  }, [tokenAbierto]);
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
        // Provisionar crea el equipo en el servidor (y revocar
        // cambia su estado): sin invalidar la consulta, la lista
        // de Equipos no enseñaba el alta hasta recargar la página.
        await queryClient.invalidateQueries({ queryKey: ["computers"] });
        // Dueño elegido en el propio diálogo: con el token ya
        // generado, el usuario queda asignado a este equipo sin
        // tener que ir a la pestaña de Usuarios a enlazarlo.
        if (metodo === "POST" && tokenUsuarioId && datos.computerId) {
          const elegido = usuariosToken.find((u) => u.id === tokenUsuarioId);
          try {
            const r = await fetch(`/api/users/${tokenUsuarioId}`, {
              method: "PATCH",
              headers: {
                "Content-Type": "application/json",
                "x-csrf-token": csrfToken,
              },
              credentials: "include",
              body: JSON.stringify({ computerId: datos.computerId }),
            });
            const d = await r.json().catch(() => null);
            if (!r.ok || !d?.ok) {
              throw new Error(d?.error || "El servidor no respondió bien");
            }
            toast({
              title: `Dueño asignado: ${elegido?.username ?? "usuario"}`,
              description: `${datos.pcName} queda a su nombre para los desbloqueos.`,
            });
            await queryClient.invalidateQueries({ queryKey: ["users"] });
          } catch {
            toast({
              title: "El token se generó, pero el dueño no se asignó",
              description: "Puedes asignarlo desde la pestaña Usuarios.",
              variant: "destructive",
            });
          }
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
    [tokenPc, toast, queryClient, tokenUsuarioId, usuariosToken],
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
        { label: "Servicio activo", value: "--" },
        { label: "Inventario", value: "--" },
      ];
    }

    const activeCount = sortedData.filter(
      (computer) => computer.isActive,
    ).length;
    const total = sortedData.length;

    const porActualizar = sortedData.filter(
      (computer) => computer.actualizacionDisponible,
    ).length;
    return [
      { label: "Servicio activo", value: activeCount.toString() },
      { label: "Inventario", value: total.toString() },
      { label: "Por actualizar", value: porActualizar.toString() },
    ];
  }, [sortedData, loading]);

  const pageCount = useMemo(() => {
    if (sortedData.length === 0) return 1;
    return Math.max(1, Math.ceil(sortedData.length / Math.max(pageSize, 1)));
  }, [sortedData.length, pageSize]);

  // Ajuste durante el render: si la página queda fuera de rango
  // (menos equipos que antes), se baja a la última válida.
  if (page > pageCount) {
    setPage(pageCount);
  }

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

  // Al cambiar la búsqueda se vuelve a la primera página
  // (ajuste durante el render al cambiar el valor anterior).
  const [prevBusqueda, setPrevBusqueda] = useState(busqueda);
  if (busqueda !== prevBusqueda) {
    setPrevBusqueda(busqueda);
    setPage(1);
  }

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

  // El botón del token vive fuera de la lista: tiene que verse
  // también sin equipos, porque el diálogo es justamente la vía
  // para dar de alta el primer equipo (crea su fila al generar).
  const botonTokenAgente = (
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
  );

  return (
    <motion.section
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35, ease: "easeOut" }}
      className="w-full"
      data-tour="computers-main"
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
        <div className="mt-4 border-t border-border pt-6">
          <div className="flex items-start gap-3 text-sm text-muted-foreground">
            <AlertTriangle className="mt-0.5 size-4 shrink-0 text-[var(--acero)]" />
            <p>
              No hay computadoras monitoreadas aún. Genera el token del
              primer equipo y cópialo en su agente: el equipo queda dado
              de alta en cuanto el agente se presenta con ese token.
            </p>
          </div>
          <div className="mt-4">{botonTokenAgente}</div>
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
            {botonTokenAgente}
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
              const canViewUsb = computer.isActive;
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

                  {/* Servicio: una sola palabra con punto. El dato
                      sale de la señal del agente (GET /api/computers
                      lo deriva de lastSeen): el agente ES el
                      servicio. Antes había además un «Servicio: 200
                      OK / Sin respuesta» de una sonda al :5001 que
                      nunca podía responder — era el mismo dato dos
                      veces y una de las dos mentía. */}
                  <div className="flex flex-wrap gap-x-10 gap-y-4 md:w-72 md:shrink-0">
                    <Dato etiqueta="Servicio">
                      <PalabraEstado activo={computer.isActive}>
                        {computer.isActive ? "En ejecución" : "Sin señal"}
                      </PalabraEstado>
                    </Dato>
                    <Dato etiqueta="Versión del agente">
                      <span className="text-sm text-foreground">
                        {computer.agentVersion
                          ? `v${computer.agentVersion}`
                          : "Sin anunciar"}
                      </span>
                      {computer.actualizacionDisponible && (
                        <span className="mt-1 flex items-center gap-2">
                          <span className="inline-flex items-center border border-amber-600/50 px-1.5 py-0.5 text-[11px] font-medium text-amber-700 dark:text-amber-500">
                            Actualización disponible
                            {computer.versionPaquete
                              ? ` · v${computer.versionPaquete}`
                              : ""}
                          </span>
                          <button
                            type="button"
                            disabled={
                              actualizandoId === computer.id ||
                              ordenesCreadas.has(computer.id)
                            }
                            onClick={() => void actualizarAgente(computer)}
                            className="smallcaps inline-flex items-center gap-1 text-[var(--acero)] underline decoration-[var(--acero)] decoration-2 underline-offset-4 transition-opacity disabled:no-underline disabled:opacity-60"
                          >
                            {actualizandoId === computer.id ? (
                              <Spinner size={12} />
                            ) : (
                              <ArrowUpCircle className="size-3.5" />
                            )}
                            {ordenesCreadas.has(computer.id)
                              ? "Orden creada"
                              : "Actualizar"}
                          </button>
                        </span>
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
                    <span
                      className={`mr-1 inline-flex min-w-6 items-center justify-center border px-1.5 py-0.5 text-[11px] font-semibold tabular-nums ${
                        (computer.usbConectados ?? 0) > 0
                          ? "border-[var(--acero)]/60 text-[var(--acero)]"
                          : "border-border text-muted-foreground"
                      }`}
                      title="USB conectados ahora"
                      aria-label={`${computer.usbConectados ?? 0} USB conectados ahora`}
                    >
                      {computer.usbConectados ?? 0}
                    </span>
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

          {bulk.count > 0 && (
            <div className="mt-3 flex justify-end">
              <Button onClick={() => setInstalarAbierto(true)}>
                <Rocket className="mr-2 size-4" />
                Instalar el agente en los seleccionados
              </Button>
            </div>
          )}

          <InstallTaskDialog
            open={instalarAbierto}
            onOpenChange={setInstalarAbierto}
            destinos={computers
              .filter((c) => bulk.selected.has(c.id))
              .map((c) => ({ pcName: c.name, ip: c.ipAddress }))}
            onCreada={() => {
              bulk.clear();
              router.push("/admin/tasks");
            }}
          />

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
            <label className="smallcaps mt-2 text-muted-foreground">
              Usuario dueño (opcional)
            </label>
            <Select
              value={tokenUsuarioId || "ninguno"}
              onValueChange={(v) =>
                setTokenUsuarioId(v === "ninguno" ? "" : v)
              }
            >
              <SelectTrigger className="rounded-none">
                <SelectValue placeholder="Sin asignar" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="ninguno">Sin asignar</SelectItem>
                {usuariosToken.map((u) => (
                  <SelectItem key={u.id} value={u.id}>
                    {u.username}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-[11px] leading-relaxed text-muted-foreground">
              Si eliges uno, al generar el token ese usuario queda como
              dueño de este equipo: podrá desbloquear sus dispositivos
              con su contraseña, sin pasar por la pestaña Usuarios.
            </p>
            {tokenValor && (
              <div className="mt-2 flex items-center gap-2 border border-border bg-muted/30 p-3">
                <code className="flex-1 select-all break-all font-mono text-xs">
                  {tokenValor}
                </code>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  className="rounded-none"
                  onClick={() => {
                    void copiarAlPortapapeles(tokenValor).then((ok) => {
                      toast(
                        ok
                          ? { title: "Token copiado" }
                          : {
                              title: "No se pudo copiar",
                              description:
                                "Toca el token para seleccionarlo entero y cópialo a mano.",
                              variant: "destructive",
                            },
                      );
                    });
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
              variant="ghost"
              className="rounded-none"
              onClick={() => setTokenAbierto(false)}
            >
              Cerrar
            </Button>
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
