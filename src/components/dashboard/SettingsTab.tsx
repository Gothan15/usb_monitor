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
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
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
  ShieldCheck,
  Wrench,
  Server,
  FileText,
  LayoutTemplate,
  RotateCcw,
} from "lucide-react";
import {
  usePaginationSettings,
  PaginationStyle,
} from "@/hooks/usePaginationSettings";

interface AuthenticationSettings {
  enforceMfa: boolean;
  sessionDuration: string;
  lockoutThreshold: number;
  notifyOnNewDevice: boolean;
}

interface ApiSettings {
  baseUrl: string;
  rateLimit: string;
  websocketEnabled: boolean;
  allowRemoteInstall: boolean;
  startupNetworkDelay: number;
}

interface LoggingSettings {
  retentionDays: number;
  forwardSyslog: boolean;
  syslogAddress: string;
  maskPii: boolean;
}

interface PolicySettings {
  autoQuarantine: boolean;
  unlockDuration: string;
  approvalsRequired: number;
  escalationEmail: string;
}

export function SettingsTab() {
  const { toast } = useToast();
  const [auth, setAuth] = useState<AuthenticationSettings>({
    enforceMfa: true,
    sessionDuration: "12",
    lockoutThreshold: 5,
    notifyOnNewDevice: true,
  });
  const [api, setApi] = useState<ApiSettings>({
    baseUrl: "https://api.secure-usb.local",
    rateLimit: "60",
    websocketEnabled: true,
    allowRemoteInstall: false,
    startupNetworkDelay: 15,
  });
  const [logging, setLogging] = useState<LoggingSettings>({
    retentionDays: 90,
    forwardSyslog: false,
    syslogAddress: "",
    maskPii: true,
  });
  const [policy, setPolicy] = useState<PolicySettings>({
    autoQuarantine: true,
    unlockDuration: "30",
    approvalsRequired: 2,
    escalationEmail: "seguridad@empresa.com",
  });

  const { style, setStyle, setPosition } = usePaginationSettings();

  useEffect(() => {
    fetch("/api/settings")
      .then((res) => res.json())
      .then((data) => {
        if (data.startup_network_delay !== undefined) {
          setApi((prev) => ({
            ...prev,
            startupNetworkDelay: data.startup_network_delay,
          }));
        }
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
              <ShieldCheck className="h-4 w-4 text-[oklch(0.55_0.12_160)]" />
              Autenticación y acceso
            </CardTitle>
            <CardDescription>
              Refuerza el ingreso al panel administrativo y notifica usos
              anómalos.
            </CardDescription>
          </div>
          <Badge
            variant="outline"
            className="rounded-full border-border/40 bg-muted/30 text-xs text-muted-foreground"
          >
            Sesión segura
          </Badge>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="grid gap-4 md:grid-cols-2">
            <div className="flex items-center justify-between rounded-xl border border-border/40 bg-card/80 px-4 py-3 shadow-sm">
              <div>
                <Label className="text-xs font-semibold uppercase tracking-[0.22em] text-muted-foreground">
                  MFA obligatorio
                </Label>
                <p className="text-sm text-muted-foreground">
                  Solicitar segundo factor en cada inicio.
                </p>
              </div>
              <Switch
                checked={auth.enforceMfa}
                onCheckedChange={(enforceMfa) =>
                  setAuth((prev) => ({ ...prev, enforceMfa }))
                }
              />
            </div>
            <div className="rounded-xl border border-border/40 bg-card/80 px-4 py-3 shadow-sm">
              <Label className="text-xs font-semibold uppercase tracking-[0.22em] text-muted-foreground">
                Duración de sesión (h)
              </Label>
              <Select
                value={auth.sessionDuration}
                onValueChange={(value) =>
                  setAuth((prev) => ({ ...prev, sessionDuration: value }))
                }
              >
                <SelectTrigger className="mt-2">
                  <SelectValue placeholder="Selecciona" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="4">4 horas</SelectItem>
                  <SelectItem value="8">8 horas</SelectItem>
                  <SelectItem value="12">12 horas</SelectItem>
                  <SelectItem value="24">24 horas</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="rounded-xl border border-border/40 bg-card/80 px-4 py-3 shadow-sm">
              <Label className="text-xs font-semibold uppercase tracking-[0.22em] text-muted-foreground">
                Intentos antes de bloqueo
              </Label>
              <Input
                type="number"
                min={1}
                value={auth.lockoutThreshold}
                onChange={(event) =>
                  setAuth((prev) => ({
                    ...prev,
                    lockoutThreshold: Number(event.target.value) || 1,
                  }))
                }
                className="mt-2"
              />
            </div>
            <div className="flex items-center justify-between rounded-xl border border-border/40 bg-card/80 px-4 py-3 shadow-sm">
              <div>
                <Label className="text-xs font-semibold uppercase tracking-[0.22em] text-muted-foreground">
                  Alertas de nuevos dispositivos
                </Label>
                <p className="text-sm text-muted-foreground">
                  Enviar correo cuando un usuario solicita acceso.
                </p>
              </div>
              <Switch
                checked={auth.notifyOnNewDevice}
                onCheckedChange={(notifyOnNewDevice) =>
                  setAuth((prev) => ({ ...prev, notifyOnNewDevice }))
                }
              />
            </div>
          </div>
          <Button
            className="rounded-full"
            onClick={() => showSavedToast("Autenticación")}
          >
            Guardar cambios
          </Button>
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
                URL base del API
              </Label>
              <Input
                value={api.baseUrl}
                onChange={(event) =>
                  setApi((prev) => ({ ...prev, baseUrl: event.target.value }))
                }
                className="mt-2"
                placeholder="https://"
              />
            </div>
            <div className="rounded-xl border border-border/40 bg-card/80 px-4 py-3 shadow-sm">
              <Label className="text-xs font-semibold uppercase tracking-[0.22em] text-muted-foreground">
                Límite de peticiones (min)
              </Label>
              <Input
                value={api.rateLimit}
                onChange={(event) =>
                  setApi((prev) => ({ ...prev, rateLimit: event.target.value }))
                }
                className="mt-2"
              />
            </div>
            <div className="flex items-center justify-between rounded-xl border border-border/40 bg-card/80 px-4 py-3 shadow-sm">
              <div>
                <Label className="text-xs font-semibold uppercase tracking-[0.22em] text-muted-foreground">
                  WebSockets activos
                </Label>
                <p className="text-sm text-muted-foreground">
                  Permite métricas en tiempo real.
                </p>
              </div>
              <Switch
                checked={api.websocketEnabled}
                onCheckedChange={(websocketEnabled) =>
                  setApi((prev) => ({ ...prev, websocketEnabled }))
                }
              />
            </div>
            <div className="flex items-center justify-between rounded-xl border border-border/40 bg-card/80 px-4 py-3 shadow-sm md:col-span-2">
              <div>
                <Label className="text-xs font-semibold uppercase tracking-[0.22em] text-muted-foreground">
                  Permitir instalación remota
                </Label>
                <p className="text-sm text-muted-foreground">
                  Autoriza despliegue automatizado del servicio.
                </p>
              </div>
              <Switch
                checked={api.allowRemoteInstall}
                onCheckedChange={(allowRemoteInstall) =>
                  setApi((prev) => ({ ...prev, allowRemoteInstall }))
                }
              />
            </div>
            <div className="rounded-xl border border-border/40 bg-card/80 px-4 py-3 shadow-sm md:col-span-2">
              <Label className="text-xs font-semibold uppercase tracking-[0.22em] text-muted-foreground">
                Startup Network Delay (segundos)
              </Label>
              <Input
                type="number"
                min={0}
                value={api.startupNetworkDelay}
                onChange={(event) =>
                  setApi((prev) => ({ ...prev, startupNetworkDelay: Number(event.target.value) || 0 }))
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
        <CardHeader className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <CardTitle className="flex items-center gap-2 text-lg font-semibold text-foreground">
              <FileText className="h-4 w-4 text-muted-foreground" />
              Registro y evidencias
            </CardTitle>
            <CardDescription>
              Define retención y reenvío de logs para auditorías regulatorias.
            </CardDescription>
          </div>
          <Badge
            variant="outline"
            className="rounded-full border-border/40 bg-muted/30 text-xs text-muted-foreground"
          >
            Compliance
          </Badge>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="grid gap-4 md:grid-cols-2">
            <div className="rounded-xl border border-border/40 bg-card/80 px-4 py-3 shadow-sm">
              <Label className="text-xs font-semibold uppercase tracking-[0.22em] text-muted-foreground">
                Retención (días)
              </Label>
              <Input
                type="number"
                min={7}
                value={logging.retentionDays}
                onChange={(event) =>
                  setLogging((prev) => ({
                    ...prev,
                    retentionDays: Number(event.target.value) || 7,
                  }))
                }
                className="mt-2"
              />
            </div>
            <div className="flex items-center justify-between rounded-xl border border-border/40 bg-card/80 px-4 py-3 shadow-sm">
              <div>
                <Label className="text-xs font-semibold uppercase tracking-[0.22em] text-muted-foreground">
                  Enviar a Syslog
                </Label>
                <p className="text-sm text-muted-foreground">
                  Replica eventos críticos en tu SIEM.
                </p>
              </div>
              <Switch
                checked={logging.forwardSyslog}
                onCheckedChange={(forwardSyslog) =>
                  setLogging((prev) => ({ ...prev, forwardSyslog }))
                }
              />
            </div>
            <div className="rounded-xl border border-border/40 bg-card/80 px-4 py-3 shadow-sm md:col-span-2">
              <Label className="text-xs font-semibold uppercase tracking-[0.22em] text-muted-foreground">
                Servidor Syslog
              </Label>
              <Input
                value={logging.syslogAddress}
                onChange={(event) =>
                  setLogging((prev) => ({
                    ...prev,
                    syslogAddress: event.target.value,
                  }))
                }
                className="mt-2"
                placeholder="udp://10.0.0.10:514"
                disabled={!logging.forwardSyslog}
              />
            </div>
            <div className="flex items-center justify-between rounded-xl border border-border/40 bg-card/80 px-4 py-3 shadow-sm md:col-span-2">
              <div>
                <Label className="text-xs font-semibold uppercase tracking-[0.22em] text-muted-foreground">
                  Enmascarar datos sensibles
                </Label>
                <p className="text-sm text-muted-foreground">
                  Oculta PII en exportaciones y reportes automáticos.
                </p>
              </div>
              <Switch
                checked={logging.maskPii}
                onCheckedChange={(maskPii) =>
                  setLogging((prev) => ({ ...prev, maskPii }))
                }
              />
            </div>
          </div>
          <Button
            className="rounded-full"
            onClick={() => showSavedToast("Registro y evidencias")}
          >
            Guardar cambios
          </Button>
        </CardContent>
      </Card>

      <Card className="rounded-xl border border-border/60 bg-card/80 shadow-xl backdrop-blur-xl">
        <CardHeader className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <CardTitle className="flex items-center gap-2 text-lg font-semibold text-foreground">
              <Wrench className="h-4 w-4 text-[oklch(0.60_0.12_85)]" />
              Políticas operativas
            </CardTitle>
            <CardDescription>
              Ajusta las reglas de cuarentena automática y solicitudes
              temporales.
            </CardDescription>
          </div>
          <Badge
            variant="outline"
            className="rounded-full border-border/40 bg-muted/30 text-xs text-muted-foreground"
          >
            Control central
          </Badge>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="grid gap-4 md:grid-cols-2">
            <div className="flex items-center justify-between rounded-xl border border-border/40 bg-card/80 px-4 py-3 shadow-sm">
              <div>
                <Label className="text-xs font-semibold uppercase tracking-[0.22em] text-muted-foreground">
                  Cuarentena automática
                </Label>
                <p className="text-sm text-muted-foreground">
                  Bloquea dispositivos no listados inmediatamente.
                </p>
              </div>
              <Switch
                checked={policy.autoQuarantine}
                onCheckedChange={(autoQuarantine) =>
                  setPolicy((prev) => ({ ...prev, autoQuarantine }))
                }
              />
            </div>
            <div className="rounded-xl border border-border/40 bg-card/80 px-4 py-3 shadow-sm">
              <Label className="text-xs font-semibold uppercase tracking-[0.22em] text-muted-foreground">
                Duración desbloqueo (min)
              </Label>
              <Input
                value={policy.unlockDuration}
                onChange={(event) =>
                  setPolicy((prev) => ({
                    ...prev,
                    unlockDuration: event.target.value,
                  }))
                }
                className="mt-2"
              />
            </div>
            <div className="rounded-xl border border-border/40 bg-card/80 px-4 py-3 shadow-sm">
              <Label className="text-xs font-semibold uppercase tracking-[0.22em] text-muted-foreground">
                Aprobaciones requeridas
              </Label>
              <Select
                value={policy.approvalsRequired.toString()}
                onValueChange={(value) =>
                  setPolicy((prev) => ({
                    ...prev,
                    approvalsRequired: Number(value),
                  }))
                }
              >
                <SelectTrigger className="mt-2">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="1">1 aprobación</SelectItem>
                  <SelectItem value="2">2 aprobaciones</SelectItem>
                  <SelectItem value="3">3 aprobaciones</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="rounded-xl border border-border/40 bg-card/80 px-4 py-3 shadow-sm md:col-span-2">
              <Label className="text-xs font-semibold uppercase tracking-[0.22em] text-muted-foreground">
                Escalar incidentes a
              </Label>
              <Input
                type="email"
                value={policy.escalationEmail}
                onChange={(event) =>
                  setPolicy((prev) => ({
                    ...prev,
                    escalationEmail: event.target.value,
                  }))
                }
                className="mt-2"
              />
              <Textarea
                className="mt-3"
                rows={3}
                placeholder="Notas para los analistas al escalar un incidente"
              />
            </div>
          </div>
          <Button
            className="rounded-full"
            onClick={() => showSavedToast("Políticas operativas")}
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
