"use client";

import { useState, useEffect } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import {
  Server,
  LayoutTemplate,
  RotateCcw,
  Activity,
  KeyRound,
} from "lucide-react";
import { useLayoutStore, type Disposicion } from "@/store/useLayoutStore";
import { PanelLeft, PanelTop } from "lucide-react";
import { useLiveSyncStore } from "@/store/useLiveSyncStore";
import { Switch } from "@/components/ui/switch";

interface ApiSettings {
  startupNetworkDelay: number;
}

interface UnlockSettings {
  passwordUnlockEnabled: boolean;
  offlineEmergencyEnabled: boolean;
  requireAgentToken: boolean;
  lockSessionOnInsert: boolean;
  shutdownOnNonWhitelisted: boolean;
  shutdownCountdownSeconds: number;
  silenceThresholdMinutes: number;
}

const SECCIONES = [
  { id: "sincronizacion-en-tiempo-real", nombre: "Sincronización en Tiempo Real" },
  { id: "api-y-automatizacion", nombre: "API y automatización" },
  { id: "desbloqueo-por-contrasena", nombre: "Desbloqueo por contraseña" },
  { id: "interfaz-y-navegacion", nombre: "Interfaz y Navegación" },
] as const;

export function SettingsTab() {
  const { toast } = useToast();
  const [api, setApi] = useState<ApiSettings>({
    startupNetworkDelay: 15,
  });
  const [unlock, setUnlock] = useState<UnlockSettings>({
    passwordUnlockEnabled: true,
    offlineEmergencyEnabled: true,
    requireAgentToken: false,
    lockSessionOnInsert: false,
    shutdownOnNonWhitelisted: false,
    shutdownCountdownSeconds: 60,
    silenceThresholdMinutes: 5,
  });

  const disposicion = useLayoutStore((state) => state.disposicion);
  const setDisposicion = useLayoutStore((state) => state.setDisposicion);
  const { isLiveSyncEnabled, toggleLiveSync } = useLiveSyncStore();
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
    fetch("/api/settings")
      .then((res) => res.json())
      .then((data) => {
        if (data.startup_network_delay !== undefined) {
          setApi({
            startupNetworkDelay: data.startup_network_delay,
          });
          setApiInicial(data.startup_network_delay);
        }
        const unlockCargado = {
          passwordUnlockEnabled: data.passwordUnlockEnabled ?? true,
          offlineEmergencyEnabled: data.offlineEmergencyEnabled ?? true,
          requireAgentToken: data.requireAgentToken ?? false,
          lockSessionOnInsert: data.lockSessionOnInsert ?? false,
          shutdownOnNonWhitelisted: data.shutdownOnNonWhitelisted ?? false,
          shutdownCountdownSeconds: data.shutdownCountdownSeconds ?? 60,
          silenceThresholdMinutes: data.silenceThresholdMinutes ?? 5,
        };
        setUnlock(unlockCargado);
        setUnlockInicial(unlockCargado);
      })
      .catch((err) => console.error("Failed to load settings", err));
  }, []);

  const [apiInicial, setApiInicial] = useState<number | null>(null);
  const [unlockInicial, setUnlockInicial] = useState<UnlockSettings | null>(null);

  const saveSettings = async (
    sectionLabel: string,
    payload: any,
    alGuardar?: () => void,
  ) => {
    try {
      const res = await fetch("/api/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (res.ok) {
        showSavedToast(sectionLabel);
        alGuardar?.();
      } else {
        toast({
          title: "Error al guardar",
          description: "Hubo un problema al aplicar los cambios.",
          variant: "destructive",
        });
      }
    } catch (err) {
      toast({
        title: "Error de red",
        description: "No se pudo conectar con el servidor.",
        variant: "destructive",
      });
    }
  };

  const showSavedToast = (label: string) =>
    toast({
      title: `${label} actualizado`,
      description: "Los cambios se aplicaron correctamente.",
    });

  return (
    <div className="animate-view-in lg:grid lg:grid-cols-[230px_minmax(0,1fr)] lg:gap-14">
      {/* ── Índice de ajustes ── */}
      <aside className="mb-10 lg:mb-0">
        <div className="lg:sticky lg:top-8">
          <p className="smallcaps text-muted-foreground">Índice de ajustes</p>
          <nav className="mt-4 flex gap-x-6 gap-y-1 overflow-x-auto lg:flex-col lg:overflow-visible">
            {SECCIONES.map((seccion) => (
              <a
                key={seccion.id}
                href={`#${seccion.id}`}
                className="smallcaps whitespace-nowrap py-1.5 text-muted-foreground transition-colors hover:text-foreground lg:border-l lg:border-border lg:pl-4 lg:hover:border-[var(--acero)]"
              >
                {seccion.nombre}
              </a>
            ))}
          </nav>
        </div>
      </aside>

      {/* ── Secciones ── */}
      <div className="min-w-0">
        <section id="sincronizacion-en-tiempo-real" className="scroll-mt-24 pb-12">
          <h2 className="font-display flex items-center gap-2.5 text-[1.4rem] font-bold leading-tight text-foreground">
            <Activity className="size-5 shrink-0 text-[var(--acero)]" />
            Sincronización en Tiempo Real
          </h2>
          <p className="mt-2 max-w-2xl text-sm leading-relaxed text-muted-foreground">
            Controla la recepción automática de datos a través de WebSockets.
          </p>

          <div className="mt-8 flex flex-row items-center justify-between gap-6">
            <div className="max-w-[80%] space-y-0.5">
              <Label className="text-base font-medium">Sincronización de datos en vivo</Label>
              <p className="text-xs leading-relaxed text-muted-foreground">
                Habilita o deshabilita la actualización automática de eventos, equipos y usuarios en la interfaz. Cuando está desactivado, podrás refrescar manualmente.
              </p>
            </div>
            {mounted && (
              <Switch
                checked={isLiveSyncEnabled}
                onCheckedChange={toggleLiveSync}
                
              />
            )}
          </div>
        </section>

        <section
          id="api-y-automatizacion"
          className="scroll-mt-24 border-t border-border py-12"
        >
          <h2 className="font-display flex items-center gap-2.5 text-[1.4rem] font-bold leading-tight text-foreground">
            <Server className="size-5 shrink-0 text-[var(--acero)]" />
            API y automatización
          </h2>
          <p className="mt-2 max-w-2xl text-sm leading-relaxed text-muted-foreground">
            Gestiona acceso al API REST y los comandos remotos del agente.
          </p>

          <div className="mt-8 max-w-xl">
            <Label className="text-xs font-semibold uppercase tracking-[0.22em] text-muted-foreground">
              Espera de red al arranque (segundos)
            </Label>
            <Input
              type="number"
              min={0}
              value={api.startupNetworkDelay}
              onChange={(event) =>
                setApi({ startupNetworkDelay: Number(event.target.value) || 0 })
              }
              className="mt-2"
            />
            <p className="mt-2 text-xs text-muted-foreground">
              Tiempo de espera en el arranque para parches de red.
            </p>
          </div>
          <Button
            className="mt-8"
            onClick={() =>
              saveSettings(
                "API y automatización",
                { startup_network_delay: api.startupNetworkDelay },
                () => setApiInicial(api.startupNetworkDelay),
              )
            }
            disabled={
              apiInicial === null ||
              api.startupNetworkDelay === apiInicial
            }
          >
            Guardar cambios
          </Button>
        </section>

        <section
          id="desbloqueo-por-contrasena"
          className="scroll-mt-24 border-t border-border py-12"
        >
          <h2 className="font-display flex items-center gap-2.5 text-[1.4rem] font-bold leading-tight text-foreground">
            <KeyRound className="size-5 shrink-0 text-[var(--acero)]" />
            Desbloqueo por contraseña
          </h2>
          <p className="mt-2 max-w-2xl text-sm leading-relaxed text-muted-foreground">
            Interruptores del flujo 2FA de los USB y de la detección de
            agentes por silencio.
          </p>

          <div className="mt-4 divide-y divide-border">
            <div className="flex items-center justify-between gap-4 py-5">
              <div>
                <Label>Desbloqueo por contraseña activo</Label>
                <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                  Si se apaga, ningún USB se libera con contraseña: queda
                  bloqueado como si no estuviera en la lista blanca.
                </p>
              </div>
              <Switch
                checked={unlock.passwordUnlockEnabled}
                onCheckedChange={(v) => setUnlock({ ...unlock, passwordUnlockEnabled: v })}
              />
            </div>
            <div className="flex items-center justify-between gap-4 py-5">
              <div>
                <Label>Emergencia sin red</Label>
                <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                  Permite desbloquear con la contraseña verificada contra el
                  hash guardado en la propia PC cuando no hay conexión.
                </p>
              </div>
              <Switch
                checked={unlock.offlineEmergencyEnabled}
                onCheckedChange={(v) => setUnlock({ ...unlock, offlineEmergencyEnabled: v })}
              />
            </div>
            <div className="flex items-center justify-between gap-4 py-5">
              <div>
                <Label>Exigir token por equipo</Label>
                <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                  La ingesta de eventos deja de ser abierta: cada agente se
                  autentica con su token. Actívalo cuando todos los agentes
                  estén actualizados.
                </p>
              </div>
              <Switch
                checked={unlock.requireAgentToken}
                onCheckedChange={(v) => setUnlock({ ...unlock, requireAgentToken: v })}
              />
            </div>
            <div className="flex items-center justify-between gap-4 py-5">
              <div>
                <Label>Bloquear la sesión al conectar un USB</Label>
                <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                  Además de bloquear el dispositivo, cierra la sesión de
                  Windows hasta que se desbloquee. Desactivado por defecto.
                </p>
              </div>
              <Switch
                checked={unlock.lockSessionOnInsert}
                onCheckedChange={(v) => setUnlock({ ...unlock, lockSessionOnInsert: v })}
              />
            </div>
            <div className="flex items-center justify-between gap-4 py-5">
              <div>
                <Label>Apagar el equipo si el dispositivo no está en la lista blanca</Label>
                <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                  Al insertar un dispositivo fuera de la lista blanca, el
                  equipo cliente inicia una cuenta atrás y se apaga,
                  con el tiempo que definas abajo. Se cancela si el dispositivo se extrae o se
                  desbloquea a tiempo, y no se aplica a lo que ya estaba
                  conectado al arrancar el servicio. Desactivado por
                  defecto.
                </p>
              </div>
              <Switch
                checked={unlock.shutdownOnNonWhitelisted}
                onCheckedChange={(v) => setUnlock({ ...unlock, shutdownOnNonWhitelisted: v })}
              />
            </div>
            <div className="py-5 pl-0">
              <div className="max-w-xl">
                <Label className="text-xs font-semibold uppercase tracking-[0.22em] text-muted-foreground">
                  Tiempo antes de apagar (segundos)
                </Label>
                <Input
                  type="number"
                  min={10}
                  max={600}
                  value={unlock.shutdownCountdownSeconds}
                  disabled={!unlock.shutdownOnNonWhitelisted}
                  onChange={(event) =>
                    setUnlock({ ...unlock, shutdownCountdownSeconds: Number(event.target.value) || 60 })
                  }
                  className="mt-2 w-28"
                />
                <p className="mt-2 text-xs text-muted-foreground">
                  Cuenta atrás visible en el equipo cliente antes de
                  apagarse: entre 10 y 600 segundos. Extraer o
                  desbloquear el dispositivo la cancela.
                </p>
              </div>
            </div>
            <div className="py-5">
              <div className="max-w-xl">
                <Label className="text-xs font-semibold uppercase tracking-[0.22em] text-muted-foreground">
                  Umbral de silencio del agente (minutos)
                </Label>
                <Input
                  type="number"
                  min={1}
                  value={unlock.silenceThresholdMinutes}
                  onChange={(event) =>
                    setUnlock({ ...unlock, silenceThresholdMinutes: Number(event.target.value) || 5 })
                  }
                  className="mt-2"
                />
                <p className="mt-2 text-xs text-muted-foreground">
                  Tiempo sin señales para marcar un equipo «sin agente» en la
                  vista de Desbloqueos.
                </p>
              </div>
            </div>
          </div>
          <Button
            onClick={() =>
              saveSettings("Desbloqueo por contraseña", { ...unlock }, () =>
                setUnlockInicial({ ...unlock }),
              )
            }
            disabled={
              unlockInicial === null ||
              JSON.stringify(unlock) === JSON.stringify(unlockInicial)
            }
          >
            Guardar cambios
          </Button>
        </section>

        <section
          id="interfaz-y-navegacion"
          className="scroll-mt-24 border-t border-border py-12"
        >
          <h2 className="font-display flex items-center gap-2.5 text-[1.4rem] font-bold leading-tight text-foreground">
            <LayoutTemplate className="size-5 shrink-0 text-[var(--acero)]" />
            Interfaz y Navegación
          </h2>
          <p className="mt-2 max-w-2xl text-sm leading-relaxed text-muted-foreground">
            Personaliza la experiencia visual y los componentes del dashboard.
          </p>

          <div className="mt-8">
            <Label className="text-xs font-semibold uppercase tracking-[0.22em] text-muted-foreground">
              Disposición del panel
            </Label>
            <div className="mt-3 flex flex-wrap gap-3">
              {(
                [
                  {
                    valor: "cabecera",
                    titulo: "Cabecera",
                    detalle: "Navegación en la barra superior",
                    Icono: PanelTop,
                  },
                  {
                    valor: "lateral",
                    titulo: "Barra lateral",
                    detalle: "Navegación a la izquierda",
                    Icono: PanelLeft,
                  },
                ] as const
              ).map(({ valor, titulo, detalle, Icono }) => {
                const activa = disposicion === valor;
                return (
                  <button
                    key={valor}
                    type="button"
                    onClick={() => setDisposicion(valor as Disposicion)}
                    aria-pressed={activa}
                    className={
                      activa
                        ? "flex min-w-[220px] items-start gap-3 border border-[var(--acero)] bg-primary/[0.05] px-4 py-3.5 text-left"
                        : "flex min-w-[220px] items-start gap-3 border border-border px-4 py-3.5 text-left transition-colors hover:border-muted-foreground/50"
                    }
                  >
                    <Icono
                      className={
                        activa
                          ? "mt-0.5 size-5 shrink-0 text-[var(--acero)]"
                          : "mt-0.5 size-5 shrink-0 text-muted-foreground"
                      }
                    />
                    <span>
                      <span className="block text-sm font-semibold text-foreground">
                        {titulo}
                      </span>
                      <span className="mt-0.5 block text-xs leading-relaxed text-muted-foreground">
                        {detalle}
                      </span>
                    </span>
                  </button>
                );
              })}
            </div>
            <p className="mt-3 max-w-xl text-xs leading-relaxed text-muted-foreground">
              Se aplica al momento y se recuerda en este navegador. En
              pantallas pequeñas se usa siempre la cabecera.
            </p>
          </div>
        </section>
      </div>
    </div>
  );
}
