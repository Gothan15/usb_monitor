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
  ArrowUpCircle,
  KeyRound,
  Router,
  Wifi,
} from "lucide-react";
import { HttpError } from "@/lib/http";
import * as equiposApi from "@/lib/api/equipos";
import { useToast } from "@/hooks/use-toast";
import { Computer, formatDateTime, haceCuanto } from "./types";
import { OrdenarPor } from "./OrdenarPor";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { DashboardPagination } from "./DashboardPagination";
import {
  BulkBar,
  PageCheckbox,
  RowCheckbox,
  useBulkSelection,
} from "./BulkSelection";
import { useTableSort } from "@/hooks/useTableSort";
import { useBusqueda } from "@/hooks/useBusqueda";
import { CampoBusqueda } from "@/components/shared/CampoBusqueda";
import { USBDevicesSheet } from "./USBDevicesSheet";
import { Spinner } from "@/components/ui/spinner";
import { InstallTaskDialog } from "./InstallTaskDialog";
import { CredentialDialog } from "./CredentialDialog";
import { useRouter } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import { Rocket } from "lucide-react";

interface Props {
  computers: Computer[];
  loading: boolean;
  onDelete?: (id: string) => Promise<void> | void;
  onBulkDelete?: (ids: string[]) => Promise<void> | void;
}

// Columnas de la tabla de equipos: la cabecera y cada fila
// comparten esta rejilla para que los valores queden alineados
// en columnas en vez de apilados dentro de la fila.
const GRID =
  "md:grid md:grid-cols-[1.75rem_minmax(10rem,1.15fr)_7.5rem_minmax(17rem,1.6fr)_10rem_10rem_2.5rem_minmax(15rem,auto)] md:items-center md:gap-x-5";

const COLUMNAS_ORDEN: { key: keyof Computer; label: string }[] = [
  { key: "name", label: "Nombre" },
  { key: "ipAddress", label: "Dirección IP" },
  { key: "isActive", label: "Servicio" },
  { key: "lastSeen", label: "Última conexión" },
  { key: "createdAt", label: "Registro" },
];

