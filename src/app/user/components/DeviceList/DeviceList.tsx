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
          <div className="h-12 w-12 animate-spin rounded-full border-4 border-slate-200 border-t-slate-500" />
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
        <div className="flex h-48 flex-col items-center justify-center gap-2 text-center text-sm text-slate-500 dark:text-slate-300">
          <Usb className="h-10 w-10 text-slate-300 dark:text-slate-600" />
          <span>No hay dispositivos USB conectados en este momento.</span>
          <span className="text-xs text-slate-400 dark:text-slate-500">
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
            className="group animate-in fade-in-50 zoom-in-95 duration-300 rounded-xl border border-slate-200 bg-white p-4 shadow-sm transition-all hover:-translate-y-0.5 hover:shadow-md dark:border-slate-700 dark:bg-slate-900"
            style={{ animationDelay: `${index * 80}ms` }}
          >
            <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
              <div className="flex flex-1 items-start gap-3">
                <div className="rounded-lg bg-slate-100 p-3 text-slate-500 transition-colors group-hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-300">
                  <Usb className="h-6 w-6 text-slate-500 transition-colors group-hover:text-slate-700 dark:text-slate-200" />
                </div>
                <div className="space-y-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <h3 className="text-lg font-semibold text-slate-900 dark:text-slate-100">
                      {device.volumeName}
                    </h3>
                    <Badge className="bg-green-600 text-white shadow-sm">
                      Activo
                    </Badge>
                    <Badge
                      variant="outline"
                      className="border-slate-200 text-xs text-slate-500 dark:border-slate-700 dark:text-slate-300"
                    >
                      {device.driveLetter}
                    </Badge>
                  </div>
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-slate-600 dark:text-slate-300">
                    <span className="flex items-center gap-1 font-medium">
                      <HardDrive className="h-3.5 w-3.5" />
                      {device.model}
                    </span>
                    <span className="text-slate-400">•</span>
                    <span className="font-mono text-xs uppercase">
                      {device.serialNumber}
                    </span>
                    <span className="text-slate-400">•</span>
                    <span className="font-semibold">
                      {formatBytes(device.size)}
                    </span>
                  </div>
                </div>
              </div>
              <div className="flex flex-col gap-2 rounded-lg border border-slate-100 bg-slate-50 p-3 text-sm text-slate-600 transition-colors dark:border-slate-700 dark:bg-slate-800/60 dark:text-slate-300">
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
    <Card className="border-slate-200/80 bg-gradient-to-br from-white via-white to-slate-50 shadow-sm dark:border-slate-800/80 dark:from-slate-950 dark:via-slate-900 dark:to-slate-950">
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle className="flex items-center gap-2 text-lg text-slate-800 dark:text-slate-100">
          <Usb className="h-5 w-5 text-slate-500 dark:text-slate-300" />
          Dispositivos activos
        </CardTitle>
        <div className="flex items-center gap-3 text-xs text-slate-500 dark:text-slate-400">
          {state.lastUpdated && (
            <span className="hidden md:inline">
              Última actualización: {formatDateTime(state.lastUpdated)}
            </span>
          )}
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="inline-flex items-center gap-2 border-slate-200 text-xs font-semibold text-slate-600 transition-colors hover:bg-slate-100 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
            disabled={refreshing}
            onClick={() => loadDevices(undefined, true)}
          >
            <RefreshCw
              className={`h-4 w-4 ${
                refreshing
                  ? "animate-spin text-slate-400"
                  : "text-slate-500 dark:text-slate-300"
              }`}
            />
            {refreshing ? "Actualizando..." : "Actualizar"}
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {state.warnings.length > 0 && (
          <Alert className="border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-500/40 dark:bg-amber-500/10 dark:text-amber-100">
            <AlertDescription className="space-y-2">
              {state.warnings.map((warning, index) => (
                <p key={index}>{warning}</p>
              ))}
            </AlertDescription>
          </Alert>
        )}
        {state.computer && (
          <div className="flex flex-wrap gap-4 rounded-lg border border-slate-100 bg-slate-50/80 p-4 text-sm text-slate-600 shadow-sm transition-colors dark:border-slate-700 dark:bg-slate-800/50 dark:text-slate-300">
            <div className="flex items-center gap-2">
              <HardDrive className="h-4 w-4" />
              <span className="font-semibold text-slate-700 dark:text-slate-100">
                {state.computer.name}
              </span>
            </div>
            <span className="text-slate-300">•</span>
            <div className="flex items-center gap-2">
              <Activity className="h-4 w-4" />
              IP {state.computer.ipAddress}
            </div>
            <span className="text-slate-300">•</span>
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
