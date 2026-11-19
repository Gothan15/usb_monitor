"use client";

import { memo, useDeferredValue, useEffect, useMemo, useState } from "react";
import { motion } from "framer-motion";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import * as usuariosApi from "@/lib/api/usuarios";
import {
  CreateUserDialog,
  DeleteUserDialog,
  EditUserDialog,
  type AdminUser,
} from "./UserDialogs";
import { cn } from "@/lib/utils";
import { DashboardPagination } from "./DashboardPagination";
import { OrdenarPor } from "./OrdenarPor";
import {
  BulkBar,
  PageCheckbox,
  RowCheckbox,
  useBulkSelection,
} from "./BulkSelection";
import { usePagination } from "@/hooks/usePagination";
import { formatDateTime, type Computer } from "./types";
import {
  AlertCircle,
  Pencil,
  Plus,
  Trash2,
  UserRound,
} from "lucide-react";
import { useTableSort } from "@/hooks/useTableSort";
import { CampoBusqueda } from "@/components/shared/CampoBusqueda";
import { Spinner } from "@/components/ui/spinner";

interface UsersTabProps {
  onSummaryChange?: (summary: { total: number }) => void;
  computers?: Computer[];
}

const PAGE_SIZE_OPTIONS = [10, 20, 50, 100];

const COLUMNAS_ORDEN: { key: keyof AdminUser; label: string }[] = [
  { key: "username", label: "Usuario" },
  { key: "role", label: "Rol" },
  { key: "computer", label: "Equipo" },
  { key: "createdAt", label: "Creado" },
];

/** Dato de asiento: etiqueta en versalitas y valor debajo. */
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

