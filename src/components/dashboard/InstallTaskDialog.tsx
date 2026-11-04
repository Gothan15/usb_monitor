"use client";

import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Spinner } from "@/components/ui/spinner";
import { getCsrfTokenFromDocument } from "@/lib/utils";
import { Info, Lock, Rocket, User } from "lucide-react";

export interface DestinoTarea {
  pcName: string;
  ip: string;
}

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Destinos elegidos (del escáner de red o de Equipos). */
  destinos: DestinoTarea[];
  /** La tarea quedó creada: la vista de Tareas ya la muestra. */
  onCreada?: () => void;
}

/**
 * Asistente de tarea de instalación (fase D): una sola pantalla
 * con destinos, credenciales y opciones. Al confirmar se crea
 * la tarea y el ejecutor del panel trabaja en segundo plano;
 * el progreso se sigue en la vista de Tareas.
 *
 * La clave se escribe aquí una vez por tarea y vive solo en la
 * memoria del servidor mientras la tarea corre: no se guarda.
 */
export function InstallTaskDialog({
  open,
  onOpenChange,
  destinos,
  onCreada,
}: Props) {
  const [usuario, setUsuario] = useState("");
  const [clave, setClave] = useState("");
  const [omitir, setOmitir] = useState(true);
  const [intentos, setIntentos] = useState(2);
  const [creando, setCreando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const cerrar = (nuevo: boolean) => {
    if (creando) return;
    if (!nuevo) {
      setClave("");
      setError(null);
    }
    onOpenChange(nuevo);
  };

  const crear = async () => {
    setError(null);
    const csrfToken = getCsrfTokenFromDocument();
    if (!csrfToken) {
      setError("Sesión sin token de seguridad. Inicia sesión nuevamente.");
      return;
    }
    try {
      setCreando(true);
      const res = await fetch("/api/install-tasks", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-csrf-token": csrfToken,
        },
        credentials: "include",
        body: JSON.stringify({
          destinos,
          usuario: usuario.trim(),
          clave,
          omitirSiInstalado: omitir,
          intentosMaximos: intentos,
        }),
      });
      const datos = await res.json().catch(() => null);
      if (!res.ok || !datos?.ok) {
        setError(datos?.error || "No se pudo crear la tarea.");
        return;
      }
      setClave("");
      onOpenChange(false);
      onCreada?.();
    } catch {
      setError("No se pudo contactar con el panel. Inténtalo de nuevo.");
    } finally {
      setCreando(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={cerrar}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Rocket className="size-5" />
            Instalar el agente — tarea nueva
          </DialogTitle>
          <DialogDescription>
            Se instala en segundo plano, dos equipos a la vez. El
            progreso se sigue en la vista «Tareas».
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-5">
          <div>
            <p className="smallcaps text-muted-foreground">
              Destinos ({destinos.length})
            </p>
            <ul className="mt-2 max-h-32 space-y-1 overflow-y-auto border border-border/60 bg-muted/20 px-3 py-2">
              {destinos.map((d) => (
                <li
                  key={`${d.pcName}|${d.ip}`}
                  className="flex items-baseline justify-between gap-3 text-sm"
                >
                  <span className="truncate font-medium text-foreground">
                    {d.pcName}
                  </span>
                  <span className="font-mono text-xs text-muted-foreground">
                    {d.ip}
                  </span>
                </li>
              ))}
            </ul>
            <p className="mt-2 flex items-start gap-1.5 text-xs leading-relaxed text-muted-foreground">
              <Info className="mt-0.5 size-3.5 shrink-0" />
              Cada equipo va por donde le toca: si su agente ya
              reporta, se actualiza por su canal sin credenciales;
              si es un equipo nuevo, se empuja por SMB con la
              cuenta de abajo. En ambos casos solo se da por
              instalado cuando el agente da su primera señal.
            </p>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="tarea-usuario">Usuario administrador</Label>
              <div className="relative">
                <User className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  id="tarea-usuario"
                  value={usuario}
                  onChange={(e) => setUsuario(e.target.value)}
                  placeholder="Administrador local"
                  className="pl-9"
                  autoComplete="off"
                />
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="tarea-clave">Contraseña</Label>
              <div className="relative">
                <Lock className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  id="tarea-clave"
                  type="password"
                  value={clave}
                  onChange={(e) => setClave(e.target.value)}
                  placeholder="La de los destinos"
                  className="pl-9"
                  autoComplete="off"
                />
              </div>
            </div>
          </div>
          <p className="-mt-3 text-xs text-muted-foreground">
            La contraseña no se guarda: vive solo en la memoria
            del servidor mientras la tarea corre. Si el panel se
            reinicia a mitad, la tarea se marca interrumpida y al
            reintentar te la pide otra vez.
          </p>

          <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
            <label className="flex cursor-pointer items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={omitir}
                onChange={(e) => setOmitir(e.target.checked)}
                className="size-4 cursor-pointer appearance-none border border-border bg-transparent transition-colors checked:border-[var(--acero)] checked:bg-[var(--acero)]"
              />
              Omitir los que ya tengan el agente
            </label>
            <label className="flex items-center gap-2 text-sm">
              Intentos por equipo
              <select
                value={intentos}
                onChange={(e) => setIntentos(Number(e.target.value))}
                className="border border-border bg-transparent px-2 py-1 text-sm"
              >
                {[1, 2, 3, 4, 5].map((n) => (
                  <option key={n} value={n}>
                    {n}
                  </option>
                ))}
              </select>
            </label>
          </div>

          {error && (
            <Alert variant="destructive">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}
        </div>

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => cerrar(false)}
            disabled={creando}
          >
            Cancelar
          </Button>
          <Button
            onClick={() => void crear()}
            disabled={
              creando ||
              destinos.length === 0 ||
              !usuario.trim() ||
              clave.length === 0
            }
          >
            {creando ? (
              <Spinner size={14} />
            ) : (
              <Rocket className="mr-2 size-4" />
            )}
            Crear tarea e instalar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
