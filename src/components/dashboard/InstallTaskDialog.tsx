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
import { credencialesCompletas } from "@/lib/installTasks";
import { ChevronDown, Lock, Rocket, User } from "lucide-react";

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

type Ajuste = { usuario: string; clave: string };

/**
 * Asistente de tarea de instalación: los destinos, numerados,
 * cada uno con SU usuario y SU contraseña siempre a la vista
 * — lo normal en la red de Gothan es que ningún equipo
 * comparta cuenta con otro. La cuenta general queda como
 * RESERVA opcional, plegada al final: solo hace falta si
 * algún equipo se deja sin la suya. Si a un equipo le falta
 * su credencial, su número se marca en rojo y el aviso del
 * pie lo nombra por ese número.
 *
 * Las claves viven solo en la memoria del servidor mientras
 * la tarea corre: no se guardan.
 */
export function InstallTaskDialog({
  open,
  onOpenChange,
  destinos,
  onCreada,
}: Props) {
  // Credencial propia por destino (clave del registro:
  // «pcName|ip»): la de cada equipo, escrita en su fila.
  const [ajustes, setAjustes] = useState<Record<string, Ajuste>>({});
  // Cuenta de reserva (la «general» de siempre), opcional.
  const [usuario, setUsuario] = useState("");
  const [clave, setClave] = useState("");
  const [reservaAbierta, setReservaAbierta] = useState(false);
  const [omitir, setOmitir] = useState(true);
  const [intentos, setIntentos] = useState(2);
  const [creando, setCreando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const cerrar = (nuevo: boolean) => {
    if (creando) return;
    if (!nuevo) {
      setClave("");
      setAjustes({});
      setError(null);
    }
    onOpenChange(nuevo);
  };

  const claveDeDestino = (d: DestinoTarea) => `${d.pcName}|${d.ip}`;

  const general = { usuario: usuario.trim(), clave };
  // La tarea solo puede nacer si TODO destino queda con una
  // credencial efectiva completa (regla pura, la misma cuenta
  // que hará el servidor con lo que se le mande).
  const completo = credencialesCompletas(
    general,
    destinos.map((d) => ajustes[claveDeDestino(d)]),
  );
  // Números (los de las filas) de los equipos sin cubrir.
  const faltan = destinos
    .map((d, i) => {
      const ajuste = ajustes[claveDeDestino(d)];
      const efectiva = ajuste?.clave
        ? {
            usuario: ajuste.usuario.trim() || general.usuario,
            clave: ajuste.clave,
          }
        : general;
      return !efectiva.usuario || !efectiva.clave ? i + 1 : null;
    })
    .filter((n): n is number => n !== null);
  const listaFaltan =
    faltan.length <= 2
      ? faltan.join(" y ")
      : `${faltan.slice(0, -1).join(", ")} y ${faltan[faltan.length - 1]}`;

  const ponerAjuste = (k: string, ajuste: Ajuste) =>
    setAjustes((prev) => ({ ...prev, [k]: ajuste }));

  const crear = async () => {
    setError(null);
    const csrfToken = getCsrfTokenFromDocument();
    if (!csrfToken) {
      setError("Sesión sin token de seguridad. Inicia sesión nuevamente.");
      return;
    }
    // Viajan los destinos con contraseña propia escrita: es
    // lo que el servidor guarda como ajuste (el usuario
    // propio acompaña si se escribió; si no, manda el de la
    // reserva, si lo hay).
    const credenciales = destinos
      .map((d) => {
        const ajuste = ajustes[claveDeDestino(d)];
        if (!ajuste?.clave) return null;
        return {
          pcName: d.pcName,
          ip: d.ip,
          ...(ajuste.usuario.trim()
            ? { usuario: ajuste.usuario.trim() }
            : {}),
          clave: ajuste.clave,
        };
      })
      .filter(Boolean);
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
          ...(credenciales.length > 0 ? { credenciales } : {}),
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
      setAjustes({});
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
      <DialogContent className="max-w-xl gap-3 p-5">
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

        <div className="space-y-4">
          <div>
            <p className="smallcaps text-muted-foreground">
              Destinos ({destinos.length})
            </p>
            <ul className="frame-double mt-2.5 max-h-72 divide-y divide-border/60 overflow-y-auto bg-muted/20 px-3">
              {destinos.map((d, i) => {
                const k = claveDeDestino(d);
                const ajuste = ajustes[k] ?? { usuario: "", clave: "" };
                const sinCubrir = faltan.includes(i + 1);
                return (
                  <li key={k} className="flex gap-2.5 py-2">
                    <span
                      aria-hidden
                      className={`flex size-6 shrink-0 items-center justify-center border font-mono text-xs ${
                        sinCubrir
                          ? "border-destructive/60 font-semibold text-destructive"
                          : "border-border bg-background text-muted-foreground"
                      }`}
                    >
                      {i + 1}
                    </span>
                    <div className="min-w-0 flex-1 space-y-1.5">
                      {d.pcName !== d.ip ? (
                        <p className="truncate text-sm leading-6">
                          <span className="font-medium text-foreground">
                            {d.pcName}
                          </span>{" "}
                          <span className="font-mono text-xs text-muted-foreground">
                            {d.ip}
                          </span>
                        </p>
                      ) : (
                        <p className="truncate font-mono text-sm leading-6 text-foreground">
                          {d.ip}
                        </p>
                      )}
                      <div className="flex items-center gap-2">
                        <div className="relative flex-1">
                          <User className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                          <Input
                            value={ajuste.usuario}
                            onChange={(e) =>
                              ponerAjuste(k, {
                                ...ajuste,
                                usuario: e.target.value,
                              })
                            }
                            placeholder="Su usuario"
                            className="h-8 pl-9 text-sm"
                            autoComplete="off"
                            aria-label={`Usuario del equipo ${i + 1} (${d.pcName})`}
                          />
                        </div>
                        <div className="relative flex-1">
                          <Lock className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                          <Input
                            type="password"
                            value={ajuste.clave}
                            onChange={(e) =>
                              ponerAjuste(k, {
                                ...ajuste,
                                clave: e.target.value,
                              })
                            }
                            placeholder="Su contraseña"
                            className="h-8 pl-9 text-sm"
                            autoComplete="off"
                            aria-label={`Contraseña del equipo ${i + 1} (${d.pcName})`}
                          />
                        </div>
                      </div>
                    </div>
                  </li>
                );
              })}
            </ul>
            <p className="mt-1.5 text-[11px] leading-relaxed text-muted-foreground">
              Se empuja por SMB con su cuenta; si su agente ya
              reporta, se actualiza por su canal. Solo se da por
              instalado cuando el agente da su primera señal.
            </p>
          </div>

          <div>
            <button
              type="button"
              onClick={() => setReservaAbierta((v) => !v)}
              aria-expanded={reservaAbierta}
              className="flex items-center gap-1.5 text-sm text-muted-foreground underline-offset-2 hover:text-foreground"
            >
              <ChevronDown
                className={`size-4 transition-transform ${reservaAbierta ? "rotate-180" : ""}`}
              />
              Cuenta de reserva (opcional)
            </button>
            {reservaAbierta && (
              <div className="mt-2 space-y-1.5">
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <Label htmlFor="tarea-usuario">
                      Usuario administrador
                    </Label>
                    <div className="relative">
                      <User className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                      <Input
                        id="tarea-usuario"
                        value={usuario}
                        onChange={(e) => setUsuario(e.target.value)}
                        placeholder="Administrador local"
                        className="h-8 pl-9"
                        autoComplete="off"
                      />
                    </div>
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="tarea-clave">Contraseña</Label>
                    <div className="relative">
                      <Lock className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                      <Input
                        id="tarea-clave"
                        type="password"
                        value={clave}
                        onChange={(e) => setClave(e.target.value)}
                        placeholder="La de reserva"
                        className="h-8 pl-9"
                        autoComplete="off"
                      />
                    </div>
                  </div>
                </div>
                <p className="text-[11px] text-muted-foreground">
                  Solo para los equipos que dejes sin la suya.
                  Ninguna contraseña se guarda: viven solo en la
                  memoria del servidor mientras la tarea corre.
                </p>
              </div>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
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

          {!completo && destinos.length > 0 && (
            <p className="text-xs text-destructive">
              {faltan.length === 1
                ? `Al equipo ${listaFaltan} le falta su usuario y su contraseña (o una cuenta de reserva completa).`
                : `A los equipos ${listaFaltan} les falta su usuario y su contraseña (o una cuenta de reserva completa).`}
            </p>
          )}

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
            disabled={creando || !completo}
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
