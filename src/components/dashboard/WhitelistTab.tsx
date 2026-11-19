"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { motion } from "framer-motion";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { WhitelistEntry, formatDateTime } from "./types";
import { SerialCopiable } from "./SerialCopiable";
import { DashboardPagination } from "./DashboardPagination";
import {
  BulkBar,
  PageCheckbox,
  RowCheckbox,
  useBulkSelection,
} from "./BulkSelection";
import { usePagination } from "@/hooks/usePagination";
import { useTableSort } from "@/hooks/useTableSort";
import { useBusqueda } from "@/hooks/useBusqueda";
import { CampoBusqueda } from "@/components/shared/CampoBusqueda";
import { OrdenarPor } from "./OrdenarPor";
import { Spinner } from "@/components/ui/spinner";
import * as listaBlancaApi from "@/lib/api/listaBlanca";
import { useLiveData } from "@/components/providers/LiveDataProvider";
import type { SerialConectado } from "@/lib/api/listaBlanca";

interface CreatePayload {
  serialNumber: string;
  label?: string;
  notes?: string;
}

// Campos por los que busca el campo de búsqueda. Constante de
// módulo a propósito: `useBusqueda` memoiza su índice por la
// identidad de esta lista.
const CAMPOS_BUSQUEDA: readonly (keyof WhitelistEntry)[] = [
  "serialNumber",
  "label",
  "notes",
];

interface Props {
  entries: WhitelistEntry[];
  loading: boolean;
  onCreate: (payload: CreatePayload) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
  onBulkDelete?: (ids: string[]) => Promise<void> | void;
}

// Columnas por las que se puede ordenar el registro. La de
// «Acciones» no se ofrece: no ordena por ningún dato.
const COLUMNAS_ORDEN: { key: keyof WhitelistEntry; label: string }[] = [
  { key: "serialNumber", label: "Serial" },
  { key: "label", label: "Alias" },
  { key: "notes", label: "Notas" },
  { key: "createdAt", label: "Creado" },
  { key: "createdBy", label: "Autor" },
];

