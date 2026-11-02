"use client";

import { memo, useDeferredValue, useEffect, useMemo, useState } from "react";
import { motion } from "framer-motion";
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
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { getCsrfTokenFromDocument } from "@/lib/utils";
import { cn } from "@/lib/utils";
import { DashboardPagination } from "./DashboardPagination";
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
  ArrowDown,
  ArrowUp,
  Pencil,
  Plus,
  Search,
  Trash2,
  UserRound,
} from "lucide-react";
import { useTableSort } from "@/hooks/useTableSort";
import { Spinner } from "@/components/ui/spinner";

interface AdminUser {
  id: string;
  username: string;
  role: string;
  computerId: string | null;
  createdAt: string;
  updatedAt: string;
  computer?: {
    id: string;
    name: string;
    ipAddress: string | null;
  } | null;
}

interface UsersTabProps {
  onSummaryChange?: (summary: { total: number }) => void;
  computers?: Computer[];
}

interface UserFormState {
  username: string;
  password: string;
  computerId: string;
}

const PAGE_SIZE_OPTIONS = [10, 20, 50, 100];
const NO_COMPUTER_VALUE = "none";

const COLUMNAS_ORDEN: { key: keyof AdminUser; label: string }[] = [
  { key: "username", label: "Usuario" },
  { key: "role", label: "Rol" },
  { key: "computer", label: "Equipo" },
  { key: "createdAt", label: "Creado" },
];

function createEmptyForm(): UserFormState {
  return {
    username: "",
    password: "",
    computerId: "",
  };
}

