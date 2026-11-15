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
import { Info, KeyRound, Lock, Rocket, User, X } from "lucide-react";

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
 * Asistente de tarea de instalación: una sola pantalla con la
 * cuenta general y UNA lista de destinos. Cada destino va con
 * la general salvo que se le abra su fila y se le escriba su
 * propia contraseña (y, si difiere, su propio usuario): la
 * lista de destinos y la de credenciales propias son la misma,
 * para que instalar en varios equipos a la vez no obligue a
 * cruzar dos listas gemelas.
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
  const [usuario, setUsuario] = useState("");
  const [clave, setClave] = useState("");
  // Credencial propia por destino (clave del registro:
  // «pcName|ip»), para los equipos que no usan la general.
  const [ajustes, setAjustes] = useState<Record<string, Ajuste>>({});
  // Filas con el editor de credencial propia desplegado.
  const [abiertas, setAbiertas] = useState<Record<string, boolean>>({});
  const [omitir, setOmitir] = useState(true);
  const [intentos, setIntentos] = useState(2);
  const [creando, setCreando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const cerrar = (nuevo: boolean) => {
    if (creando) return;
    if (!nuevo) {
      setClave("");
      setAjustes({});
      setAbiertas({});
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
  const conPropia = destinos.filter(
    (d) => ajustes[claveDeDestino(d)]?.clave,
  ).length;
  const sinCubrir = destinos.filter((d) => {
    const ajuste = ajustes[claveDeDestino(d)];
    const efectiva = ajuste?.clave
      ? {
          usuario: ajuste.usuario.trim() || general.usuario,
          clave: ajuste.clave,
        }
      : general;
    return !efectiva.usuario || !efectiva.clave;
  }).length;

  const ponerAjuste = (k: string, ajuste: Ajuste) =>
    setAjustes((prev) => ({ ...prev, [k]: ajuste }));

  const quitarAjuste = (k: string) => {
    setAjustes((prev) => {
      const copia = { ...prev };
      delete copia[k];
      return copia;
    });
    setAbiertas((prev) => ({ ...prev, [k]: false }));
  };

  const crear = async () => {
    setError(null);
    const csrfToken = getCsrfTokenFromDocument();
    if (!csrfToken) {
      setError("Sesión sin token de seguridad. Inicia sesión nuevamente.");
      return;
    }
    // Solo viajan los destinos con contraseña propia escrita:
    // es lo que el servidor guarda como ajuste (el usuario
    // propio acompaña si se escribió; si no, manda el general).
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
      setAbiertas({});
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
      <DialogContent className="max-w-xl">
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
              Cuenta general
            </p>
            <div className="mt-2 grid grid-cols-2 gap-4">
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
                    placeholder="La general"
                    className="pl-9"
                    autoComplete="off"
                  />
                </div>
              </div>
            </div>
            <p className="mt-2 text-xs text-muted-foreground">
              La contraseña no se guarda: vive solo en la memoria
              del servidor mientras la tarea corre.
            </p>
          </div>

          <div>
            <div className="flex items-baseline justify-between gap-3">
              <p className="smallcaps text-muted-foreground">
                Destinos ({destinos.length})
              </p>
              {conPropia > 0 && (
                <button
                  type="button"
                  onClick={() => {
                    setAjustes({});
                    setAbiertas({});
                  }}
                  className="text-xs text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
                >
                  Quitar las {conPropia} propias y usar la general en
                  todos
                </button>
              )}
            </div>
            <ul className="mt-2 max-h-64 divide-y divide-border/60 overflow-y-auto border border-border/60 bg-muted/20 px-3">
              {destinos.map((d) => {
                const k = claveDeDestino(d);
                const ajuste = ajustes[k] ?? { usuario: "", clave: "" };
                const tienePropia = ajuste.clave.length > 0;
                const abierta = !!abiertas[k];
                // Fila sin cubrir: ni la general ni la suya le
                // dan usuario y contraseña a la vez.
                const efectiva = tienePropia
                  ? {
                      usuario: ajuste.usuario.trim() || general.usuario,
                      clave: ajuste.clave,
                    }
                  : general;
                const cubierta = !!efectiva.usuario && !!efectiva.clave;
                // Usuario escrito sin contraseña: no forma
                // ajuste y hay que decirlo, no callarlo.
                const usuarioSuelto =
                  !tienePropia && ajuste.usuario.trim().length > 0;
                return (
                  <li key={k} className="py-2">
                    <div className="flex items-center gap-2">
                      <span className="min-w-0 flex-1">
                        {d.pcName !== d.ip ? (
                          <>
                            <span className="block truncate text-sm font-medium text-foreground">
                              {d.pcName}
                            </span>
                            <span className="block font-mono text-xs text-muted-foreground">
                              {d.ip}
                            </span>
                          </>
                        ) : (
                          <span className="block truncate font-mono text-sm text-foreground">
                            {d.ip}
                          </span>
                        )}
                      </span>
                      {!cubierta ? (
                        <span className="shrink-0 border border-destructive/50 px-1.5 py-0.5 text-[11px] font-medium text-destructive">
                          Sin credencial
                        </span>
                      ) : tienePropia ? (
                        <span className="shrink-0 border border-[var(--acero)] px-1.5 py-0.5 text-[11px] font-medium text-foreground">
                          Propia
                        </span>
                      ) : (
                        <span className="shrink-0 border border-border px-1.5 py-0.5 text-[11px] text-muted-foreground">
                          General
                        </span>
                      )}
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="h-7 shrink-0 px-2 text-xs"
                        onClick={() =>
                          setAbiertas((prev) => ({
                            ...prev,
                            [k]: !abierta,
                          }))
                        }
                        aria-expanded={abierta}
                      >
                        <KeyRound className="mr-1 size-3.5" />
                        {abierta
                          ? "Cerrar"
                          : tienePropia
                            ? "Editar"
                            : "Otra cuenta"}
                      </Button>
                    </div>
                    {abierta && (
                      <div className="mt-2 space-y-2">
                        <div className="flex items-center gap-2">
                          <Input
                            value={ajuste.usuario}
                            onChange={(e) =>
                              ponerAjuste(k, {
                                ...ajuste,
                                usuario: e.target.value,
                              })
                            }
                            placeholder="Usuario (si difiere)"
                            className="h-8 flex-1 text-sm"
                            autoComplete="off"
                            aria-label={`Usuario propio de ${d.pcName}`}
                          />
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
                            className="h-8 flex-1 text-sm"
                            autoComplete="off"
                            aria-label={`Contraseña propia de ${d.pcName}`}
                          />
                          {(ajuste.usuario || ajuste.clave) && (
                            <button
                              type="button"
                              onClick={() => quitarAjuste(k)}
                              className="flex shrink-0 items-center gap-1 text-xs text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
                            >
                              <X className="size-3.5" />
                              Quitar
                            </button>
                          )}
                        </div>
                        {usuarioSuelto && (
                          <p className="text-xs text-muted-foreground">
                            Sin su contraseña, el usuario suelto no
                            se aplica: este equipo va con la cuenta
                            general entera.
                          </p>
                        )}
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
            <p className="mt-2 flex items-start gap-1.5 text-xs leading-relaxed text-muted-foreground">
              <Info className="mt-0.5 size-3.5 shrink-0" />
              Cada equipo va con la cuenta general, salvo que le
              des otra en su fila. Si su agente ya reporta, se
              actualiza por su canal; si es nuevo, se empuja por
              SMB. Solo se da por instalado cuando el agente da
              su primera señal.
            </p>
          </div>

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

          {!completo && destinos.length > 0 && (
            <p className="text-xs text-destructive">
              {sinCubrir === destinos.length && !general.usuario && !general.clave
                ? "Escribe la cuenta general, o dale la suya a cada equipo en su fila."
                : `A ${sinCubrir} equipo${sinCubrir === 1 ? "" : "s"} le falta credencial completa: la general o la suya.`}
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