export function WhitelistTab({
  entries,
  loading,
  onCreate,
  onDelete,
  onBulkDelete,
}: Readonly<Props>) {
  const [serialNumber, setSerialNumber] = useState("");
  const [label, setLabel] = useState("");
  const [notes, setNotes] = useState("");
  const [formError, setFormError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  // Seriales de los dispositivos conectados ahora mismo, para
  // el desplegable del campo de serial del alta: elegir en vez
  // de teclear, como hacía la antigua herramienta del toolbox.
  // Se lee al montar y se mantiene al día sin recargar la
  // pestaña: la flota avisa por el socket en cuanto un agente
  // reporta un cambio (devicesVersion del proveedor en vivo) y
  // los de la propia PC del panel, que no tienen agente que
  // avise, se releen cada 20 s (su lectura WMI se cachea 15 s
  // en el servidor). Al volver al campo también se refresca si
  // la lectura tiene más de 20 s. Si el panel no responde, la
  // lista queda vacía y el alta sigue siendo a mano.
  const [conectados, setConectados] = useState<SerialConectado[]>([]);
  const [menuSerialAbierto, setMenuSerialAbierto] = useState(false);
  const ultimaLecturaSeriales = useRef(0);

  const cargarConectados = useCallback(async (forzar = false) => {
    const ahora = Date.now();
    if (!forzar && ahora - ultimaLecturaSeriales.current < 20_000) return;
    ultimaLecturaSeriales.current = ahora;
    setConectados(await listaBlancaApi.conectados());
  }, []);

  useEffect(() => {
    void cargarConectados();
  }, [cargarConectados]);

  // Tiempo real de la flota: el proveedor en vivo sube
  // devicesVersion con cada aviso «usb:devices» de un agente, y
  // la lista se relee al momento saltándose el freno.
  const { devicesVersion } = useLiveData();
  const versionDispositivosRef = useRef(0);
  useEffect(() => {
    if (
      devicesVersion === 0 ||
      devicesVersion === versionDispositivosRef.current
    ) {
      return;
    }
    versionDispositivosRef.current = devicesVersion;
    void cargarConectados(true);
  }, [devicesVersion, cargarConectados]);

  // Los USB de la propia PC del panel no generan aviso: se
  // releen con la cadencia del freno de la lectura (20 s).
  useEffect(() => {
    const id = setInterval(() => {
      void cargarConectados();
    }, 20_000);
    return () => clearInterval(id);
  }, [cargarConectados]);

  // Sugerencias del desplegable: conectados que aún no están en
  // la lista blanca y que casan con lo tecleado (por serial,
  // equipo o nombre del volumen). Sin texto, se ofrecen todos.
  const serialesEnLista = useMemo(
    () => new Set(entries.map((e) => e.serialNumber.trim().toUpperCase())),
    [entries],
  );
  const sugerenciasSerial = useMemo(() => {
    const texto = serialNumber.trim().toUpperCase();
    return conectados.filter((c) => {
      if (serialesEnLista.has(c.serialNumber.trim().toUpperCase()))
        return false;
      if (!texto) return true;
      return (
        c.serialNumber.toUpperCase().includes(texto) ||
        c.pcName.toUpperCase().includes(texto) ||
        (c.volumeName || "").toUpperCase().includes(texto)
      );
    });
  }, [conectados, serialesEnLista, serialNumber]);

  const bulk = useBulkSelection();
  const [bulkBusy, setBulkBusy] = useState(false);

  const handleBulkConfirm = useCallback(async () => {
    if (!onBulkDelete || bulk.count === 0) return;
    try {
      setBulkBusy(true);
      await onBulkDelete([...bulk.selected]);
      bulk.clear();
    } catch (error) {
      console.error("Error al eliminar seriales por lotes", error);
    } finally {
      setBulkBusy(false);
    }
  }, [onBulkDelete, bulk]);

  const { sortedData, sortConfig, requestSort } =
    useTableSort<WhitelistEntry>(entries);

  const [busqueda, setBusqueda] = useState("");

  // Filtrado con el hook compartido: índice normalizado una vez
  // por dataset y consulta diferida (antes se re-normalizaba
  // cada campo en cada pulsación).
  const filtradas = useBusqueda(sortedData, busqueda, CAMPOS_BUSQUEDA);

  const { page, pageSize, setPage, setPageSize } = usePagination({
    totalItems: filtradas.length,
  });

  const totalEntries = sortedData.length;
  const latestCreatedAt = useMemo(() => {
    if (!sortedData.length) return null;
    return sortedData[0]?.createdAt ?? null;
  }, [sortedData]);
  const latestCreatedBy = sortedData[0]?.createdBy?.username;

  const numberFormatter = useMemo(() => new Intl.NumberFormat("es-ES"), []);

  const quickStats = useMemo(
    () => [
      {
        label: "Registrados",
        description: "seriales autorizados",
        value: numberFormatter.format(totalEntries),
      },
      {
        label: "Último alta",
        description: latestCreatedAt
          ? formatDateTime(latestCreatedAt)
          : "Sin registros",
        value: latestCreatedAt ? "Activo" : "Pendiente",
      },
      {
        label: "Último autor",
        description: latestCreatedBy ?? "Sistema",
        value: latestCreatedBy ? "Manual" : "Automático",
      },
      {
        label: "Estado",
        description: creating
          ? "Guardando..."
          : deletingId
            ? "Eliminando..."
            : "Sin acciones pendientes",
        value: creating || deletingId ? "En curso" : "Listo",
      },
    ],
    [
      creating,
      deletingId,
      latestCreatedAt,
      latestCreatedBy,
      numberFormatter,
      totalEntries,
    ],
  );

  const paginatedEntries = useMemo(() => {
    if (filtradas.length === 0) return [];
    const start = (page - 1) * pageSize;
    return filtradas.slice(start, start + pageSize);
  }, [filtradas, page, pageSize]);

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (creating) return;

    const payload: CreatePayload = {
      serialNumber,
      label: label || undefined,
      notes: notes || undefined,
    };

    try {
      setCreating(true);
      setFormError(null);
      await onCreate(payload);
      setSerialNumber("");
      setLabel("");
      setNotes("");
    } catch (error: any) {
      const message = error?.message || "No se pudo agregar el serial";
      setFormError(message);
    } finally {
      setCreating(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (deletingId) return;
    try {
      setDeletingId(id);
      await onDelete(id);
    } catch (error: any) {
      setFormError(error?.message || "No se pudo eliminar el serial");
    } finally {
      setDeletingId(null);
    }
  };

  return (
    <motion.section
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35, ease: "easeOut" }}
      className="w-full"
      data-tour="whitelist-main"
    >
      {/* ── Cabecera del registro ── */}
      <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
        <div className="flex flex-1 flex-col">
          <p className="smallcaps text-acero">Registro de autorizados</p>
          <h2 className="font-display mt-2 text-2xl font-bold text-foreground">
            Lista blanca de dispositivos USB
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Dispositivos conocidos por el agente. Aun estando aquí, cada
            uso pide la contraseña del dueño de la PC.
          </p>
        </div>
        <div className="flex flex-col items-end gap-3">
          <p className="text-xs text-muted-foreground">
            <span className="font-semibold text-foreground tabular-nums">
              {totalEntries}
            </span>{" "}
            permitido{totalEntries === 1 ? "" : "s"}
            {latestCreatedAt && (
              <> · Último alta: {formatDateTime(latestCreatedAt)}</>
            )}
          </p>
          <CampoBusqueda
            value={busqueda}
            onChange={setBusqueda}
            placeholder="Buscar por serial, alias o notas"
            className="w-[240px]"
          />
          {busqueda.trim() && (
            <p className="text-xs text-muted-foreground">
              {filtradas.length} coincidencia{filtradas.length === 1 ? "" : "s"}
            </p>
          )}
        </div>
      </div>

      {/* ── Tira de cifras ── */}
      <div className="mt-8 flex flex-wrap gap-x-12 gap-y-4 border-t border-border pt-5">
        {quickStats.map((stat) => (
          <div key={stat.label}>
            <div className="flex items-baseline gap-3">
              <span className="font-display text-[1.55rem] font-bold leading-none tabular-nums text-foreground">
                {stat.value}
              </span>
              <span className="smallcaps text-muted-foreground">
                {stat.label}
              </span>
            </div>
            <p className="mt-1.5 text-xs text-muted-foreground">
              {stat.description}
            </p>
          </div>
        ))}
      </div>

      {/* ── Alta nueva: una línea de asiento ── */}
      <form
        onSubmit={handleSubmit}
        className="mt-10 border-t border-border pt-6"
      >
        <p className="mb-4 text-xs text-muted-foreground">
          Agregar y quitar seriales solo funciona desde la PC del
          servidor. También puedes dar de alta un dispositivo sin
          escribir su serial: en Desbloqueos o en la ficha de su
          equipo, con el botón «A la lista blanca».
        </p>
        <div className="grid items-end gap-4 sm:grid-cols-2 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)_minmax(0,1fr)_auto]">
          <div className="flex flex-col gap-2">
            <label className="smallcaps text-muted-foreground">
              Serial del dispositivo
            </label>
            {/* Campo con desplegable de conectados: al tocar el
                campo bajan los seriales de los dispositivos
                conectados ahora mismo (con su equipo y unidad);
                un toque rellena el serial, y teclear sigue
                valiendo para un dispositivo que no esté
                conectado. Las filas son type="button" para no
                enviar el formulario al elegir, y se elige en
                onMouseDown porque el blur del campo cerraría el
                menú antes de que el clic aterrice. */}
            <div className="relative">
              <Input
                value={serialNumber}
                onChange={(event) => {
                  setSerialNumber(event.target.value);
                  setMenuSerialAbierto(true);
                }}
                onFocus={() => {
                  setMenuSerialAbierto(true);
                  void cargarConectados();
                }}
                onBlur={() => setMenuSerialAbierto(false)}
                onKeyDown={(event) => {
                  if (event.key === "Escape") setMenuSerialAbierto(false);
                }}
                placeholder="Ej. 1234-ABCD-5678"
                required
                className="h-11"
                autoComplete="off"
              />
              {menuSerialAbierto && sugerenciasSerial.length > 0 && (
                <div className="absolute inset-x-0 top-full z-50 mt-1 max-h-60 overflow-y-auto rounded-md border bg-popover p-1 text-popover-foreground shadow-md">
                  {sugerenciasSerial.map((c) => (
                    <button
                      key={c.serialNumber}
                      type="button"
                      onMouseDown={(event) => {
                        event.preventDefault();
                        setSerialNumber(c.serialNumber);
                        setMenuSerialAbierto(false);
                      }}
                      className="flex w-full items-center justify-between gap-3 rounded-sm px-2 py-1.5 text-left text-sm outline-hidden hover:bg-accent hover:text-accent-foreground"
                    >
                      <span className="font-mono text-xs">
                        {c.serialNumber}
                      </span>
                      <span className="shrink-0 text-[0.65rem] text-muted-foreground">
                        {c.pcName}
                        {c.driveLetter ? ` · ${c.driveLetter}` : ""}
                      </span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
          <div className="flex flex-col gap-2">
            <label className="smallcaps text-muted-foreground">
              Alias / etiqueta
            </label>
            <Input
              value={label}
              onChange={(event) => setLabel(event.target.value)}
              placeholder="Departamento, usuario o ubicación"
              className="h-11"
            />
          </div>
          <div className="flex flex-col gap-2 sm:col-span-2 lg:col-span-1">
            <label className="smallcaps text-muted-foreground">
              Notas (opcional)
            </label>
            <Textarea
              value={notes}
              onChange={(event) => setNotes(event.target.value)}
              placeholder="Caducidad, propósito o detalles relevantes"
              rows={1}
              className="min-h-11 resize-none"
            />
          </div>
          <div className="flex justify-end sm:col-span-2 lg:col-span-1">
            <Button type="submit" disabled={creating || !serialNumber.trim()}>
              {creating && (
                <span className="mr-2 inline-flex">
                  <Spinner size={16} />
                </span>
              )}
              Agregar
            </Button>
          </div>
        </div>
      </form>

      {formError && (
        <p
          role="alert"
          className="mt-6 border-y border-destructive/40 py-3 text-sm text-destructive"
        >
          {formError}
        </p>
      )}

      {/* Barra del registro: selección a un lado y ordenación
          al otro, en la misma fila — en dos filas quedaba un
          hueco grande entre ambas. */}
      {entries.length > 0 && (
        <div className="mt-8 flex flex-wrap items-center justify-between gap-3">
          {onBulkDelete ? (
            <PageCheckbox
              pageIds={paginatedEntries.map((e) => e.id)}
              selected={bulk.selected}
              onChange={bulk.setMany}
            />
          ) : (
            <span />
          )}
          <OrdenarPor
            id="orden-lista-blanca"
            columnas={COLUMNAS_ORDEN}
            sortConfig={sortConfig}
            onSort={requestSort}
          />
        </div>
      )}

      {/* ── Asientos del registro ── */}
      <div className="mt-6 border-t border-border">
        {/* Móvil: asientos en filas */}
        <div className="divide-y divide-border md:hidden">
          {loading ? (
            <p className="py-6 text-center text-sm text-muted-foreground">
              Cargando whitelist...
            </p>
          ) : entries.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">
              No hay dispositivos registrados aún. Agrega el primero usando el
              formulario.
            </p>
          ) : (
            paginatedEntries.map((entry) => {
              const isDeleting = deletingId === entry.id;
              return (
                <article key={entry.id} className="py-5">
                  <div className="flex items-baseline justify-between gap-3">
                    <span className="flex items-center gap-2.5">
                      {onBulkDelete && (
                        <RowCheckbox
                          checked={bulk.selected.has(entry.id)}
                          onChange={() => bulk.toggle(entry.id)}
                          label={`Seleccionar ${entry.serialNumber}`}
                        />
                      )}
                      <p className="text-sm text-foreground">
                        <SerialCopiable serial={entry.serialNumber} />
                      </p>
                    </span>
                    <p className="text-xs text-muted-foreground tabular-nums">
                      {formatDateTime(entry.createdAt)}
                    </p>
                  </div>
                  <p className="font-display mt-2 text-base font-bold text-foreground">
                    {entry.label || "Sin alias"}
                  </p>
                  <p className="mt-1 text-sm text-muted-foreground">
                    {entry.notes || "Sin notas adicionales"}
                  </p>
                  <div className="mt-3 flex items-center justify-between gap-3 text-xs text-muted-foreground">
                    <span>
                      Autor: {entry.createdBy?.username || "Sistema"}
                    </span>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => handleDelete(entry.id)}
                      disabled={isDeleting}
                      className="text-destructive hover:text-destructive"
                    >
                      {isDeleting && (
                        <span className="mr-2 inline-flex">
                          <Spinner size={14} />
                        </span>
                      )}
                      Eliminar
                    </Button>
                  </div>
                </article>
              );
            })
          )}
        </div>

        {/* Escritorio: tabla libro mayor */}
        <div className="hidden overflow-x-auto md:block">
          <Table className="w-full min-w-[800px]">
            <TableHeader>
              <TableRow>
                <TableHead className="text-muted-foreground">
                  Serial
                </TableHead>
                <TableHead className="text-muted-foreground">
                  Alias
                </TableHead>
                <TableHead className="text-muted-foreground">
                  Notas
                </TableHead>
                <TableHead className="text-muted-foreground">
                  Creado
                </TableHead>
                <TableHead className="text-muted-foreground">
                  Autor
                </TableHead>
                <TableHead className="text-muted-foreground text-right">
                  Acciones
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading ? (
                <TableRow>
                  <TableCell
                    colSpan={6}
                    className="py-6 text-center text-muted-foreground"
                  >
                    Cargando whitelist...
                  </TableCell>
                </TableRow>
              ) : entries.length === 0 ? (
                <TableRow>
                  <TableCell
                    colSpan={6}
                    className="py-6 text-center text-muted-foreground"
                  >
                    No hay dispositivos registrados. Agrega uno usando el
                    formulario.
                  </TableCell>
                </TableRow>
              ) : (
                paginatedEntries.map((entry) => (
                  <TableRow key={entry.id}>
                    <TableCell>
                      <span className="flex items-center gap-2.5">
                        {onBulkDelete && (
                          <RowCheckbox
                            checked={bulk.selected.has(entry.id)}
                            onChange={() => bulk.toggle(entry.id)}
                            label={`Seleccionar ${entry.serialNumber}`}
                          />
                        )}
                        <span className="text-sm">
                          <SerialCopiable serial={entry.serialNumber} />
                        </span>
                      </span>
                    </TableCell>
                    <TableCell>
                      {entry.label ? (
                        <span className="font-display text-[15px] font-bold text-foreground">
                          {entry.label}
                        </span>
                      ) : (
                        <span className="text-muted-foreground/60">—</span>
                      )}
                    </TableCell>
                    <TableCell className="max-w-[280px] text-sm text-muted-foreground">
                      {entry.notes || (
                        <span className="text-muted-foreground/60">
                          Sin notas
                        </span>
                      )}
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground tabular-nums">
                      {formatDateTime(entry.createdAt)}
                    </TableCell>
                    <TableCell className="text-xs font-medium text-muted-foreground">
                      {entry.createdBy?.username || "Sistema"}
                    </TableCell>
                    <TableCell className="text-right">
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => handleDelete(entry.id)}
                        disabled={deletingId === entry.id}
                        className="text-destructive hover:text-destructive"
                      >
                        {deletingId === entry.id && (
                          <span className="mr-2 inline-flex">
                            <Spinner size={16} />
                          </span>
                        )}
                        Eliminar
                      </Button>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>

        {onBulkDelete && (
          <BulkBar
            count={bulk.count}
            unidad="dispositivo"
            busy={bulkBusy}
            onConfirm={() => void handleBulkConfirm()}
            onCancel={bulk.clear}
          />
        )}

        {entries.length > 0 && !loading && (
            <DashboardPagination
              page={page}
              pageSize={pageSize}
              totalItems={entries.length}
              onPageChange={setPage}
              onPageSizeChange={setPageSize}
              label="seriales"
            />

        )}
      </div>
    </motion.section>
  );
}
