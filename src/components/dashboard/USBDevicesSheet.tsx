"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { motion } from "framer-motion";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Spinner } from "@/components/ui/spinner";
import { cn } from "@/lib/utils";
import {
  Usb,
  RefreshCw,
  ShieldCheck,
  AlertTriangle,
  HardDrive,
  Smartphone,
  Disc3,
  Network,
  Printer,
} from "lucide-react";
import {
  type Computer,
  type ConnectedUSBDevice,
  type DisconnectedUSBDevice,
  type HistoryRange,
  formatDateTime,
  formatTime,
  formatDuration,
} from "./types";
import { useUsbHistoryRange } from "@/hooks/useUsbHistoryRange";
import { formatBytes, etiquetaTipoDispositivo } from "@/app/user/utils";
import { useAmbientScrollbar } from "@/hooks/useAmbientScrollbar";

interface Props {
  computer: Computer | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

function IconoTipo({ kind, className }: { kind?: string; className?: string }) {
  const cls = className ?? "h-5 w-5";
  switch ((kind || "").toUpperCase()) {
    case "TELEFONO":
      return <Smartphone className={cls} />;
    case "OPTICO":
      return <Disc3 className={cls} />;
    case "RED":
      return <Network className={cls} />;
    case "IMPRESORA":
      return <Printer className={cls} />;
    case "DISCO":
      return <HardDrive className={cls} />;
    default:
      return <Usb className={cls} />;
  }
}

function EstadoListaBlanca({ dentro }: { dentro: boolean }) {
  return dentro ? (
    <span className="smallcaps inline-flex items-center gap-1 text-success">
      <ShieldCheck className="h-3.5 w-3.5" />
      En lista blanca
    </span>
  ) : (
    <span className="smallcaps inline-flex items-center gap-1 text-amber-700 dark:text-amber-400">
      <AlertTriangle className="h-3.5 w-3.5" />
      Fuera de la lista
    </span>
  );
}

function Dato({ etiqueta, children }: { etiqueta: string; children: ReactNode }) {
  return (
    <div>
      <span className="smallcaps block text-muted-foreground/70">{etiqueta}</span>
      <span className="mt-0.5 block truncate">{children}</span>
    </div>
  );
}

export function USBDevicesSheet({ computer, open, onOpenChange }: Props) {
  const [historyRange, setHistoryRange] = useUsbHistoryRange();
  const [tab, setTab] = useState<"connected" | "history">("connected");
  const [loadingConnected, setLoadingConnected] = useState(false);
  const [loadingHistory, setLoadingHistory] = useState(false);
  const [errorConnected, setErrorConnected] = useState<string | null>(null);
  const [errorHistory, setErrorHistory] = useState<string | null>(null);
  const [connected, setConnected] = useState<ConnectedUSBDevice[]>([]);
  const [history, setHistory] = useState<DisconnectedUSBDevice[]>([]);
  const [isRefreshing, setIsRefreshing] = useState(false);

  const abortRef = useRef<AbortController | null>(null);
  const { containerProps, scrollbarClassName } = useAmbientScrollbar({
    timeout: 700,
  });

  const canFetch = Boolean(computer?.id);

  const fetchDevices = useCallback(
    async (type: "connected" | "history", signal?: AbortSignal) => {
      if (!canFetch) return;
      const isHistory = type === "history";
      try {
        if (isHistory) setLoadingHistory(true);
        else setLoadingConnected(true);
        if (isHistory) setErrorHistory(null);
        else setErrorConnected(null);
        const res = await fetch(
          `/api/computers/${encodeURIComponent(
            computer!.id
          )}/usb-devices?type=${type}&historyDays=${historyRange}`,
          {
            cache: "no-store",
            credentials: "include",
            signal,
          }
        );
        const data = await res.json().catch(() => null);
        if (!res.ok || !data?.ok) {
          throw new Error(data?.error || `Error HTTP ${res.status}`);
        }
        if (isHistory) setHistory(data.items as DisconnectedUSBDevice[]);
        else setConnected(data.items as ConnectedUSBDevice[]);
      } catch (err: any) {
        if (err?.name === "AbortError") return;
        const msg = err?.message || "No se pudo obtener información";
        if (type === "history") setErrorHistory(msg);
        else setErrorConnected(msg);
      } finally {
        if (type === "history") setLoadingHistory(false);
        else setLoadingConnected(false);
      }
    },
    [canFetch, computer, historyRange]
  );

  const handleRefresh = useCallback(async () => {
    if (!canFetch) return;
    setIsRefreshing(true);
    try {
      const signal = abortRef.current?.signal;
      await Promise.all([
        fetchDevices("connected", signal),
        fetchDevices("history", signal),
      ]);
    } finally {
      setIsRefreshing(false);
    }
  }, [canFetch, fetchDevices]);

  useEffect(() => {
    if (!open) return;
    const controller = new AbortController();
    abortRef.current = controller;
    // Diferida a una microtarea: los setState de la carga ocurren
    // en un contexto asíncrono, no en el cuerpo síncrono del efecto.
    queueMicrotask(() => {
      if (controller.signal.aborted) return;
      void Promise.all([
        fetchDevices("connected", controller.signal),
        fetchDevices("history", controller.signal),
      ]);
    });
    return () => controller.abort();
  }, [open, fetchDevices]);

  useEffect(() => {
    if (!open) return;
    const signal = abortRef.current?.signal;
    // Diferido a una microtarea: los setState de la carga ocurren
    // en un contexto asíncrono, no en el cuerpo síncrono del efecto.
    queueMicrotask(() => {
      void fetchDevices("history", signal);
    });
  }, [historyRange, open, fetchDevices]);

  const headerSubtitle = useMemo(() => {
    if (!computer) return "";
    const service = computer.serviceRunning
      ? "Servicio en ejecución"
      : "Sin señal del servicio";
    return `${computer.ipAddress} · ${service}`;
  }, [computer]);

  return (
    <Sheet open={open} onOpenChange={onOpenChange} modal>
      <SheetContent
        side="bottom"
        className={cn(
          "mx-auto h-[80vh] w-full max-w-3xl rounded-t-2xl border-t px-0",
          "border-border bg-background shadow-xl",
          "sm:left-1/2 sm:right-auto sm:-translate-x-1/2"
        )}
      >
        <Tabs
          value={tab}
          onValueChange={(v) => setTab(v as typeof tab)}
          className="flex h-full flex-col"
        >
          <SheetHeader className="border-b border-border px-6 pb-0 pt-6">
            <SheetTitle className="font-display text-[1.35rem] font-bold text-foreground">
              Dispositivos USB — {computer?.name ?? ""}
            </SheetTitle>
            <SheetDescription className="text-muted-foreground">
              {headerSubtitle}
            </SheetDescription>
            <div className="mt-3 flex items-end justify-between gap-2">
              <TabsList className="h-auto rounded-none bg-transparent p-0">
                <TabsTrigger
                  value="connected"
                  className="smallcaps rounded-none border-b-2 border-transparent px-3 py-2 shadow-none data-[state=active]:border-primary data-[state=active]:bg-transparent data-[state=active]:text-foreground data-[state=active]:shadow-none"
                >
                  Conectados
                </TabsTrigger>
                <TabsTrigger
                  value="history"
                  className="smallcaps rounded-none border-b-2 border-transparent px-3 py-2 shadow-none data-[state=active]:border-primary data-[state=active]:bg-transparent data-[state=active]:text-foreground data-[state=active]:shadow-none"
                >
                  Historial
                </TabsTrigger>
              </TabsList>
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="mb-1.5 rounded-full"
                onClick={handleRefresh}
                disabled={isRefreshing || loadingConnected || loadingHistory}
              >
                {isRefreshing ? (
                  <span className="mr-2 inline-flex">
                    <Spinner size={14} />
                  </span>
                ) : (
                  <RefreshCw className="mr-2 h-3.5 w-3.5" />
                )}
                {isRefreshing ? "Actualizando" : "Actualizar"}
              </Button>
            </div>
          </SheetHeader>

          <div className="flex-1 px-6">
            <TabsContent value="connected" className="h-full">
              {errorConnected ? (
                <Alert className="mt-4 rounded-lg border-destructive/40 bg-destructive/5 text-destructive">
                  <AlertDescription>{errorConnected}</AlertDescription>
                </Alert>
              ) : (
                <ScrollArea
                  className={cn("h-full pr-2", scrollbarClassName)}
                  {...containerProps}
                >
                  {loadingConnected ? (
                    <div className="flex h-64 items-center justify-center">
                      <Spinner />
                    </div>
                  ) : connected.length === 0 ? (
                    <p className="py-12 text-center text-sm text-muted-foreground">
                      No hay dispositivos conectados actualmente.
                    </p>
                  ) : (
                    <div>
                      {connected.map((d, index) => (
                        <motion.article
                          key={d.id}
                          initial={{ opacity: 0, y: 6 }}
                          animate={{ opacity: 1, y: 0 }}
                          transition={{
                            duration: 0.35,
                            delay: index * 0.05,
                            ease: [0.22, 1, 0.36, 1],
                          }}
                          className="border-b border-border/70 py-4 last:border-b-0"
                        >
                          <div className="flex items-baseline justify-between gap-3">
                            <p className="flex min-w-0 items-center gap-2.5">
                              <span className="translate-y-0.5 text-muted-foreground">
                                <IconoTipo kind={d.deviceKind} className="h-5 w-5" />
                              </span>
                              <span className="truncate font-display text-[1.05rem] font-bold">
                                {d.volumeName}
                              </span>
                            </p>
                            <EstadoListaBlanca dentro={d.isWhitelisted} />
                          </div>
                          <div className="mt-2.5 grid grid-cols-2 gap-x-4 gap-y-2 text-xs text-muted-foreground sm:grid-cols-4">
                            <Dato etiqueta="Unidad">
                              {d.driveLetter ?? "Sin letra"}
                              {etiquetaTipoDispositivo(d.deviceKind)
                                ? ` · ${etiquetaTipoDispositivo(d.deviceKind)}`
                                : ""}
                            </Dato>
                            <Dato etiqueta="Serie">
                              <span className="font-mono">{d.serialNumber}</span>
                            </Dato>
                            <Dato etiqueta="Modelo">{d.model}</Dato>
                            <Dato etiqueta="Tamaño">
                              {d.size > 0 ? formatBytes(d.size) : "—"}
                            </Dato>
                            <Dato etiqueta="Visto por última vez">
                              {formatTime(d.lastSeen)}
                            </Dato>
                          </div>
                        </motion.article>
                      ))}
                    </div>
                  )}
                </ScrollArea>
              )}
            </TabsContent>

            <TabsContent value="history" className="h-full">
              <div className="flex items-center justify-between gap-2 py-3">
                <span className="smallcaps text-muted-foreground">
                  Rango de historial
                </span>
                <div className="flex items-center gap-1">
                  {[1, 7, 30].map((opt) => (
                    <Button
                      key={opt}
                      type="button"
                      size="sm"
                      variant={opt === historyRange ? "default" : "outline"}
                      className={cn(
                        "h-7 rounded-full px-3 text-xs",
                        opt === historyRange
                          ? "bg-foreground text-background"
                          : ""
                      )}
                      onClick={() => setHistoryRange(opt as HistoryRange)}
                    >
                      {opt === 1 ? "24 h" : `${opt} días`}
                    </Button>
                  ))}
                </div>
              </div>

              {errorHistory ? (
                <Alert className="rounded-lg border-destructive/40 bg-destructive/5 text-destructive">
                  <AlertDescription>{errorHistory}</AlertDescription>
                </Alert>
              ) : (
                <ScrollArea
                  className={cn("h-[calc(100%-44px)] pr-2", scrollbarClassName)}
                  {...containerProps}
                >
                  {loadingHistory ? (
                    <div className="flex h-64 items-center justify-center">
                      <Spinner />
                    </div>
                  ) : history.length === 0 ? (
                    <p className="py-12 text-center text-sm text-muted-foreground">
                      No hay registros en el rango seleccionado.
                    </p>
                  ) : (
                    <div>
                      {history.map((d, index) => (
                        <motion.article
                          key={d.id}
                          initial={{ opacity: 0, y: 6 }}
                          animate={{ opacity: 1, y: 0 }}
                          transition={{
                            duration: 0.35,
                            delay: index * 0.05,
                            ease: [0.22, 1, 0.36, 1],
                          }}
                          className="border-b border-border/70 py-4 last:border-b-0"
                        >
                          <div className="flex items-baseline justify-between gap-3">
                            <p className="flex min-w-0 items-center gap-2.5">
                              <span className="translate-y-0.5 text-muted-foreground">
                                <IconoTipo kind={d.deviceKind} className="h-5 w-5" />
                              </span>
                              <span className="truncate font-display text-[1.05rem] font-bold">
                                {d.volumeName}
                              </span>
                            </p>
                            <EstadoListaBlanca dentro={d.isWhitelisted} />
                          </div>
                          <div className="mt-2.5 grid grid-cols-2 gap-x-4 gap-y-2 text-xs text-muted-foreground sm:grid-cols-4">
                            <Dato etiqueta="Unidad">
                              {d.driveLetter ?? "Sin letra"}
                              {etiquetaTipoDispositivo(d.deviceKind)
                                ? ` · ${etiquetaTipoDispositivo(d.deviceKind)}`
                                : ""}
                            </Dato>
                            <Dato etiqueta="Serie">
                              <span className="font-mono">{d.serialNumber}</span>
                            </Dato>
                            <Dato etiqueta="Modelo">{d.model}</Dato>
                            <Dato etiqueta="Tamaño">
                              {d.size > 0 ? formatBytes(d.size) : "—"}
                            </Dato>
                            <Dato etiqueta="Conectado">
                              {formatDateTime(d.connectedAt)}
                            </Dato>
                            <Dato etiqueta="Desconectado">
                              {d.disconnectedAt
                                ? formatDateTime(d.disconnectedAt)
                                : "—"}
                            </Dato>
                            {d.disconnectedAt && (
                              <Dato etiqueta="Duración">
                                {formatDuration(d.connectedAt, d.disconnectedAt)}
                              </Dato>
                            )}
                          </div>
                        </motion.article>
                      ))}
                    </div>
                  )}
                </ScrollArea>
              )}
            </TabsContent>
          </div>
        </Tabs>
      </SheetContent>
    </Sheet>
  );
}
