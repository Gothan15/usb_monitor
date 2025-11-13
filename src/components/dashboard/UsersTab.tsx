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
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
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
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Table,
  TableBody,
  TableCell,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { getCsrfTokenFromDocument } from "@/lib/utils";
import { DashboardPagination } from "./DashboardPagination";
import { formatDateTime, type Computer } from "./types";
import {
  AlertCircle,
  KeyRound,
  Loader2,
  Pencil,
  Plus,
  RefreshCw,
  Search,
  Trash2,
  UserRound,
} from "lucide-react";
import { useTableSort } from "@/hooks/useTableSort";
import { SortableTableHead } from "./SortableTableHead";

interface AdminUser {
  id: string;
  username: string;
  role: string;
  apiKey: string | null;
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

function UsersTabComponent({ onSummaryChange, computers = [] }: UsersTabProps) {
  const { toast } = useToast();
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchInput, setSearchInput] = useState("");
  const deferredSearch = useDeferredValue(searchInput);
  const [reloadFlag, setReloadFlag] = useState(0);
  const [hasLoadedOnce, setHasLoadedOnce] = useState(false);

  const { sortedData, sortConfig, requestSort } =
    useTableSort<AdminUser>(users);

  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [createForm, setCreateForm] = useState<UserFormState>(() =>
    createEmptyForm()
  );
  const [creating, setCreating] = useState(false);

  const [editingUser, setEditingUser] = useState<AdminUser | null>(null);
  const [editForm, setEditForm] = useState<UserFormState>(() =>
    createEmptyForm()
  );
  const [updating, setUpdating] = useState(false);

  const [deletingUser, setDeletingUser] = useState<AdminUser | null>(null);
  const [deleting, setDeleting] = useState(false);

