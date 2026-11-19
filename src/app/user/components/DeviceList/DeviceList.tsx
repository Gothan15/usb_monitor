"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Usb, HardDrive } from "lucide-react";
import { Button } from "@/components/ui/button";
import { formatDateTime, getCurrentDate } from "@/lib/time";
import { fetchBasicUserSnapshot, formatBytes, etiquetaTipoDispositivo } from "../../utils";
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
  const [state, setState] = useState<DeviceListState>({
    devices: [],
    computer: null,
    lastUpdated: null,
    warnings: [],
  });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Sin botón de «Actualizar»: el sondeo de 10 s del efecto
  // de abajo mantiene la lista al día por sí solo y reintenta
  // tras un fallo (cada vuelta limpia el error si responde
  // bien). La recuperación inmediata vive en el aviso de
  // error, con su «Reintentar».
  const loadDevices = useCallback(
    async (signal?: AbortSignal) => {
      if (!userId) return;
      try {
        setLoading(true);
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
      } catch (fetchError) {
        const message =
          fetchError instanceof Error
            ? fetchError.message
            : "No se pudieron obtener los dispositivos.";
        setError(message);
      } finally {
        setLoading(false);
      }
    },
    [userId]
  );

  useEffect(() => {
    if (!userId) return;
    const controller = new AbortController();
    // Diferida a una microtarea: los setState de la carga ocurren
    // en un contexto asíncrono, no en el cuerpo síncrono del efecto.
    queueMicrotask(() => {
      if (!controller.signal.aborted) void loadDevices(controller.signal);
    });
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
        <div className="flex min-h-48 flex-1 items-center justify-center">
          <Spinner />
        </div>
      );
    }

    if (error) {
      return (
        <div className="flex flex-wrap items-center justify-between gap-3 border border-[#B3382E]/40 bg-[#B3382E]/[0.06] px-4 py-3 text-sm text-foreground">
          <span>{error}</span>
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() => void loadDevices()}
          >
            Reintentar
          </Button>
        </div>
      );
    }

    if (!state.devices.length) {
      return (
        <div className="flex items-start gap-3 border-t border-border pt-6 text-sm text-muted-foreground">
          <Usb className="mt-0.5 size-4 shrink-0 text-[var(--acero)]" />
          <div>
            <p>No hay dispositivos USB conectados en este momento.</p>
            <p className="mt-1 text-xs">
              Conecta un dispositivo autorizado para verlo aquí.
            </p>
          </div>
        </div>
      );
    }

    return (
      <div className="border-t border-border">
        {state.devices.map((device) => (
          <article
            key={device.id}
            className="flex flex-col gap-3 border-b border-border py-5 md:flex-row md:items-start md:justify-between"
          >
            <div className="flex items-start gap-3">
              <Usb className="mt-1 h-6 w-6 shrink-0 text-[var(--acero)]" />
              <div>
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                  <h3 className="font-display text-lg font-bold leading-none text-foreground">
                    {device.volumeName}
                  </h3>
                  <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
                    <span className="size-1.5 rounded-full bg-[#3FA34D]" />
                    Conectado
                  </span>
                  <span className="text-xs text-muted-foreground">
                    Unidad {device.driveLetter}
                  </span>
                  {etiquetaTipoDispositivo(device.deviceKind) && (
                    <span className="text-xs text-muted-foreground">
                      {etiquetaTipoDispositivo(device.deviceKind)}
                    </span>
                  )}
                </div>
                <p className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-muted-foreground">
                  <span className="flex items-center gap-1.5">
                    <HardDrive className="h-3.5 w-3.5" />
                    {device.model}
                  </span>
                  <span aria-hidden>·</span>
                  <span className="font-mono text-xs uppercase">
                    {device.serialNumber}
                  </span>
                  <span aria-hidden>·</span>
                  <span>{formatBytes(device.size)}</span>
                </p>
              </div>
            </div>
            <div className="flex gap-8 pl-9 md:pl-0 md:text-right">
              <div>
                <p className="smallcaps text-muted-foreground">
                  Conectado desde
                </p>
                <p className="mt-1 text-sm text-foreground">
                  {formatDateTime(device.connectedAt)}
                </p>
              </div>
              <div>
                <p className="smallcaps text-muted-foreground">Última señal</p>
                <p className="mt-1 text-sm text-foreground">
                  {formatDateTime(device.lastSeen)}
                </p>
              </div>
            </div>
          </article>
        ))}
      </div>
    );
  }, [error, loading, loadDevices, state.devices]);

  return (
    <section className="w-full" data-tour="devices-main">
      {/* ── Cabecera, como las del panel de administración ── */}
      <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
        <div className="flex flex-1 flex-col">
          <p className="smallcaps text-acero">Tu equipo</p>
          <h2 className="font-display mt-2 text-2xl font-bold text-foreground">
            Dispositivos conectados
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Los dispositivos USB que tu equipo tiene conectados ahora
            mismo. La lista se actualiza sola cada pocos segundos.
          </p>
        </div>
        {state.lastUpdated && (
          <p className="text-xs text-muted-foreground">
            Actualizado:{" "}
            <span className="font-semibold text-foreground">
              {formatDateTime(state.lastUpdated)}
            </span>
          </p>
        )}
      </div>

      {/* ── Tu equipo asignado, en tira como las del panel ── */}
      {state.computer && (
        <div
          className="mt-8 flex flex-wrap items-center gap-x-12 gap-y-4 border-t border-border pt-5"
          data-tour="user-computer"
        >
          <div>
            <div className="flex items-baseline gap-3">
              <span className="font-display text-[1.55rem] font-bold leading-none text-foreground">
                {state.computer.name}
              </span>
              <span className="smallcaps text-muted-foreground">
                Tu equipo asignado
              </span>
            </div>
            <p className="mt-1.5 text-xs text-muted-foreground">
              IP {state.computer.ipAddress}
            </p>
          </div>
          <p className="flex items-center gap-2 text-sm text-foreground">
            <span
              className={`size-2 rounded-full ${
                state.computer.isActive ? "bg-[#3FA34D]" : "bg-[#B3382E]"
              }`}
            />
            {state.computer.isActive ? "Equipo activo" : "Equipo inactivo"}
          </p>
        </div>
      )}

      {/* ── Avisos del panel para este equipo ── */}
      {state.warnings.length > 0 && (
        <div className="mt-6 space-y-2 border border-[#C09A3B]/50 bg-[#C09A3B]/10 px-4 py-3 text-sm text-foreground">
          {state.warnings.map((warning, index) => (
            <p key={index}>{warning}</p>
          ))}
        </div>
      )}

      {/* ── La lista de dispositivos ── */}
      <div className="mt-8" data-tour="user-devices">
        {content}
      </div>
    </section>
  );
};
