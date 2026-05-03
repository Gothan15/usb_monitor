"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { RefreshCw, Usb, HardDrive, Activity, Calendar } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { useToast } from "@/hooks/use-toast";
import { formatDateTime, getCurrentDate } from "@/lib/time";
import { fetchBasicUserSnapshot, formatBytes } from "../../utils";
import type { AssignedComputer, UsbConnection } from "../../types";
import { Spinner } from "@/components/ui/spinner";

interface DeviceListProps {
  userId: string;
}

interface DeviceListState {
  devices: UsbConnection[];
  computer: AssignedComputer | null;
  lastUpdated: Date | null;
  warnings: string[];
}

export const DeviceList = ({ userId }: DeviceListProps) => {
  const { toast } = useToast();
  const [state, setState] = useState<DeviceListState>({
    devices: [],
    computer: null,
    lastUpdated: null,
    warnings: [],
  });
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadDevices = useCallback(
    async (signal?: AbortSignal, manual = false) => {
      if (!userId) return;
      try {
        if (manual) {
          setRefreshing(true);
        } else {
          setLoading(true);
        }
        setError(null);
        const snapshot = await fetchBasicUserSnapshot(userId, signal);
        const connected = snapshot.connectedUSBs.filter(
          (device) => device.isConnected
        );
        setState({
          devices: connected,
          computer: snapshot.computer,
          lastUpdated: getCurrentDate(),
          warnings: snapshot.warnings ?? [],
        });
        if (manual) {
          toast({
            title: "Dispositivos actualizados",
            description: connected.length
              ? `Se detectaron ${connected.length} dispositivo(s) activo(s).`
              : "No hay dispositivos USB activos.",
          });
        }
      } catch (fetchError) {
        const message =
          fetchError instanceof Error
            ? fetchError.message
            : "No se pudieron obtener los dispositivos.";
        setError(message);
        if (manual) {
          toast({
            title: "Error al actualizar",
            description: message,
            variant: "destructive",
          });
        }
      } finally {
        if (manual) {
          setRefreshing(false);
        } else {
          setLoading(false);
        }
      }
    },
    [toast, userId]
  );

  useEffect(() => {
    if (!userId) return;
    const controller = new AbortController();
    loadDevices(controller.signal);
    const interval = setInterval(() => {
      const nextController = new AbortController();
      loadDevices(nextController.signal).catch(() => {});
    }, 10000);
    return () => {
      controller.abort();
      clearInterval(interval);
    };
  }, [loadDevices, userId]);

  const content = useMemo(() => {
    if (loading) {
      return (
        <div className="flex h-48 items-center justify-center">
          <Spinner />
        </div>
      );
    }

    if (error) {
      return (
        <Alert className="border-red-200 bg-red-50 text-red-900 dark:border-red-700 dark:bg-red-950/20 dark:text-red-100">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      );
    }

    if (!state.devices.length) {
      return (
        <div className="flex h-48 flex-col items-center justify-center gap-2 text-center text-sm text-muted-foreground">
          <Usb className="h-10 w-10 text-muted-foreground/40" />
          <span>No hay dispositivos USB conectados en este momento.</span>
          <span className="text-xs text-muted-foreground/60">
            Conecta un dispositivo autorizado para verlo aquí.
          </span>
        </div>
      );
    }

    return (
      <div className="grid gap-3">
        {state.devices.map((device, index) => (
          <div
            key={device.id}
            className="group animate-in fade-in-50 zoom-in-95 duration-300 rounded-xl border border-border/40 bg-card/80 p-4 shadow-sm transition-all hover:-translate-y-0.5 hover:shadow-md backdrop-blur-sm"
            style={{ animationDelay: `${index * 80}ms` }}
          >
            <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
              <div className="flex flex-1 items-start gap-3">
                <div className="rounded-lg bg-muted/40 p-3 text-muted-foreground transition-colors group-hover:bg-muted/60">
                  <Usb className="h-6 w-6 text-muted-foreground transition-colors group-hover:text-foreground" />
                </div>
                <div className="space-y-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <h3 className="text-lg font-semibold text-foreground">
                      {device.volumeName}
                    </h3>
                    <Badge className="bg-green-600 text-white shadow-sm">
                      Activo
                    </Badge>
                    <Badge
                      variant="outline"
                      className="border-border/40 text-xs text-muted-foreground"
                    >
                      {device.driveLetter}
                    </Badge>
                  </div>
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted-foreground">
                    <span className="flex items-center gap-1 font-medium">
                      <HardDrive className="h-3.5 w-3.5" />
                      {device.model}
                    </span>
                    <span className="text-muted-foreground/50">•</span>
                    <span className="font-mono text-xs uppercase">
                      {device.serialNumber}
                    </span>
                    <span className="text-muted-foreground/50">•</span>
                    <span className="font-semibold">
                      {formatBytes(device.size)}
                    </span>
                  </div>
                </div>
              </div>
              <div className="flex flex-col gap-2 rounded-lg border border-border/40 bg-muted/30 p-3 text-sm text-muted-foreground transition-colors">
                <span className="flex items-center gap-2">
                  <Activity className="h-4 w-4" />
                  Último ping: {formatDateTime(device.lastSeen)}
                </span>
                <span className="flex items-center gap-2">
                  <Calendar className="h-4 w-4" />
                  Conectado desde: {formatDateTime(device.connectedAt)}
                </span>
              </div>
            </div>
          </div>
        ))}
      </div>
    );
  }, [error, loading, state.devices]);

  return (
    <Card className="border-border/60 bg-card/80 shadow-sm backdrop-blur-xl">
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle className="flex items-center gap-2 text-lg text-foreground">
          <Usb className="h-5 w-5 text-muted-foreground" />
          Dispositivos activos
        </CardTitle>
        <div className="flex items-center gap-3 text-xs text-slate-500 dark:text-muted-foreground/50">
          {state.lastUpdated && (
            <span className="hidden md:inline">
              Última actualización: {formatDateTime(state.lastUpdated)}
            </span>
          )}
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="inline-flex items-center gap-2 border-border/60 text-xs font-semibold text-muted-foreground transition-colors hover:bg-muted/50"
            disabled={refreshing}
            onClick={() => loadDevices(undefined, true)}
          >
            {refreshing ? (
              <div className="mr-2">
                <Spinner size={16} />
              </div>
            ) : (
              <RefreshCw className="mr-2 h-4 w-4 text-muted-foreground" />
            )}
            {refreshing ? "Actualizando..." : "Actualizar"}
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {state.warnings.length > 0 && (
          <Alert className="border-[oklch(0.80_0.10_85/0.40)] bg-[oklch(0.95_0.03_85)] text-[oklch(0.45_0.10_85)] dark:border-[oklch(0.65_0.08_85/0.30)] dark:bg-[oklch(0.80_0.10_85/0.10)] dark:text-[oklch(0.90_0.04_85)]">
            <AlertDescription className="space-y-2">
              {state.warnings.map((warning, index) => (
                <p key={index}>{warning}</p>
              ))}
            </AlertDescription>
          </Alert>
        )}
        {state.computer && (
          <div className="flex flex-wrap gap-4 rounded-lg border border-border/40 bg-muted/30 p-4 text-sm text-muted-foreground shadow-sm transition-colors">
            <div className="flex items-center gap-2">
              <HardDrive className="h-4 w-4" />
              <span className="font-semibold text-foreground">
                {state.computer.name}
              </span>
            </div>
            <span className="text-muted-foreground/40">•</span>
            <div className="flex items-center gap-2">
              <Activity className="h-4 w-4" />
              IP {state.computer.ipAddress}
            </div>
            <span className="text-muted-foreground/40">•</span>
            <div className="flex items-center gap-2">
              <Badge
                variant="outline"
                className={`border ${
                  state.computer.isActive
                    ? "border-green-600/50 text-green-700 dark:border-green-500/60 dark:text-green-300"
                    : "border-red-600/50 text-red-700 dark:border-red-500/60 dark:text-red-300"
                }`}
              >
                {state.computer.isActive ? "Equipo activo" : "Equipo inactivo"}
              </Badge>
            </div>
          </div>
        )}
        {content}
      </CardContent>
    </Card>
  );
};