function generateRandomPassword(length = 16) {
  const charset =
    "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@$%";
  const randomValues = crypto.getRandomValues(new Uint32Array(length));
  let result = "";
  for (let i = 0; i < length; i += 1) {
    result += charset[randomValues[i] % charset.length];
  }
  return result;
}

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
  const [createForm, setCreateForm] = useState<UserFormState>(() =>
    createEmptyForm(),
  );
  const [creating, setCreating] = useState(false);

  const [editingUser, setEditingUser] = useState<AdminUser | null>(null);
  const [editForm, setEditForm] = useState<UserFormState>(() =>
    createEmptyForm(),
  );
  const [updating, setUpdating] = useState(false);

  const [deletingUser, setDeletingUser] = useState<AdminUser | null>(null);
  const [deleting, setDeleting] = useState(false);

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
        const params = new URLSearchParams({
          page: String(page),
          pageSize: String(pageSize),
        });
        if (deferredSearch.trim()) {
          params.set("q", deferredSearch.trim());
        }
        const response = await fetch(`/api/users?${params.toString()}`, {
          credentials: "include",
          cache: "no-store",
          signal: controller.signal,
        });
        const data = await response.json().catch(() => null);
        if (!response.ok || !data?.ok) {
          throw new Error(data?.error || `Error HTTP ${response.status}`);
        }
        setUsers(data.items ?? []);
        const nextTotal = data.total ?? data.items?.length ?? 0;
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
      setBulkBusy(true);
      const response = await fetch("/api/users", {
        method: "DELETE",
        headers: {
          "Content-Type": "application/json",
          "x-csrf-token": csrfToken,
        },
        credentials: "include",
        body: JSON.stringify({ ids: [...bulk.selected] }),
      });
      const data = await response.json().catch(() => null);
      if (!response.ok || !data?.ok) {
        throw new Error(data?.error || `Error HTTP ${response.status}`);
      }
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

  const handleGeneratePassword = (updater: (value: string) => void) => {
    updater(generateRandomPassword());
  };

  const handleCreateUser = async () => {
    const trimmedUsername = createForm.username.trim();

    if (!trimmedUsername) {
      toast({
        title: "Usuario requerido",
        description: "Ingresa el nombre de usuario.",
        variant: "destructive",
      });
      return;
    }
    if (!createForm.password.trim()) {
      toast({
        title: "Contraseña requerida",
        description: "Ingresa o genera una contraseña para el usuario.",
        variant: "destructive",
      });
      return;
    }

    if (createForm.computerId) {
      const selectedComputer = sortedComputers.find(
        (computer) => computer.id === createForm.computerId,
      );

      if (!selectedComputer) {
        toast({
          title: "Equipo no disponible",
          description:
            "No se encontró el equipo seleccionado. Refresca la página e intenta nuevamente.",
          variant: "destructive",
        });
        return;
      }
    }

    setCreating(true);
    try {
      const csrfToken = getCsrfTokenFromDocument();
      if (!csrfToken) {
        throw new Error(
          "Sesión sin token de seguridad. Inicia sesión nuevamente.",
        );
      }
      const headers: Record<string, string> = {
        "Content-Type": "application/json",
        "x-csrf-token": csrfToken,
      };
      const selectedComputer = sortedComputers.find(
        (computer) => computer.id === createForm.computerId,
      );

      const payload: Record<string, unknown> = {
        username: trimmedUsername,
        password: createForm.password,
      };

      if (selectedComputer) {
        payload.computerId = selectedComputer.id;
      }

      const response = await fetch("/api/users", {
        method: "POST",
        headers,
        credentials: "include",
        body: JSON.stringify(payload),
      });
      const data = await response.json().catch(() => null);
      if (!response.ok || !data?.ok) {
        throw new Error(data?.error || `Error HTTP ${response.status}`);
      }
      toast({
        title: "Usuario creado",
        description: `Se registró ${
          data.item?.username ?? createForm.username
        }.`,
      });
      setIsCreateOpen(false);
      setCreateForm(createEmptyForm());
      setPage(1);
      triggerReload();
    } catch (err: any) {
      toast({
        title: "No se pudo crear",
        description: err?.message || "Revisa los datos e intenta de nuevo.",
        variant: "destructive",
      });
    } finally {
      setCreating(false);
    }
  };

  const openEdit = (user: AdminUser) => {
    setEditingUser(user);
    setEditForm({
      username: user.username,
      password: "",
      computerId: user.computer?.id ?? "",
    });
  };

  const handleUpdateUser = async () => {
    if (!editingUser) return;

    const payload: Record<string, unknown> = {};
    const trimmedUsername = editForm.username.trim();
    if (trimmedUsername && trimmedUsername !== editingUser.username) {
      payload.username = trimmedUsername;
    }

    const trimmedPassword = editForm.password.trim();
    if (trimmedPassword) {
      payload.password = trimmedPassword;
    }

    const currentComputerId = editingUser.computer?.id ?? "";
    if (editForm.computerId !== currentComputerId) {
      if (!editForm.computerId) {
        payload.computerId = null;
      } else {
        const selectedComputer = sortedComputers.find(
          (computer) => computer.id === editForm.computerId,
        );

        if (!selectedComputer) {
          toast({
            title: "Equipo no disponible",
            description:
              "No se encontró el equipo seleccionado. Refresca la página e intenta nuevamente.",
            variant: "destructive",
          });
          return;
        }

        payload.computerId = selectedComputer.id;
      }
    }

    if (Object.keys(payload).length === 0) {
      toast({
        title: "Sin cambios",
        description: "Actualiza algún campo antes de guardar.",
      });
      return;
    }

    setUpdating(true);
    try {
      const csrfToken = getCsrfTokenFromDocument();
      if (!csrfToken) {
        throw new Error(
          "Sesión sin token de seguridad. Inicia sesión nuevamente.",
        );
      }
      const headers: Record<string, string> = {
        "Content-Type": "application/json",
        "x-csrf-token": csrfToken,
      };
      const response = await fetch(`/api/users/${editingUser.id}`, {
        method: "PATCH",
        headers,
        credentials: "include",
        body: JSON.stringify(payload),
      });
      const data = await response.json().catch(() => null);
      if (!response.ok || !data?.ok) {
        throw new Error(data?.error || `Error HTTP ${response.status}`);
      }
      toast({
        title: "Usuario actualizado",
        description: `Se guardaron los cambios de ${
          data.item?.username ?? editingUser.username
        }.`,
      });
      setEditingUser(null);
      setEditForm(createEmptyForm());
      triggerReload();
    } catch (err: any) {
      toast({
        title: "No se pudo actualizar",
        description: err?.message || "Intenta nuevamente.",
        variant: "destructive",
      });
    } finally {
      setUpdating(false);
    }
  };

  const handleDeleteUser = async () => {
    if (!deletingUser) return;
    setDeleting(true);
    try {
      const csrfToken = getCsrfTokenFromDocument();
      if (!csrfToken) {
        throw new Error(
          "Sesión sin token de seguridad. Inicia sesión nuevamente.",
        );
      }
      const headers: Record<string, string> = {
        "x-csrf-token": csrfToken,
      };
      const response = await fetch(`/api/users/${deletingUser.id}`, {
        method: "DELETE",
        headers,
        credentials: "include",
      });
      const data = await response.json().catch(() => null);
      if (!response.ok || !data?.ok) {
        throw new Error(data?.error || `Error HTTP ${response.status}`);
      }
      toast({
        title: "Usuario eliminado",
        description: `${deletingUser.username} fue removido del directorio.`,
      });
      setDeletingUser(null);
      triggerReload();
    } catch (err: any) {
      toast({
        title: "No se pudo eliminar",
        description: err?.message || "Verifica que no sea tu propio usuario.",
        variant: "destructive",
      });
    } finally {
      setDeleting(false);
    }
  };

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
            <Search className="pointer-events-none absolute left-0 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={searchInput}
              onChange={(event) => setSearchInput(event.target.value)}
              placeholder="Buscar por usuario, equipo o IP"
              className="w-[240px] rounded-none border-0 border-b border-border bg-transparent pl-6 shadow-none focus-visible:border-[var(--acero)] focus-visible:ring-0"
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
                          <span className="mt-0.5 block font-mono text-[11px] text-muted-foreground">
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
                      onClick={() => openEdit(user)}
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

      <Dialog open={isCreateOpen} onOpenChange={setIsCreateOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Crear nuevo usuario</DialogTitle>
            <DialogDescription>
              Define las credenciales iniciales y, si aplica, el equipo
              asociado.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Label htmlFor="create-username">Usuario</Label>
              <Input
                id="create-username"
                autoFocus
                value={createForm.username}
                onChange={(event) =>
                  setCreateForm((prev) => ({
                    ...prev,
                    username: event.target.value,
                  }))
                }
                placeholder="ej. auditor.seguridad"
              />
            </div>
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label htmlFor="create-password">Contraseña</Label>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="text-xs"
                  onClick={() =>
                    handleGeneratePassword((value) =>
                      setCreateForm((prev) => ({ ...prev, password: value })),
                    )
                  }
                >
                  Generar segura
                </Button>
              </div>
              <Input
                id="create-password"
                value={createForm.password}
                onChange={(event) =>
                  setCreateForm((prev) => ({
                    ...prev,
                    password: event.target.value,
                  }))
                }
                placeholder="********"
              />
              <p className="text-xs text-muted-foreground">
                La contraseña es obligatoria y se puede rotar más adelante.
              </p>
            </div>
            <div className="space-y-2">
              <Label>Equipo asignado (opcional)</Label>
              <Select
                value={createForm.computerId || NO_COMPUTER_VALUE}
                onValueChange={(value) =>
                  setCreateForm((prev) => ({
                    ...prev,
                    computerId: value === NO_COMPUTER_VALUE ? "" : value,
                  }))
                }
              >
                <SelectTrigger>
                  <SelectValue
                    placeholder={
                      sortedComputers.length
                        ? "Selecciona un equipo"
                        : "No hay equipos disponibles"
                    }
                  />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NO_COMPUTER_VALUE}>
                    Sin equipo asignado
                  </SelectItem>
                  {sortedComputers.map((computer) => (
                    <SelectItem key={computer.id} value={computer.id}>
                      {computer.name} · {computer.ipAddress}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                Selecciona una computadora del inventario para vincularla al
                usuario.
              </p>
            </div>
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="secondary"
              onClick={() => setIsCreateOpen(false)}
              disabled={creating}
            >
              Cancelar
            </Button>
            <Button
              type="button"
              onClick={handleCreateUser}
              disabled={creating}
            >
              {creating ? "Creando..." : "Crear usuario"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={Boolean(editingUser)}
        onOpenChange={(open) => {
          if (!open) {
            setEditingUser(null);
            setEditForm(createEmptyForm());
          }
        }}
      >
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Editar usuario</DialogTitle>
            <DialogDescription>
              Actualiza el nombre, la contraseña o el equipo asignado. Deja la
              contraseña vacía para mantenerla.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Label htmlFor="edit-username">Usuario</Label>
              <Input
                id="edit-username"
                value={editForm.username}
                onChange={(event) =>
                  setEditForm((prev) => ({
                    ...prev,
                    username: event.target.value,
                  }))
                }
              />
            </div>
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label htmlFor="edit-password">Nueva contraseña</Label>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="text-xs"
                  onClick={() =>
                    handleGeneratePassword((value) =>
                      setEditForm((prev) => ({ ...prev, password: value })),
                    )
                  }
                >
                  Generar segura
                </Button>
              </div>
              <Input
                id="edit-password"
                value={editForm.password}
                onChange={(event) =>
                  setEditForm((prev) => ({
                    ...prev,
                    password: event.target.value,
                  }))
                }
                placeholder="Deja en blanco para conservar"
              />
            </div>
            <div className="space-y-2">
              <Label>Equipo asignado</Label>
              <Select
                value={editForm.computerId || NO_COMPUTER_VALUE}
                onValueChange={(value) =>
                  setEditForm((prev) => ({
                    ...prev,
                    computerId: value === NO_COMPUTER_VALUE ? "" : value,
                  }))
                }
              >
                <SelectTrigger>
                  <SelectValue
                    placeholder={
                      sortedComputers.length
                        ? "Selecciona un equipo"
                        : "No hay equipos disponibles"
                    }
                  />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NO_COMPUTER_VALUE}>
                    Sin equipo asignado
                  </SelectItem>
                  {sortedComputers.map((computer) => (
                    <SelectItem key={computer.id} value={computer.id}>
                      {computer.name} · {computer.ipAddress}
                    </SelectItem>
                  ))}
                  {editingUser?.computer &&
                  !sortedComputers.some(
                    (computer) => computer.id === editingUser.computer?.id,
                  ) ? (
                    <SelectItem value={editingUser.computer.id}>
                      {editingUser.computer.name}
                      {editingUser.computer.ipAddress
                        ? ` · ${editingUser.computer.ipAddress}`
                        : ""}
                    </SelectItem>
                  ) : null}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                Deja "Sin equipo asignado" para desvincular el usuario.
              </p>
            </div>
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="secondary"
              onClick={() => {
                setEditingUser(null);
                setEditForm(createEmptyForm());
              }}
              disabled={updating}
            >
              Cancelar
            </Button>
            <Button
              type="button"
              onClick={handleUpdateUser}
              disabled={updating}
            >
              {updating ? "Guardando..." : "Guardar cambios"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog
        open={Boolean(deletingUser)}
        onOpenChange={(open) => {
          if (!open) setDeletingUser(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>¿Eliminar este usuario?</AlertDialogTitle>
            <AlertDialogDescription>
              Esta acción revoca el acceso inmediatamente y no se puede
              deshacer.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDeleteUser}
              disabled={deleting}
              className="bg-rose-600 hover:bg-rose-700"
            >
              {deleting ? "Eliminando..." : "Eliminar"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </motion.section>
  );
}

export const UsersTab = memo(UsersTabComponent);
