"use client";

import { useState, useEffect } from "react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
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
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import {
  Server,
  LayoutTemplate,
  RotateCcw,
  Activity,
  KeyRound,
} from "lucide-react";
import {
  usePaginationSettings,
  PaginationStyle,
} from "@/hooks/usePaginationSettings";
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
  silenceThresholdMinutes: number;
}

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
    silenceThresholdMinutes: 5,
  });

  const { style, setStyle, setPosition } = usePaginationSettings();
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
        }
        setUnlock({
          passwordUnlockEnabled: data.passwordUnlockEnabled ?? true,
          offlineEmergencyEnabled: data.offlineEmergencyEnabled ?? true,
          requireAgentToken: data.requireAgentToken ?? false,
          lockSessionOnInsert: data.lockSessionOnInsert ?? false,
          silenceThresholdMinutes: data.silenceThresholdMinutes ?? 5,
        });
      })
      .catch((err) => console.error("Failed to load settings", err));
  }, []);

  const saveSettings = async (sectionLabel: string, payload: any) => {
    try {
      const res = await fetch("/api/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (res.ok) {
        showSavedToast(sectionLabel);
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
    <div className="grid gap-6 2xl:grid-cols-2">
      <Card className="rounded-xl border border-border/60 bg-card/80 shadow-xl backdrop-blur-xl">
        <CardHeader className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <CardTitle className="flex items-center gap-2 text-lg font-semibold text-foreground">
              <Activity className="h-4 w-4 text-green-500" />
              Sincronización en Tiempo Real
            </CardTitle>
            <CardDescription>
              Controla la recepción automática de datos a través de WebSockets.
            </CardDescription>
          </div>
          <Badge
            variant="outline"
            className="rounded-full border-border/40 bg-muted/30 text-xs text-muted-foreground"
          >
            Live Sync
          </Badge>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="grid gap-4 md:grid-cols-2">
            <div className="flex flex-row items-center justify-between rounded-xl border border-border/40 bg-card/80 px-4 py-4 shadow-sm md:col-span-2">
              <div className="space-y-0.5 max-w-[80%]">
                <Label className="text-base font-medium">
                  Live Data Sync
                </Label>
                <p className="text-xs text-muted-foreground">
                  Habilita o deshabilita la actualización automática de eventos, equipos y usuarios en la interfaz. Cuando está desactivado, podrás refrescar manualmente.
                </p>
              </div>
              {mounted && (
                <Switch
                  checked={isLiveSyncEnabled}
                  onCheckedChange={toggleLiveSync}
                  className="data-[state=checked]:bg-green-500"
                />
              )}
            </div>
          </div>
        </CardContent>
      </Card>

      <Card className="rounded-xl border border-border/60 bg-card/80 shadow-xl backdrop-blur-xl">
        <CardHeader className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <CardTitle className="flex items-center gap-2 text-lg font-semibold text-foreground">
              <Server className="h-4 w-4 text-sky-500" />
              API y automatización
            </CardTitle>
            <CardDescription>
              Gestiona acceso al API REST y los comandos remotos del agente.
            </CardDescription>
          </div>
          <Badge
            variant="outline"
            className="rounded-full border-border/40 bg-muted/30 text-xs text-muted-foreground"
          >
            Integraciones
          </Badge>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="grid gap-4 md:grid-cols-2">
            <div className="rounded-xl border border-border/40 bg-card/80 px-4 py-3 shadow-sm md:col-span-2">
              <Label className="text-xs font-semibold uppercase tracking-[0.22em] text-muted-foreground">
                Startup Network Delay (segundos)
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
                Tiempo de espera en el arranque para parches de bypass de red.
              </p>
            </div>
          </div>
          <Button
            className="rounded-full"
            onClick={() => saveSettings("API y automatización", { startup_network_delay: api.startupNetworkDelay })}
          >
            Guardar cambios
          </Button>
        </CardContent>
      </Card>


      <Card className="rounded-xl border border-border/60 bg-card/80 shadow-xl backdrop-blur-xl">
        <CardHeader>
          <div>
            <CardTitle className="flex items-center gap-2 text-lg font-semibold text-foreground">
              <KeyRound className="h-4 w-4 text-green-500" />
              Desbloqueo por contraseña
            </CardTitle>
            <CardDescription>
              Interruptores del flujo 2FA de los USB y de la detección de
              agentes por silencio.
            </CardDescription>
          </div>
        </CardHeader>
        <CardContent className="space-y-5">
          <div className="flex items-center justify-between gap-4">
            <div>
              <Label>Desbloqueo por contraseña activo</Label>
              <p className="text-xs text-muted-foreground">
                Si se apaga, ningún USB se libera con contraseña: queda
                bloqueado como si no estuviera en la lista blanca.
              </p>
            </div>
            <Switch
              checked={unlock.passwordUnlockEnabled}
              onCheckedChange={(v) => setUnlock({ ...unlock, passwordUnlockEnabled: v })}
            />
          </div>
          <div className="flex items-center justify-between gap-4">
            <div>
              <Label>Emergencia sin red</Label>
              <p className="text-xs text-muted-foreground">
                Permite desbloquear con la contraseña verificada contra el
                hash guardado en la propia PC cuando no hay conexión.
              </p>
            </div>
            <Switch
              checked={unlock.offlineEmergencyEnabled}
              onCheckedChange={(v) => setUnlock({ ...unlock, offlineEmergencyEnabled: v })}
            />
          </div>
          <div className="flex items-center justify-between gap-4">
            <div>
              <Label>Exigir token por equipo</Label>
              <p className="text-xs text-muted-foreground">
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
          <div className="flex items-center justify-between gap-4">
            <div>
              <Label>Bloquear la sesión al conectar un USB</Label>
              <p className="text-xs text-muted-foreground">
                Además de bloquear el dispositivo, cierra la sesión de
                Windows hasta que se desbloquee. Desactivado por defecto.
              </p>
            </div>
            <Switch
              checked={unlock.lockSessionOnInsert}
              onCheckedChange={(v) => setUnlock({ ...unlock, lockSessionOnInsert: v })}
            />
          </div>
          <div>
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
          <Button
            className="rounded-full"
            onClick={() => saveSettings("Desbloqueo por contraseña", { ...unlock })}
          >
            Guardar cambios
          </Button>
        </CardContent>
      </Card>

      <Card className="md:col-span-1 2xl:col-span-2 rounded-xl border border-border/60 bg-card/80 shadow-xl backdrop-blur-xl">
        <CardHeader className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <CardTitle className="flex items-center gap-2 text-lg font-semibold text-foreground">
              <LayoutTemplate className="h-4 w-4 text-emerald-500" />
              Interfaz y Navegación
            </CardTitle>
            <CardDescription>
              Personaliza la experiencia visual y los componentes del dashboard.
            </CardDescription>
          </div>
          <Badge
            variant="outline"
            className="rounded-full border-border/40 bg-muted/30 text-xs text-muted-foreground"
          >
            Visual UI
          </Badge>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="grid gap-4 md:grid-cols-2">
            <div className="rounded-xl border border-border/40 bg-card/80 px-4 py-3 shadow-sm">
              <Label className="text-xs font-semibold uppercase tracking-[0.22em] text-muted-foreground">
                Estilo de Paginación
              </Label>
              <Select
                value={style}
                onValueChange={(value) => setStyle(value as PaginationStyle)}
              >
                <SelectTrigger className="mt-2">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="floating">Dinámica (Flotante)</SelectItem>
                  <SelectItem value="static">Estática (En línea)</SelectItem>
                </SelectContent>
              </Select>
              <p className="mt-2 text-xs text-muted-foreground">
                El modo flotante te permite mantener la paginación a la vista en
                cualquier momento. Puedes arrastrar la barra flotante
                manteniendo presionado el clic por 3 segundos.
              </p>
            </div>

            <div className="flex flex-col justify-center rounded-xl border border-border/40 bg-card/80 px-4 py-4 shadow-sm md:items-center">
              <div className="text-center">
                <Label className="block text-xs font-semibold uppercase tracking-[0.22em] text-muted-foreground">
                  Posición del Paginado
                </Label>
                <p className="mt-1 text-xs text-muted-foreground">
                  Restaura la ubicación flotante por defecto al centro inferior.
                </p>
                <Button
                  variant="outline"
                  size="sm"
                  className="mt-4 rounded-full"
                  onClick={() => {
                    setPosition(null);
                    toast({
                      title: "Posición restaurada",
                      description:
                        "La paginación flotante volvió a su posición central por defecto.",
                    });
                  }}
                  disabled={style === "static"}
                >
                  <RotateCcw className="mr-2 h-3.5 w-3.5" />
                  Restaurar posición
                </Button>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