// Campos por los que busca el campo de búsqueda. Constante de
// módulo a propósito: `useBusqueda` memoiza su índice por la
// identidad de esta lista.
const CAMPOS_BUSQUEDA: readonly (keyof Computer)[] = ["name", "ipAddress"];

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
      try {
        setActualizandoId(computer.id);
        await equiposApi.crearOrdenActualizacion(computer.name);
        setOrdenesCreadas((prev) => new Set(prev).add(computer.id));
        toast({
          title: "Orden de actualización creada",
          description: `${computer.name} se actualizará solo por su canal en cuanto recoja la orden.`,
        });
      } catch (error) {
        // HttpError trae el motivo del servidor; el resto es
        // que el panel no respondió.
        if (error instanceof HttpError) {
          toast({
            title: "No se pudo crear la orden",
            description:
              error.message || "El panel no aceptó la orden de actualización.",
            variant: "destructive",
          });
        } else {
          toast({
            title: "No se pudo contactar con el panel",
            variant: "destructive",
          });
        }
      } finally {
        setActualizandoId(null);
      }
    },
    [toast],
  );

  // Detener el apagado desde el panel: se confirma en un
  // diálogo y se crea la orden «cancelar-apagado»; el agente la
  // recoge en segundos porque, con la cuenta en curso, su
  // sondeo de configuración corre acelerado.
  const [pendingDetener, setPendingDetener] = useState<Computer | null>(null);
  const [deteniendoId, setDeteniendoId] = useState<string | null>(null);
  const [apagadosDetenidos, setApagadosDetenidos] = useState<ReadonlySet<string>>(
    new Set(),
  );

  const detenerApagado = useCallback(
    async (computer: Computer) => {
      try {
        setDeteniendoId(computer.id);
        await equiposApi.cancelarApagado(computer.id);
        setApagadosDetenidos((prev) => new Set(prev).add(computer.id));
        setPendingDetener(null);
        toast({
          title: "Orden de detener el apagado enviada",
          description: `${computer.name} cancelará la cuenta atrás en cuanto recoja la orden (segundos).`,
        });
      } catch (error) {
        if (error instanceof HttpError) {
          toast({
            title: "No se pudo crear la orden",
            description:
              error.message || "El panel no aceptó la orden de detener el apagado.",
            variant: "destructive",
          });
        } else {
          toast({
            title: "No se pudo contactar con el panel",
            variant: "destructive",
          });
        }
      } finally {
        setDeteniendoId(null);
      }
    },
    [toast],
  );
  const [busqueda, setBusqueda] = useState("");
  const [tokenAbierto, setTokenAbierto] = useState(false);
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

  // Reiniciar el servicio del agente a distancia (botón de la
  // fila o de la selección): crea la orden «reiniciar» y el
  // agente, al recogerla, se reinicia y relee la configuración
  // al arrancar — los ajustes guardados quedan aplicados al
  // momento —. Mientras la orden vive, el servidor lo dice con
  // reinicioEnCurso y el botón enseña su ruleta.
  const [reiniciandoIds, setReiniciandoIds] = useState<ReadonlySet<string>>(
    new Set(),
  );
  const [reiniciandoBulk, setReiniciandoBulk] = useState(false);

  const reiniciarServicio = useCallback(
    async (objetivos: Computer[]) => {
      if (objetivos.length === 0) return;
      const ids = objetivos.map((c) => c.id);
      const esBulk = objetivos.length > 1;
      if (esBulk) setReiniciandoBulk(true);
      else
        setReiniciandoIds((prev) => new Set(prev).add(ids[0]));
      try {
        const datos = await equiposApi.reiniciarServicio(ids);
        const creadas = datos.creadas ?? [];
        const omitidas = datos.omitidas ?? [];
        if (!esBulk) {
          if (creadas.length === 1) {
            toast({
              title: "Reinicio en curso",
              description: `${creadas[0].pcName} reiniciará su servicio y aplicará la configuración al arrancar.`,
            });
          } else {
            toast({
              title: "Sin reinicio",
              description:
                omitidas[0]?.motivo || "El equipo no aceptó la orden.",
              variant: "destructive",
            });
          }
        } else {
          toast({
            title: `Reinicio en curso en ${creadas.length} equipo(s)`,
            description:
              omitidas.length > 0
                ? `${omitidas.length} omitido(s): ${omitidas
                    .map((o) => o.motivo)
                    .filter((v, i, a) => a.indexOf(v) === i)
                    .join("; ")}.`
                : "Cada servicio aplicará la configuración al arrancar.",
          });
          if (creadas.length > 0) bulk.clear();
        }
      } catch (error) {
        if (error instanceof HttpError) {
          toast({
            title: "No se pudo crear la orden",
            description:
              error.message || "El panel no aceptó la orden de reinicio.",
            variant: "destructive",
          });
        } else {
          toast({
            title: "No se pudo contactar con el panel",
            variant: "destructive",
          });
        }
      } finally {
        if (esBulk) setReiniciandoBulk(false);
        else
          setReiniciandoIds((prev) => {
            const next = new Set(prev);
            next.delete(ids[0]);
            return next;
          });
      }
    },
    [toast, bulk],
  );

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

  // Filtrado con el hook compartido: índice normalizado una vez
  // por dataset y consulta diferida (antes se re-normalizaba
  // cada campo en cada pulsación).
  const filtrados = useBusqueda(sortedData, busqueda, CAMPOS_BUSQUEDA);

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
      onClick={() => setTokenAbierto(true)}
    >
      <KeyRound className="mr-2 size-4" />
      Credencial del equipo
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
            <CampoBusqueda
              value={busqueda}
              onChange={setBusqueda}
              placeholder="Buscar por nombre o IP"
              className="order-last w-full sm:order-none sm:ml-auto sm:w-[220px]"
            />
            <OrdenarPor
              id="orden-equipos"
              columnas={COLUMNAS_ORDEN}
              sortConfig={sortConfig}
              onSort={requestSort}
            />
          </div>

          {/* ── La flota, como lista de registros ── */}
          <ul className="mt-4 divide-y divide-border border-t border-border">
            {/* Cabecera de la tabla: las etiquetas se dicen una
                sola vez aquí y cada fila alinea sus valores en
                las mismas columnas, sin apilar dato sobre dato. */}
            <li aria-hidden className={`hidden pb-2 pt-1 ${GRID}`}>
              <span />
              <span className="smallcaps text-muted-foreground/70">Equipo</span>
              <span className="smallcaps text-muted-foreground/70">Servicio</span>
              <span className="smallcaps text-muted-foreground/70">
                Versión del agente
              </span>
              <span className="smallcaps text-muted-foreground/70">
                Última conexión
              </span>
              <span className="smallcaps text-muted-foreground/70">Registro</span>
              <span className="smallcaps text-muted-foreground/70">USB</span>
              <span />
            </li>
            {paginatedComputers.map((computer) => {
              const canViewUsb = computer.isActive;
              const eliminando = deletingId === computer.id;
              return (
                <li
                  key={computer.id}
                  className={`flex flex-col gap-3 py-4 ${GRID} md:gap-y-0`}
                >
                  {onBulkDelete && (
                    <div>
                      <RowCheckbox
                        checked={bulk.selected.has(computer.id)}
                        onChange={() => bulk.toggle(computer.id)}
                        label={`Seleccionar ${computer.name}`}
                      />
                    </div>
                  )}

                  {/* Nombre e IP */}
                  <div className="min-w-0">
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
                  <div>
                    <PalabraEstado activo={computer.isActive}>
                      {computer.isActive ? "En ejecución" : "Sin señal"}
                    </PalabraEstado>
                  </div>
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1">
                      <span className="text-sm font-medium text-foreground">
                        {computer.agentVersion
                          ? `v${computer.agentVersion}`
                          : "Sin anunciar"}
                      </span>
                      {computer.actualizacionDisponible && (
                        <>
                          <span className="inline-flex items-center border border-amber-600/50 px-1.5 py-0.5 text-[0.6875rem] font-medium text-amber-700 dark:text-amber-500">
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
                        </>
                      )}
                    </div>
                    <p className="mt-1 text-[0.6875rem] text-muted-foreground">
                      {computer.lastConfigAt
                        ? `Ajustes pedidos ${haceCuanto(computer.lastConfigAt)}`
                        : "Ajustes sin pedir aún"}
                    </p>
                  </div>

                  {/* Fechas: una celda por columna */}
                  <div>
                    <span className="text-sm tabular-nums text-foreground">
                      {computer.lastSeen
                        ? formatDateTime(computer.lastSeen)
                        : "Nunca"}
                    </span>
                  </div>
                  <div>
                    <span className="text-sm tabular-nums text-foreground">
                      {formatDateTime(computer.createdAt)}
                    </span>
                  </div>

                  {/* Contador de USB conectados: su propia columna */}
                  <span
                    className={`inline-flex min-w-6 items-center justify-center justify-self-center border px-1.5 py-0.5 text-[0.6875rem] font-semibold tabular-nums ${
                        (computer.usbConectados ?? 0) > 0
                          ? "border-[var(--acero)]/60 text-[var(--acero)]"
                          : "border-border text-muted-foreground"
                      }`}
                      title="USB conectados ahora"
                      aria-label={`${computer.usbConectados ?? 0} USB conectados ahora`}
                    >
                    {computer.usbConectados ?? 0}
                  </span>

                  {/* Acciones de texto */}
                  <div className="flex items-center gap-1 md:justify-end">
                    {computer.apagadoEnCurso && (
                      <>
                        <span className="mr-1 inline-flex items-center border border-rose-600/60 px-1.5 py-0.5 text-[0.6875rem] font-semibold text-rose-700 dark:text-rose-500">
                          Apagado en curso
                        </span>
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          disabled={
                            deteniendoId === computer.id ||
                            apagadosDetenidos.has(computer.id)
                          }
                          onClick={() => setPendingDetener(computer)}
                          aria-label={`Detener el apagado en ${computer.name}`}
                          title="Detener la cuenta atrás de apagado"
                          className="text-rose-700 hover:text-rose-700 dark:text-rose-500 dark:hover:text-rose-500"
                        >
                          {deteniendoId === computer.id ? (
                            <Spinner size={14} />
                          ) : apagadosDetenidos.has(computer.id) ? (
                            "Orden enviada"
                          ) : (
                            "Detener"
                          )}
                        </Button>
                      </>
                    )}
                    {bulk.count === 0 && (
                      <>
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
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          disabled={
                            computer.reinicioEnCurso ||
                            reiniciandoIds.has(computer.id)
                          }
                          onClick={() => void reiniciarServicio([computer])}
                          aria-label={`Reiniciar el servicio en ${computer.name}`}
                          title="Reiniciar el servicio del agente: al arrancar aplica la configuración guardada"
                        >
                          {computer.reinicioEnCurso ||
                          reiniciandoIds.has(computer.id) ? (
                            <span className="inline-flex items-center gap-1.5">
                              <Spinner size={14} />
                              Reiniciando
                            </span>
                          ) : (
                            "Reiniciar"
                          )}
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
                      </>
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
            <div className="mt-3 flex flex-wrap justify-end gap-2">
              <Button
                variant="outline"
                disabled={reiniciandoBulk}
                onClick={() =>
                  void reiniciarServicio(
                    computers.filter((c) => bulk.selected.has(c.id)),
                  )
                }
              >
                {reiniciandoBulk ? (
                  <span className="inline-flex items-center gap-1.5">
                    <Spinner size={14} />
                    Reiniciando
                  </span>
                ) : (
                  "Reiniciar el servicio en los seleccionados"
                )}
              </Button>
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
              El equipo desaparece del panel y sus usuarios
              asignados quedan sin equipo. El agente de esa PC NO
              se desinstala: sigue instalado, pero su credencial
              deja de valer y ya no podrá hablar con el panel. Para
              quitarlo de la PC hay que desinstalarlo allí mismo
              (USBMonitorService.exe desinstalar) o volver a
              enrolar el equipo. Esta acción no se puede deshacer.
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

      <AlertDialog
        open={Boolean(pendingDetener)}
        onOpenChange={(open) => {
          if (!open && deteniendoId === null) {
            setPendingDetener(null);
          }
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              ¿Detener el apagado en {pendingDetener?.name ?? "este equipo"}?
            </AlertDialogTitle>
            <AlertDialogDescription>
              Se enviará la orden de cancelar la cuenta atrás de
              apagado a ese equipo. Mientras la cuenta corre, su
              agente pregunta por órdenes cada pocos segundos, así
              que la cancelación llega casi al momento. El
              dispositivo que la causó seguirá bloqueado; solo se
              detiene el apagado.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deteniendoId !== null}>
              Volver
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={() =>
                pendingDetener && void detenerApagado(pendingDetener)
              }
              disabled={deteniendoId !== null}
              className="bg-rose-600 hover:bg-rose-700"
            >
              {deteniendoId !== null ? "Enviando..." : "Detener el apagado"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <CredentialDialog
        open={tokenAbierto}
        onOpenChange={setTokenAbierto}
        computers={computers}
      />

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