function UsersTabComponent({ onSummaryChange, computers = [] }: UsersTabProps) {
  const { toast } = useToast();
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchInput, setSearchInput] = useState("");
  const deferredSearch = useDeferredValue(searchInput);
  const [reloadFlag, setReloadFlag] = useState(0);
  const [hasLoadedOnce, setHasLoadedOnce] = useState(false);

  const { page, pageSize, pageCount, setPage, setPageSize } = usePagination({
    totalItems: total,
    pageSizeOptions: PAGE_SIZE_OPTIONS,
  });

  const { sortedData, sortConfig, requestSort } =
    useTableSort<AdminUser>(users);

  const [isCreateOpen, setIsCreateOpen] = useState(false);

  const [editingUser, setEditingUser] = useState<AdminUser | null>(null);

  const [deletingUser, setDeletingUser] = useState<AdminUser | null>(null);

  const sortedComputers = useMemo(() => {
    return [...computers].sort((a, b) =>
      a.name.localeCompare(b.name, "es", { sensitivity: "base" }),
    );
  }, [computers]);

  useEffect(() => {
    const controller = new AbortController();
    const loadUsers = async () => {
      setLoading(true);
      setError(null);
      try {
        const data = await usuariosApi.listar({
          page,
          pageSize,
          q: deferredSearch.trim() || undefined,
          signal: controller.signal,
        });
        setUsers(data.items as AdminUser[]);
        const nextTotal = data.total;
        setTotal(nextTotal);
        if (!deferredSearch.trim()) {
          onSummaryChange?.({ total: nextTotal });
        }
        setHasLoadedOnce(true);
      } catch (err: any) {
        if (controller.signal.aborted) return;
        const message = err?.message || "No se pudieron cargar los usuarios";
        setError(message);
      } finally {
        if (!controller.signal.aborted) {
          setLoading(false);
        }
      }
    };

    void loadUsers();
    return () => controller.abort();
  }, [page, pageSize, deferredSearch, reloadFlag, onSummaryChange]);

  useEffect(() => {
    setPage(1);
  }, [deferredSearch, setPage]);

  const triggerReload = () => setReloadFlag((value) => value + 1);

  // ── Selección por lotes ──
  const bulk = useBulkSelection();
  const [bulkBusy, setBulkBusy] = useState(false);

  const handleBulkDeleteUsers = async () => {
    if (bulk.count === 0 || bulkBusy) return;
    try {
      setBulkBusy(true);
      const data = await usuariosApi.eliminarVarios([...bulk.selected]);
      toast({
        title: "Usuarios eliminados",
        description: `Se eliminaron ${data.deleted} usuario(s).${
          data.skippedSelf ? " Tu propio usuario se omitió." : ""
        }`,
      });
      bulk.clear();
      triggerReload();
    } catch (err: any) {
      toast({
        title: "No se pudieron eliminar",
        description: err?.message || "Inténtalo de nuevo.",
        variant: "destructive",
      });
    } finally {
      setBulkBusy(false);
    }
  };

  const isInitialLoading = loading && !hasLoadedOnce;
  const isSearching = loading && hasLoadedOnce;

  const cifras = [
    { label: "Usuarios totales", value: total.toLocaleString("es-ES") },
    {
      label: "Página actual",
      value: `${page.toLocaleString("es-ES")} / ${pageCount.toLocaleString("es-ES")}`,
    },
    {
      label: "Usuarios visibles",
      value: users.length.toLocaleString("es-ES"),
    },
    {
      label: "Con equipo asignado",
      value: users
        .filter((user) => user.computer)
        .length.toLocaleString("es-ES"),
    },
  ];

  const renderEmptyState = () => (
    <div className="flex flex-col items-center justify-center gap-3 border-t border-border px-6 py-12 text-center">
      <UserRound className="size-8 text-muted-foreground/50" />
      <div>
        <p className="font-display text-lg font-bold text-foreground">
          Todavía no hay usuarios
        </p>
        <p className="mt-1 text-sm text-muted-foreground">
          Crea el primer usuario para comenzar a administrar accesos.
        </p>
      </div>
      <Button onClick={() => setIsCreateOpen(true)} className="mt-2">
        <Plus className="mr-2 h-4 w-4" /> Nuevo usuario
      </Button>
    </div>
  );

  const renderLoadingState = () => (
    <div>
      {Array.from({ length: 6 }).map((_, index) => (
        <div key={index} className="border-t border-border py-5">
          <div className="h-5 w-44 animate-pulse bg-muted/40" />
          <div className="mt-2 h-3 w-24 animate-pulse bg-muted/40" />
        </div>
      ))}
    </div>
  );

  return (
    <motion.section
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35, ease: "easeOut" }}
      className="w-full"
      data-tour="users-main"
    >
      {/* ── Cabecera plana: título, buscador con subrayado y alta ── */}
      <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div className="flex flex-1 flex-col">
          <h2 className="font-display text-[1.7rem] font-bold leading-tight text-foreground">
            Cuentas del panel
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Administra cuentas, contraseñas y equipos asignados.
          </p>
        </div>
        <div className="flex flex-wrap items-end gap-4">
          <div className="relative">
            <CampoBusqueda
              value={searchInput}
              onChange={setSearchInput}
              placeholder="Buscar por usuario, equipo o IP"
              className="w-[240px]"
            />
            {deferredSearch.trim() && (
              <span className="absolute left-0 top-full mt-1.5 whitespace-nowrap text-xs text-muted-foreground">
                {total} resultado{total === 1 ? "" : "s"} para «
                {deferredSearch.trim()}»
              </span>
            )}
          </div>
          {/* Botón de recarga unificado en AppShell (eliminado aquí) */}
          <Button type="button" onClick={() => setIsCreateOpen(true)}>
            <Plus className="mr-2 h-4 w-4" /> Nuevo usuario
          </Button>
        </div>
      </div>

      {/* ── Tira de cifras ── */}
      <div className="mt-8 flex flex-wrap gap-x-14 gap-y-4 border-t border-border pt-5">
        {cifras.map((cifra) => (
          <div key={cifra.label} className="flex items-baseline gap-3">
            <span className="font-display text-[1.7rem] font-bold leading-none tabular-nums text-foreground">
              {cifra.value}
            </span>
            <span className="smallcaps text-muted-foreground">
              {cifra.label}
            </span>
          </div>
        ))}
      </div>

      {/* ── Libro de cuentas ── */}
      <div className="mt-8">
        {error ? (
          <div className="flex items-start gap-3 border-l-2 border-destructive bg-destructive/5 px-4 py-3 text-sm text-destructive">
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
            <span>{error}</span>
          </div>
        ) : null}

        {isInitialLoading ? (
          renderLoadingState()
        ) : users.length === 0 ? (
          renderEmptyState()
        ) : (
          <div className="relative">
            {/* Ordenación */}
            <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
              <PageCheckbox
                pageIds={sortedData.map((u) => u.id)}
                selected={bulk.selected}
                onChange={bulk.setMany}
              />
              <OrdenarPor
                id="orden-usuarios"
                columnas={COLUMNAS_ORDEN}
                sortConfig={sortConfig}
                onSort={requestSort}
              />
            </div>

            <motion.ul
              animate={{
                opacity: isSearching ? 0.45 : 1,
                scale: isSearching ? 0.995 : 1,
              }}
              transition={{ duration: 0.25, ease: "easeInOut" }}
              className="mt-4 divide-y divide-border border-t border-border"
            >
              {sortedData.map((user) => (
                <li
                  key={user.id}
                  className="flex flex-col gap-5 py-5 lg:flex-row lg:items-center lg:gap-8"
                >
                  <div className="pt-1.5 lg:shrink-0">
                    <RowCheckbox
                      checked={bulk.selected.has(user.id)}
                      onChange={() => bulk.toggle(user.id)}
                      label={`Seleccionar ${user.username}`}
                    />
                  </div>

                  {/* Nombre y rol */}
                  <div className="min-w-0 lg:w-56 lg:shrink-0">
                    <p className="font-display truncate text-lg font-bold leading-snug text-foreground">
                      {user.username}
                    </p>
                    <p className="smallcaps mt-1 text-muted-foreground">
                      {user.role}
                    </p>
                  </div>

                  {/* Equipo asignado */}
                  <div className="lg:w-60 lg:shrink-0">
                    <Dato etiqueta="Equipo">
                      {user.computer ? (
                        <>
                          <span className="block text-sm font-medium text-foreground">
                            {user.computer.name}
                          </span>
                          <span className="mt-0.5 block font-mono text-[0.6875rem] text-muted-foreground">
                            {user.computer.ipAddress ?? "Sin IP"}
                          </span>
                        </>
                      ) : (
                        <span className="text-sm text-muted-foreground/70">
                          No asignado
                        </span>
                      )}
                    </Dato>
                  </div>

                  {/* Fecha de creación */}
                  <Dato etiqueta="Creado">
                    <span className="text-sm tabular-nums text-foreground">
                      {formatDateTime(user.createdAt)}
                    </span>
                  </Dato>

                  {/* Acciones discretas */}
                  <div className="flex items-center gap-1 lg:ml-auto lg:shrink-0">
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8"
                      onClick={() => setEditingUser(user)}
                      aria-label={`Editar ${user.username}`}
                      title="Editar usuario"
                    >
                      <Pencil className="h-4 w-4" />
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8 text-destructive hover:text-destructive"
                      onClick={() => setDeletingUser(user)}
                      aria-label={`Eliminar ${user.username}`}
                      title="Eliminar usuario"
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </li>
              ))}
            </motion.ul>

            <BulkBar
              count={bulk.count}
              unidad="usuario"
              busy={bulkBusy}
              onConfirm={() => void handleBulkDeleteUsers()}
              onCancel={bulk.clear}
            />

            {/* Paginación */}
              <DashboardPagination
                page={page}
                pageSize={pageSize}
                totalItems={total}
                onPageChange={setPage}
                onPageSizeChange={setPageSize}
                pageSizeOptions={PAGE_SIZE_OPTIONS}
                label="usuarios"
              />


            {isSearching ? (
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                className="pointer-events-none absolute inset-0 flex items-start justify-center pt-16"
              >
                <span className="inline-flex items-center gap-2 border border-border bg-card px-3 py-1.5 text-xs text-muted-foreground">
                  <Spinner size={12} />
                  Buscando usuarios...
                </span>
              </motion.div>
            ) : null}
          </div>
        )}
      </div>

      <CreateUserDialog
        open={isCreateOpen}
        onOpenChange={setIsCreateOpen}
        computers={sortedComputers}
        onCreated={() => {
          setPage(1);
          triggerReload();
        }}
      />

      <EditUserDialog
        user={editingUser}
        onClose={() => setEditingUser(null)}
        computers={sortedComputers}
        onUpdated={triggerReload}
      />

      <DeleteUserDialog
        user={deletingUser}
        onClose={() => setDeletingUser(null)}
        onDeleted={triggerReload}
      />
    </motion.section>
  );
}

export const UsersTab = memo(UsersTabComponent);
