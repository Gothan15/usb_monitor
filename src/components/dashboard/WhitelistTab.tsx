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
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { ScrollArea, ScrollBar } from "@/components/ui/scroll-area";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Textarea } from "@/components/ui/textarea";
import { WhitelistEntry, formatDateTime } from "./types";
import {
  CheckCircle2,
  NotebookPen,
  ShieldCheck,
  Trash2,
  Clock3,
  Sparkles,
  UserCheck,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { DashboardPagination } from "./DashboardPagination";
import { useTableSort } from "@/hooks/useTableSort";
import { SortableTableHead } from "./SortableTableHead";
import { Spinner } from "@/components/ui/spinner";

interface CreatePayload {
  serialNumber: string;
  label?: string;
  notes?: string;
}

interface Props {
  entries: WhitelistEntry[];
  loading: boolean;
  onCreate: (payload: CreatePayload) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
}

export function WhitelistTab({ entries, loading, onCreate, onDelete }: Props) {
  const [serialNumber, setSerialNumber] = useState("");
  const [label, setLabel] = useState("");
  const [notes, setNotes] = useState("");
  const [formError, setFormError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);

  const { sortedData, sortConfig, requestSort } =
    useTableSort<WhitelistEntry>(entries);

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
        icon: <ShieldCheck className="size-4" />,
        value: numberFormatter.format(totalEntries),
        accent:
          "from-emerald-400/30 via-emerald-300/20 to-transparent dark:from-emerald-500/20 dark:via-emerald-500/10",
      },
      {
        label: "Último alta",
        description: latestCreatedAt
          ? formatDateTime(latestCreatedAt)
          : "Sin registros",
        icon: <Clock3 className="size-4" />,
        value: latestCreatedAt ? "Activo" : "Pendiente",
        accent:
          "from-cyan-400/30 via-cyan-300/20 to-transparent dark:from-cyan-500/15 dark:via-cyan-500/10",
      },
      {
        label: "Último autor",
        description: latestCreatedBy ?? "Sistema",
        icon: <UserCheck className="size-4" />,
        value: latestCreatedBy ? "Manual" : "Automático",
        accent:
          "from-indigo-400/25 via-indigo-300/15 to-transparent dark:from-indigo-500/15",
      },
      {
        label: "Estado",
        description: creating
          ? "Guardando..."
          : deletingId
          ? "Eliminando..."
          : "Sin acciones pendientes",
        icon: <Sparkles className="size-4" />,
        value: creating || deletingId ? "En curso" : "Listo",
        accent:
          "from-amber-400/30 via-amber-300/20 to-transparent dark:from-amber-500/15",
      },
    ],
    [
      creating,
      deletingId,
      latestCreatedAt,
      latestCreatedBy,
      numberFormatter,
      totalEntries,
    ]
  );

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
    [pageCount]
  );

  const handlePageSizeChange = useCallback((nextSize: number) => {
    setPageSize(nextSize);
    setPage(1);
  }, []);

  const paginatedEntries = useMemo(() => {
    if (sortedData.length === 0) return [];
    const start = (page - 1) * pageSize;
    return sortedData.slice(start, start + pageSize);
  }, [sortedData, page, pageSize]);

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
    >
      <Card className="relative w-full overflow-hidden rounded-xl border border-border/60 bg-card/80 shadow-xl backdrop-blur-xl">
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top_left,_oklch(0.82_0.01_250/0.14),transparent_55%),radial-gradient(circle_at_bottom_right,_oklch(0.78_0.015_250/0.10),transparent_55%)] dark:bg-[radial-gradient(circle_at_top_left,_oklch(0.75_0.01_250/0.12),transparent_45%),radial-gradient(circle_at_bottom_right,_oklch(0.70_0.015_250/0.12),transparent_55%)]" />
        <CardHeader className="relative z-10 flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex items-center gap-4">
            <span className="inline-flex size-12 items-center justify-center rounded-xl border border-border/40 bg-muted/30 text-primary shadow-sm">
              <ShieldCheck className="size-5" />
            </span>
            <div>
              <CardTitle className="text-2xl font-semibold text-foreground">
                Whitelist de dispositivos USB
              </CardTitle>
              <CardDescription className="text-sm text-muted-foreground">
                Autoriza memorias seguras, mantén control y elimina desbloqueos
                manuales repetitivos.
              </CardDescription>
            </div>
          </div>
          <div className="flex flex-col items-start gap-2 text-xs font-medium text-muted-foreground sm:flex-row sm:items-center">
            <Badge
              variant="secondary"
              className="rounded-full border border-border/40 bg-muted/30 px-3 py-1 text-xs font-semibold uppercase tracking-[0.22em] text-muted-foreground shadow-sm backdrop-blur-sm"
            >
              {totalEntries} permitido{totalEntries === 1 ? "" : "s"}
            </Badge>
            {latestCreatedAt && (
              <span className="inline-flex items-center gap-2 rounded-full border border-border/40 bg-muted/30 px-3 py-1 text-muted-foreground shadow-sm backdrop-blur-sm">
                <CheckCircle2 className="size-3.5" />
                Último alta: {formatDateTime(latestCreatedAt)}
              </span>
            )}
          </div>
        </CardHeader>
        <CardContent className="relative z-10 space-y-8">
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            {quickStats.map((stat) => (
              <motion.div
                key={stat.label}
                whileHover={{ y: -4 }}
                transition={{ duration: 0.25 }}
                className="relative overflow-hidden rounded-xl border border-border/40 bg-card/80 p-4 shadow-lg backdrop-blur-xl"
              >
                <div
                  className={cn(
                    "pointer-events-none absolute inset-0 rounded-2xl bg-gradient-to-br opacity-70",
                    stat.accent
                  )}
                />
                <div className="relative flex items-start justify-between gap-3">
                  <div>
                    <p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-muted-foreground">
                      {stat.label}
                    </p>
                    <p className="mt-3 text-2xl font-semibold text-foreground">
                      {stat.value}
                    </p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {stat.description}
                    </p>
                  </div>
                  <span className="inline-flex size-9 items-center justify-center rounded-lg border border-border/40 bg-muted/30 text-muted-foreground shadow-sm">
                    {stat.icon}
                  </span>
                </div>
              </motion.div>
            ))}
          </div>

          <form
            onSubmit={handleSubmit}
            className="grid gap-4 rounded-xl border border-border/40 bg-card/80 p-5 shadow-xl backdrop-blur-xl sm:grid-cols-2 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)_minmax(0,1fr)_auto]"
          >
            <div className="flex flex-col gap-2">
              <label className="text-xs font-semibold uppercase tracking-[0.22em] text-muted-foreground">
                Serial del dispositivo
              </label>
              <Input
                value={serialNumber}
                onChange={(event) => setSerialNumber(event.target.value)}
                placeholder="Ej. 1234-ABCD-5678"
                required
                className="h-11 rounded-xl border border-border/60 bg-card/90 text-foreground placeholder:text-muted-foreground/60 shadow-sm focus-visible:ring-2 focus-visible:ring-primary/40"
              />
            </div>
            <div className="flex flex-col gap-2">
              <label className="text-xs font-semibold uppercase tracking-[0.22em] text-muted-foreground">
                Alias / etiqueta
              </label>
              <Input
                value={label}
                onChange={(event) => setLabel(event.target.value)}
                placeholder="Departamento, usuario o ubicación"
                className="h-11 rounded-xl border border-border/60 bg-card/90 text-foreground placeholder:text-muted-foreground/60 shadow-sm focus-visible:ring-2 focus-visible:ring-primary/40"
              />
            </div>
            <div className="flex flex-col gap-2 sm:col-span-2 lg:col-span-1">
              <label className="text-xs font-semibold uppercase tracking-[0.22em] text-muted-foreground">
                Notas (opcional)
              </label>
              <Textarea
                value={notes}
                onChange={(event) => setNotes(event.target.value)}
                placeholder="Caducidad, propósito o detalles relevantes"
                rows={3}
                className="min-h-[45px] resize-none rounded-xl border border-border/60 bg-card/90 text-foreground placeholder:text-muted-foreground/60 shadow-sm focus-visible:ring-2 focus-visible:ring-primary/40"
              />
            </div>
            <div className="flex items-end justify-end sm:col-span-2 lg:col-span-1">
              <Button
                type="submit"
                disabled={creating || !serialNumber.trim()}
                className="w-full rounded-2xl border border-cyan-200/60 bg-cyan-500/10 px-6 py-3 text-cyan-700 shadow-sm transition-all hover:-translate-y-0.5 hover:border-cyan-300 hover:bg-cyan-500/20 sm:w-auto dark:border-cyan-400/40 dark:bg-cyan-500/15 dark:text-cyan-100"
              >
                {creating ? (
                  <div className="mr-2">
                    <Spinner size={16} />
                  </div>
                ) : (
                  <NotebookPen className="mr-2 size-4" />
                )}
                Agregar
              </Button>
            </div>
          </form>

          {formError && (
            <Alert className="rounded-2xl border-rose-200/60 bg-rose-50/90 text-rose-700 shadow-sm dark:border-rose-300/40 dark:bg-rose-500/10 dark:text-rose-100">
              <AlertDescription>{formError}</AlertDescription>
            </Alert>
          )}

          <div className="flex flex-col gap-5">
            <div className="space-y-3 md:hidden">
              {loading ? (
                <div className="rounded-xl border border-border/40 bg-card/80 p-6 text-center text-muted-foreground shadow-sm">
                  Cargando whitelist...
                </div>
              ) : entries.length === 0 ? (
                <div className="rounded-xl border border-border/40 bg-card/80 p-6 text-center text-muted-foreground shadow-sm">
                  No hay dispositivos registrados aún. Agrega el primero usando
                  el formulario.
                </div>
              ) : (
                paginatedEntries.map((entry) => {
                  const isDeleting = deletingId === entry.id;
                  return (
                    <div
                      key={entry.id}
                      className="rounded-xl border border-border/40 bg-card/80 p-5 shadow-lg transition-shadow hover:shadow-xl backdrop-blur-sm"
                    >
                      <div className="flex items-center justify-between gap-3">
                        <div>
                          <p className="font-mono text-sm text-cyan-700 dark:text-cyan-200">
                            {entry.serialNumber}
                          </p>
                          <p className="text-xs uppercase tracking-[0.2em] text-muted-foreground/60">
                            {formatDateTime(entry.createdAt)}
                          </p>
                        </div>
                        <Badge
                          variant="secondary"
                          className="rounded-full border border-border/40 bg-muted/30 px-3 py-1 text-xs font-semibold uppercase tracking-[0.2em] text-muted-foreground shadow-sm"
                        >
                          {entry.label || "Sin alias"}
                        </Badge>
                      </div>
                      <p className="mt-3 text-sm text-muted-foreground">
                        {entry.notes || "Sin notas adicionales"}
                      </p>
                      <div className="mt-4 flex items-center justify-between gap-3 text-xs text-muted-foreground">
                        <span>
                          Autor: {entry.createdBy?.username || "Sistema"}
                        </span>
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => handleDelete(entry.id)}
                          disabled={isDeleting}
                          className={cn(
                            "rounded-full border border-rose-200/60 bg-rose-500/10 px-3 py-1 text-rose-600 shadow-sm transition-colors hover:border-rose-300 hover:bg-rose-500/20 disabled:opacity-70 dark:border-rose-400/30 dark:bg-rose-500/15 dark:text-rose-100",
                            isDeleting && "opacity-70"
                          )}
                        >
                          {isDeleting ? (
                            <div className="mr-2">
                              <Spinner size={14} />
                            </div>
                          ) : (
                            <Trash2 className="mr-2 size-3.5" />
                          )}
                          Eliminar
                        </Button>
                      </div>
                    </div>
                  );
                })
              )}
            </div>

            <ScrollArea className="hidden max-h-[min(65vh,500px)] pr-3 md:block">
              <Table className="w-full min-w-[800px]">
                <TableHeader className="sticky top-0 z-10 bg-card/95 backdrop-blur-xl">
                  <TableRow className="border-border/40">
                    <SortableTableHead
                      column="serialNumber"
                      currentSortKey={sortConfig.key}
                      currentSortDirection={sortConfig.direction}
                      onSort={requestSort}
                      className="text-muted-foreground"
                    >
                      Serial
                    </SortableTableHead>
                    <SortableTableHead
                      column="label"
                      currentSortKey={sortConfig.key}
                      currentSortDirection={sortConfig.direction}
                      onSort={requestSort}
                      className="text-muted-foreground"
                    >
                      Alias
                    </SortableTableHead>
                    <SortableTableHead
                      column="notes"
                      currentSortKey={sortConfig.key}
                      currentSortDirection={sortConfig.direction}
                      onSort={requestSort}
                      className="text-muted-foreground"
                    >
                      Notas
                    </SortableTableHead>
                    <SortableTableHead
                      column="createdAt"
                      currentSortKey={sortConfig.key}
                      currentSortDirection={sortConfig.direction}
                      onSort={requestSort}
                      className="text-muted-foreground"
                    >
                      Creado
                    </SortableTableHead>
                    <SortableTableHead
                      column="createdBy"
                      currentSortKey={sortConfig.key}
                      currentSortDirection={sortConfig.direction}
                      onSort={requestSort}
                      className="text-muted-foreground"
                    >
                      Autor
                    </SortableTableHead>
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
                      <TableRow
                        key={entry.id}
                        className="group transition-colors duration-150"
                      >
                        <TableCell className="font-mono text-sm text-cyan-700 dark:text-cyan-200">
                          {entry.serialNumber}
                        </TableCell>
                        <TableCell className="text-muted-foreground">
                          {entry.label ? (
                            <Badge
                              variant="secondary"
                              className="rounded-full border border-border/40 bg-muted/30 px-3 py-1 text-xs font-semibold uppercase tracking-[0.2em] text-muted-foreground shadow-sm"
                            >
                              {entry.label}
                            </Badge>
                          ) : (
                            <span className="text-xs uppercase tracking-[0.18em] text-muted-foreground/50">
                              —
                            </span>
                          )}
                        </TableCell>
                        <TableCell className="max-w-[280px] text-sm text-muted-foreground">
                          {entry.notes || (
                            <span className="text-xs uppercase tracking-[0.18em] text-muted-foreground/50">
                              Sin notas
                            </span>
                          )}
                        </TableCell>
                        <TableCell className="text-xs text-muted-foreground">
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
                            className={cn(
                              "rounded-full border border-rose-200/60 bg-rose-500/10 px-4 py-2 text-rose-600 shadow-sm transition-all hover:-translate-y-0.5 hover:border-rose-300 hover:bg-rose-500/20 disabled:opacity-70 dark:border-rose-400/30 dark:bg-rose-500/15 dark:text-rose-100",
                              deletingId === entry.id && "opacity-70"
                            )}
                          >
                            {deletingId === entry.id ? (
                              <div className="mr-2">
                                <Spinner size={16} />
                              </div>
                            ) : (
                              <Trash2 className="mr-2 size-4" />
                            )}
                            Eliminar
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
              <ScrollBar orientation="horizontal" />
            </ScrollArea>

            {entries.length > 0 && !loading && (
              <div className="mt-4 w-full">
                <DashboardPagination
                  page={page}
                  pageSize={pageSize}
                  totalItems={entries.length}
                  onPageChange={handlePageChange}
                  onPageSizeChange={handlePageSizeChange}
                  label="seriales"
                />
              </div>
            )}
          </div>
        </CardContent>
      </Card>
    </motion.section>
  );
}
