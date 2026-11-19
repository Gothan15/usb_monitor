"use client";

// Los tres diálogos de la pestaña Usuarios (crear, editar y
// eliminar), como componentes propios: antes vivían dentro del
// componente de la pestaña y su estado también, así que cada
// tecla escrita en un campo volvía a pintar la tabla entera
// que hay detrás. Aquí cada diálogo guarda su formulario y su
// «ocupado» en casa: teclear solo repinta el diálogo. El
// diseño no cambia — mismo JSX, mismas clases, mismos textos.

import { useEffect, useState } from "react";
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
import * as usuariosApi from "@/lib/api/usuarios";
import type { Computer } from "./types";

export interface AdminUser {
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

interface UserFormState {
  username: string;
  password: string;
  computerId: string;
}

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

// ── Crear usuario ──────────────────────────────────────────

interface CreateUserDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Equipos ya ordenados por nombre (los ordena la pestaña). */
  computers: Computer[];
  /** Tras crear: la pestaña vuelve a la página 1 y recarga. */
  onCreated: () => void;
}

export function CreateUserDialog({
  open,
  onOpenChange,
  computers,
  onCreated,
}: CreateUserDialogProps) {
  const { toast } = useToast();
  const [createForm, setCreateForm] = useState<UserFormState>(() =>
    createEmptyForm(),
  );
  const [creating, setCreating] = useState(false);

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
      const selectedComputer = computers.find(
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
      const selectedComputer = computers.find(
        (computer) => computer.id === createForm.computerId,
      );

      const payload: Record<string, unknown> = {
        username: trimmedUsername,
        password: createForm.password,
      };

      if (selectedComputer) {
        payload.computerId = selectedComputer.id;
      }

      const data = await usuariosApi.crear(payload);
      toast({
        title: "Usuario creado",
        description: `Se registró ${
          data.item?.username ?? createForm.username
        }.`,
      });
      onOpenChange(false);
      setCreateForm(createEmptyForm());
      onCreated();
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

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Crear nuevo usuario</DialogTitle>
          <DialogDescription>
            Define las credenciales iniciales y, si aplica, el equipo
            asociado.
          </DialogDescription>
        </DialogHeader>
        {/* Formulario de verdad, aunque sea con display:contents
            para no tocar el layout: así Enter en cualquier campo
            envía (crear el usuario), igual que Escape cierra. Sin
            el form, Enter no hacía nada. */}
        <form
          className="contents"
          onSubmit={(event) => {
            event.preventDefault();
            void handleCreateUser();
          }}
        >
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
                  setCreateForm((prev) => ({
                    ...prev,
                    password: generateRandomPassword(),
                  }))
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
                    computers.length
                      ? "Selecciona un equipo"
                      : "No hay equipos disponibles"
                  }
                />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NO_COMPUTER_VALUE}>
                  Sin equipo asignado
                </SelectItem>
                {computers.map((computer) => (
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
            onClick={() => onOpenChange(false)}
            disabled={creating}
          >
            Cancelar
          </Button>
          <Button type="submit" disabled={creating}>
            {creating ? "Creando..." : "Crear usuario"}
          </Button>
        </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ── Editar usuario ─────────────────────────────────────────

interface EditUserDialogProps {
  /** El usuario a editar; null = diálogo cerrado. */
  user: AdminUser | null;
  onClose: () => void;
  /** Equipos ya ordenados por nombre (los ordena la pestaña). */
  computers: Computer[];
  /** Tras guardar: la pestaña recarga la lista. */
  onUpdated: () => void;
}

export function EditUserDialog({
  user,
  onClose,
  computers,
  onUpdated,
}: EditUserDialogProps) {
  const { toast } = useToast();
  const [editForm, setEditForm] = useState<UserFormState>(() =>
    createEmptyForm(),
  );
  const [updating, setUpdating] = useState(false);

  // El formulario nace del usuario elegido (lo que antes hacía
  // openEdit en la pestaña al pulsar el lápiz de la fila).
  useEffect(() => {
    if (!user) return;
    setEditForm({
      username: user.username,
      password: "",
      computerId: user.computer?.id ?? "",
    });
  }, [user]);

  const cerrar = () => {
    onClose();
    setEditForm(createEmptyForm());
  };

  const handleUpdateUser = async () => {
    if (!user) return;

    const payload: Record<string, unknown> = {};
    const trimmedUsername = editForm.username.trim();
    if (trimmedUsername && trimmedUsername !== user.username) {
      payload.username = trimmedUsername;
    }

    const trimmedPassword = editForm.password.trim();
    if (trimmedPassword) {
      payload.password = trimmedPassword;
    }

    const currentComputerId = user.computer?.id ?? "";
    if (editForm.computerId !== currentComputerId) {
      if (!editForm.computerId) {
        payload.computerId = null;
      } else {
        const selectedComputer = computers.find(
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
      const data = await usuariosApi.actualizar(user.id, payload);
      toast({
        title: "Usuario actualizado",
        description: `Se guardaron los cambios de ${
          data.item?.username ?? user.username
        }.`,
      });
      cerrar();
      onUpdated();
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

  return (
    <Dialog
      open={Boolean(user)}
      onOpenChange={(open) => {
        if (!open) cerrar();
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
        {/* Como el de crear: form con display:contents para que
            Enter envíe los cambios sin tocar el layout. */}
        <form
          className="contents"
          onSubmit={(event) => {
            event.preventDefault();
            void handleUpdateUser();
          }}
        >
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
                  setEditForm((prev) => ({
                    ...prev,
                    password: generateRandomPassword(),
                  }))
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
                    computers.length
                      ? "Selecciona un equipo"
                      : "No hay equipos disponibles"
                  }
                />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NO_COMPUTER_VALUE}>
                  Sin equipo asignado
                </SelectItem>
                {computers.map((computer) => (
                  <SelectItem key={computer.id} value={computer.id}>
                    {computer.name} · {computer.ipAddress}
                  </SelectItem>
                ))}
                {user?.computer &&
                !computers.some(
                  (computer) => computer.id === user.computer?.id,
                ) ? (
                  <SelectItem value={user.computer.id}>
                    {user.computer.name}
                    {user.computer.ipAddress
                      ? ` · ${user.computer.ipAddress}`
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
            onClick={cerrar}
            disabled={updating}
          >
            Cancelar
          </Button>
          <Button type="submit" disabled={updating}>
            {updating ? "Guardando..." : "Guardar cambios"}
          </Button>
        </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ── Eliminar usuario ───────────────────────────────────────

interface DeleteUserDialogProps {
  /** El usuario a eliminar; null = diálogo cerrado. */
  user: AdminUser | null;
  onClose: () => void;
  /** Tras eliminar: la pestaña recarga la lista. */
  onDeleted: () => void;
}

export function DeleteUserDialog({
  user,
  onClose,
  onDeleted,
}: DeleteUserDialogProps) {
  const { toast } = useToast();
  const [deleting, setDeleting] = useState(false);

  const handleDeleteUser = async () => {
    if (!user) return;
    setDeleting(true);
    try {
      await usuariosApi.eliminar(user.id);
      toast({
        title: "Usuario eliminado",
        description: `${user.username} fue removido del directorio.`,
      });
      onClose();
      onDeleted();
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

  return (
    <AlertDialog
      open={Boolean(user)}
      onOpenChange={(open) => {
        if (!open) onClose();
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
  );
}