  const sortedComputers = useMemo(() => {
    return [...computers].sort((a, b) =>
      a.name.localeCompare(b.name, "es", { sensitivity: "base" })
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
  }, [deferredSearch]);

  useEffect(() => {
    const maxPage = Math.max(
      1,
      Math.ceil(Math.max(total, 0) / Math.max(pageSize, 1))
    );
    if (page > maxPage) {
      setPage(maxPage);
    }
  }, [page, pageSize, total]);

  const pageCount = useMemo(() => {
    if (total === 0) return 1;
    return Math.max(1, Math.ceil(total / Math.max(pageSize, 1)));
  }, [total, pageSize]);

  const triggerReload = () => setReloadFlag((value) => value + 1);

  const isInitialLoading = loading && !hasLoadedOnce;
  const isSearching = loading && hasLoadedOnce;

  const handleCopyKey = async (apiKey: string | null) => {
    if (!apiKey) {
      toast({
        title: "Sin API key",
        description: "Genera o asigna una API key antes de copiarla.",
        variant: "destructive",
      });
      return;
    }
    try {
      await navigator.clipboard.writeText(apiKey);
      toast({
        title: "API key copiada",
        description: "Se copió al portapapeles.",
      });
    } catch (err) {
      toast({
        title: "No se pudo copiar",
        description: err instanceof Error ? err.message : "Intenta de nuevo",
        variant: "destructive",
      });
    }
  };

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
        (computer) => computer.id === createForm.computerId
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
          "Sesión sin token de seguridad. Inicia sesión nuevamente."
        );
      }
      const headers: Record<string, string> = {
        "Content-Type": "application/json",
        "x-csrf-token": csrfToken,
      };
      const selectedComputer = sortedComputers.find(
        (computer) => computer.id === createForm.computerId
      );

      const payload: Record<string, unknown> = {
        username: trimmedUsername,
        password: createForm.password,
      };

      if (selectedComputer) {
        payload.ipAddress = selectedComputer.ipAddress;
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

    const payload: Record<string, string> = {};
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
        payload.ipAddress = "";
      } else {
        const selectedComputer = sortedComputers.find(
          (computer) => computer.id === editForm.computerId
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

        payload.ipAddress = selectedComputer.ipAddress;
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
          "Sesión sin token de seguridad. Inicia sesión nuevamente."
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
          "Sesión sin token de seguridad. Inicia sesión nuevamente."
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

  const renderEmptyState = () => (
    <div className="flex flex-col items-center justify-center gap-3 rounded-3xl border border-dashed border-slate-300/70 bg-white/60 px-6 py-10 text-center text-sm text-slate-500 dark:border-slate-700/80 dark:bg-slate-900/40 dark:text-slate-300">
      <UserRound className="h-10 w-10 text-slate-400" />
      <div>
        <p className="font-semibold text-slate-700 dark:text-slate-200">
          Todavía no hay usuarios
        </p>
        <p className="mt-1 text-xs">
          Crea el primer usuario para comenzar a administrar accesos.
        </p>
      </div>
      <Button
        onClick={() => setIsCreateOpen(true)}
        className="mt-2 rounded-full"
      >
        <Plus className="mr-2 h-4 w-4" /> Nuevo usuario
      </Button>
    </div>
  );

  const renderLoadingState = () => (
    <div className="grid gap-2">
      {Array.from({ length: 6 }).map((_, index) => (
        <div
          key={index}
          className="h-12 animate-pulse rounded-2xl bg-slate-200/50 dark:bg-slate-800/40"
        />
      ))}
    </div>
  );

  return (
    <motion.section
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35, ease: "easeOut" }}
    >
      <Card className="overflow-hidden rounded-3xl border border-slate-200/70 bg-white/85 text-slate-900 shadow-xl supports-[backdrop-filter]:backdrop-blur-2xl dark:border-slate-800/80 dark:bg-slate-900/60 dark:text-white">
        <CardHeader className="space-y-6">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
            <div className="flex gap-3">
              <span className="flex h-12 w-12 items-center justify-center rounded-2xl border border-slate-200/60 bg-white text-slate-600 shadow-sm dark:border-slate-700/80 dark:bg-slate-900 dark:text-slate-200">
                <UserRound className="h-5 w-5" />
              </span>
              <div>
                <CardTitle className="text-2xl font-semibold tracking-tight">
                  Gestión de usuarios
                </CardTitle>
                <CardDescription className="text-sm text-slate-600 dark:text-slate-400">
                  Administra cuentas, contraseñas y equipos asignados.
                </CardDescription>
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <div className="relative">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                <Input
                  value={searchInput}
                  onChange={(event) => setSearchInput(event.target.value)}
                  placeholder="Buscar por usuario, equipo o IP"
                  className="w-[220px] rounded-full border-slate-200/70 pl-9 text-sm dark:border-slate-700"
                />
              </div>
              {/* Botón de recarga unificado en AppShell (eliminado aquí) */}
              <Button
                type="button"
                className="rounded-full"
                onClick={() => setIsCreateOpen(true)}
              >
                <Plus className="mr-2 h-4 w-4" /> Nuevo usuario
              </Button>
            </div>
          </div>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <div className="rounded-2xl border border-slate-200/70 bg-white/80 p-4 text-slate-700 shadow-sm dark:border-slate-700/80 dark:bg-slate-900/70 dark:text-slate-200">
              <p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-slate-500 dark:text-slate-400">
                Usuarios totales
              </p>
              <p className="mt-2 text-2xl font-semibold tracking-tight">
                {total.toLocaleString("es-ES")}
              </p>
            </div>
            <div className="rounded-2xl border border-slate-200/70 bg-white/80 p-4 text-slate-700 shadow-sm dark:border-slate-700/80 dark:bg-slate-900/70 dark:text-slate-200">
              <p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-slate-500 dark:text-slate-400">
                Página actual
              </p>
              <p className="mt-2 text-2xl font-semibold tracking-tight">
                {page.toLocaleString("es-ES")} /{" "}
                {pageCount.toLocaleString("es-ES")}
              </p>
            </div>
            <div className="rounded-2xl border border-slate-200/70 bg-white/80 p-4 text-slate-700 shadow-sm dark:border-slate-700/80 dark:bg-slate-900/70 dark:text-slate-200">
              <p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-slate-500 dark:text-slate-400">
                Usuarios visibles
              </p>
              <p className="mt-2 text-2xl font-semibold tracking-tight">
                {users.length.toLocaleString("es-ES")}
              </p>
            </div>
            <div className="rounded-2xl border border-slate-200/70 bg-white/80 p-4 text-slate-700 shadow-sm dark:border-slate-700/80 dark:bg-slate-900/70 dark:text-slate-200">
              <p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-slate-500 dark:text-slate-400">
                Con equipo asignado
              </p>
              <p className="mt-2 text-2xl font-semibold tracking-tight">
                {users
                  .filter((user) => user.computer)
                  .length.toLocaleString("es-ES")}
              </p>
            </div>
          </div>
        </CardHeader>

        <CardContent className="space-y-6">
          {error ? (
            <div className="flex items-start gap-3 rounded-2xl border border-rose-200/70 bg-rose-50 px-4 py-3 text-sm text-rose-700 shadow-sm dark:border-rose-500/30 dark:bg-rose-500/10 dark:text-rose-100">
              <AlertCircle className="mt-0.5 h-4 w-4" />
              <span>{error}</span>
            </div>
          ) : null}

          {isInitialLoading ? (
            renderLoadingState()
          ) : users.length === 0 ? (
            renderEmptyState()
          ) : (
            <div className="relative">
              <motion.div
                animate={{
                  opacity: isSearching ? 0.45 : 1,
                  scale: isSearching ? 0.995 : 1,
                }}
                transition={{ duration: 0.25, ease: "easeInOut" }}
                className="space-y-6"
              >
                <ScrollArea className="max-h-[min(60vh,480px)] pr-3">
                  <Table>
                    <TableHeader className="sticky top-0 z-10 bg-white/95 backdrop-blur-xl dark:bg-slate-900/80">
                      <TableRow className="border-white/60 dark:border-white/10">
                        <SortableTableHead
                          column="username"
                          currentSortKey={sortConfig.key}
                          currentSortDirection={sortConfig.direction}
                          onSort={requestSort}
                        >
                          Usuario
                        </SortableTableHead>
                        <SortableTableHead
                          column="role"
                          currentSortKey={sortConfig.key}
                          currentSortDirection={sortConfig.direction}
                          onSort={requestSort}
                        >
                          Rol
                        </SortableTableHead>
                        <SortableTableHead
                          column="computer"
                          currentSortKey={sortConfig.key}
                          currentSortDirection={sortConfig.direction}
                          onSort={requestSort}
                        >
                          Equipo
                        </SortableTableHead>
                        <SortableTableHead
                          column="apiKey"
                          currentSortKey={sortConfig.key}
                          currentSortDirection={sortConfig.direction}
                          onSort={requestSort}
                        >
                          API key
                        </SortableTableHead>
                        <SortableTableHead
                          column="createdAt"
                          currentSortKey={sortConfig.key}
                          currentSortDirection={sortConfig.direction}
                          onSort={requestSort}
                        >
                          Creado
                        </SortableTableHead>
                        <SortableTableHead
                          column="id"
                          currentSortKey={sortConfig.key}
                          currentSortDirection={sortConfig.direction}
                          onSort={requestSort}
                          className="w-[120px]"
                          align="right"
                        >
                          Acciones
                        </SortableTableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {sortedData.map((user) => (
                        <TableRow
                          key={user.id}
                          className="group border border-white/70 bg-white/75 transition-all duration-150 hover:-translate-y-0.5 hover:border-slate-300/60 hover:bg-slate-50/70 dark:border-white/10 dark:bg-white/5 dark:hover:border-slate-500/40 dark:hover:bg-slate-900/40"
                        >
                          <TableCell className="font-semibold text-slate-700 dark:text-slate-100">
                            {user.username}
                          </TableCell>
                          <TableCell className="text-xs uppercase tracking-[0.24em] text-slate-500 dark:text-slate-400">
                            {user.role}
                          </TableCell>
                          <TableCell className="text-sm text-slate-600 dark:text-slate-300">
                            {user.computer ? (
                              <div className="flex flex-col">
                                <span className="font-medium text-slate-700 dark:text-slate-100">
                                  {user.computer.name}
                                </span>
                                <span className="text-xs text-slate-500 dark:text-slate-400">
                                  {user.computer.ipAddress ?? "Sin IP"}
                                </span>
                              </div>
                            ) : (
                              <span className="text-xs text-slate-400 dark:text-slate-500">
                                No asignado
                              </span>
                            )}
                          </TableCell>
                          <TableCell>
                            <div className="flex items-center gap-2">
                              <Badge
                                variant="secondary"
                                className="max-w-[140px] truncate rounded-full bg-slate-100 px-3 py-1 text-xs text-slate-600 dark:bg-slate-800 dark:text-slate-300"
                              >
                                {user.apiKey
                                  ? `${user.apiKey.slice(0, 8)}…`
                                  : "No generada"}
                              </Badge>
                              <Button
                                type="button"
                                size="icon"
                                variant="ghost"
                                className="h-8 w-8 rounded-full"
                                onClick={() => handleCopyKey(user.apiKey)}
                              >
                                <KeyRound className="h-4 w-4" />
                              </Button>
                            </div>
                          </TableCell>
                          <TableCell className="text-sm text-slate-500 dark:text-slate-400">
                            {formatDateTime(user.createdAt)}
                          </TableCell>
                          <TableCell className="text-right">
                            <div className="flex justify-end gap-1">
                              <Button
                                type="button"
                                variant="ghost"
                                size="icon"
                                className="h-8 w-8 rounded-full"
                                onClick={() => openEdit(user)}
                              >
                                <Pencil className="h-4 w-4" />
                              </Button>
                              <Button
                                type="button"
                                variant="ghost"
                                size="icon"
                                className="h-8 w-8 rounded-full text-rose-600 hover:text-rose-700"
                                onClick={() => setDeletingUser(user)}
                              >
                                <Trash2 className="h-4 w-4" />
                              </Button>
                            </div>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </ScrollArea>
                <DashboardPagination
                  page={page}
                  pageSize={pageSize}
                  totalItems={total}
                  onPageChange={(nextPage) => setPage(nextPage)}
                  onPageSizeChange={(nextSize) => {
                    setPageSize(nextSize);
                    setPage(1);
                  }}
                  pageSizeOptions={PAGE_SIZE_OPTIONS}
                  label="usuarios"
                />
              </motion.div>
              {isSearching ? (
                <motion.div
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  className="pointer-events-none absolute inset-0 flex items-center justify-center"
                >
                  <div className="inline-flex items-center gap-2 rounded-full border border-slate-200/80 bg-white/90 px-3 py-1 text-xs font-medium text-slate-600 shadow-sm dark:border-white/10 dark:bg-slate-900/80 dark:text-slate-200">
                    <Loader2 className="h-3 w-3 animate-spin" />
                    Buscando usuarios...
                  </div>
                </motion.div>
              ) : null}
            </div>
          )}
        </CardContent>
      </Card>

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
                  className="rounded-full text-xs"
                  onClick={() =>
                    handleGeneratePassword((value) =>
                      setCreateForm((prev) => ({ ...prev, password: value }))
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
              <p className="text-xs text-slate-500">
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
                <SelectTrigger className="rounded-full">
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
              <p className="text-xs text-slate-500">
                Selecciona una computadora del inventario para vincularla al
                usuario.
              </p>
            </div>
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="secondary"
              className="rounded-full"
              onClick={() => setIsCreateOpen(false)}
              disabled={creating}
            >
              Cancelar
            </Button>
            <Button
              type="button"
              className="rounded-full"
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
                  className="rounded-full text-xs"
                  onClick={() =>
                    handleGeneratePassword((value) =>
                      setEditForm((prev) => ({ ...prev, password: value }))
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
                <SelectTrigger className="rounded-full">
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
                    (computer) => computer.id === editingUser.computer?.id
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
              <p className="text-xs text-slate-500">
                Deja "Sin equipo asignado" para desvincular el usuario.
              </p>
            </div>
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="secondary"
              className="rounded-full"
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
              className="rounded-full"
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
