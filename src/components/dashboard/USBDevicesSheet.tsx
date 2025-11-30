"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import {
  Usb,
  RefreshCw,
  ShieldCheck,
  AlertTriangle,
  Unplug,
  HardDrive,
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
import { formatBytes } from "@/app/user/utils";
import { useAmbientScrollbar } from "@/hooks/useAmbientScrollbar";

interface Props {
  computer: Computer | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
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
    void Promise.all([
      fetchDevices("connected", controller.signal),
      fetchDevices("history", controller.signal),
    ]);
    return () => controller.abort();
  }, [open, fetchDevices]);

  useEffect(() => {
    if (!open) return;
    const signal = abortRef.current?.signal;
    void fetchDevices("history", signal);
  }, [historyRange, open, fetchDevices]);

  const headerSubtitle = useMemo(() => {
    if (!computer) return "";
    const service = computer.serviceRunning ? "Servicio OK" : "Sin servicio";
    return `${computer.ipAddress} · ${service}`;
  }, [computer]);

  return (
    <Sheet open={open} onOpenChange={onOpenChange} modal>
      <SheetContent
        side="bottom"
        className={cn(
          "mx-auto h-[80vh] w-full max-w-3xl rounded-t-3xl border-t px-0",
          "border-white/10 bg-white/90 shadow-2xl supports-[backdrop-filter]:backdrop-blur-3xl dark:border-white/10 dark:bg-slate-900/80",
          "sm:left-1/2 sm:right-auto sm:-translate-x-1/2"
        )}
      >
        <Tabs
          value={tab}
          onValueChange={(v) => setTab(v as typeof tab)}
          className="flex h-full flex-col"
        >
          <SheetHeader>
            <SheetTitle className="text-slate-900 dark:text-white">
              Dispositivos USB — {computer?.name ?? ""}
            </SheetTitle>
            <SheetDescription className="text-slate-600 dark:text-slate-300/80">
              {headerSubtitle}
            </SheetDescription>
            <div className="flex items-center justify-between gap-2">
              <TabsList className="rounded-2xl border border-white/60 bg-white/80 p-1 shadow-sm dark:border-white/15 dark:bg-white/10">
                <TabsTrigger value="connected">Conectados</TabsTrigger>
                <TabsTrigger value="history">Historial</TabsTrigger>
              </TabsList>
              <Button
                type="button"
                size="sm"
                className="rounded-full border border-emerald-200/60 bg-emerald-500/10 text-emerald-700 shadow-sm transition-all hover:-translate-y-0.5 hover:border-emerald-300 hover:bg-emerald-500/20 dark:border-emerald-400/40 dark:bg-emerald-500/15 dark:text-emerald-100"
                onClick={handleRefresh}
                disabled={isRefreshing || loadingConnected || loadingHistory}
              >
                <motion.span
                  animate={{ rotate: isRefreshing ? 360 : 0 }}
                  transition={{
                    duration: 0.6,
                    ease: "easeInOut",
                    repeat: isRefreshing ? Infinity : 0,
                  }}
                  className="inline-flex"
                >
                  <RefreshCw className="mr-2 h-4 w-4" />
                </motion.span>
                {isRefreshing ? "Actualizando" : "Actualizar"}
              </Button>
            </div>
          </SheetHeader>

          <div className="mt-2 flex-1">
            <TabsContent value="connected" className="h-full">
              {errorConnected ? (
                <Alert className="rounded-2xl border-rose-200/60 bg-rose-50/90 text-rose-700 shadow-sm dark:border-rose-300/40 dark:bg-rose-500/10 dark:text-rose-100">
                  <AlertDescription>{errorConnected}</AlertDescription>
                </Alert>
              ) : (
                <ScrollArea
                  className={cn("h-full pr-2", scrollbarClassName)}
                  {...containerProps}
                >
                  <div className="grid gap-3">
                    {loadingConnected ? (
                      Array.from({ length: 4 }).map((_, i) => (
                        <Skeleton
                          key={i}
                          className="h-20 rounded-2xl bg-slate-100/80 dark:bg-white/10"
                        />
                      ))
                    ) : connected.length === 0 ? (
                      <div className="rounded-2xl border border-white/70 bg-white/80 p-4 text-center text-slate-500 shadow-sm dark:border-white/10 dark:bg-white/5 dark:text-slate-300">
                        No hay dispositivos conectados actualmente.
                      </div>
                    ) : (
                      connected.map((d, index) => (
                        <motion.div
                          key={d.id}
                          whileHover={{ y: -4 }}
                          transition={{ duration: 0.2 }}
                          className="relative overflow-hidden rounded-2xl border border-white/70 bg-white/85 p-4 shadow-lg supports-[backdrop-filter]:backdrop-blur-xl dark:border-white/10 dark:bg-white/5"
                          style={{ animationDelay: `${index * 60}ms` }}
                        >
                          <div className="relative flex items-start gap-3">
                            <span className="inline-flex h-10 w-10 items-center justify-center rounded-xl border border-white/60 bg-white/80 text-slate-500 shadow-sm dark:border-white/15 dark:bg-white/10 dark:text-slate-200">
                              <Usb className="h-5 w-5" />
                            </span>
                            <div className="flex-1">
                              <div className="flex items-center justify-between gap-2">
                                <p className="text-sm font-semibold text-slate-900 dark:text-white">
                                  {d.volumeName}
                                </p>
                                <div className="flex items-center gap-1">
                                  <Badge
                                    variant="secondary"
                                    className="rounded-full border border-white/60 bg-white/80 text-slate-600 dark:border-white/15 dark:bg-white/10 dark:text-slate-200"
                                  >
                                    <HardDrive className="mr-1 h-3.5 w-3.5" />
                                    {d.driveLetter}
                                  </Badge>
                                  {d.isWhitelisted ? (
                                    <Badge
                                      variant="success"
                                      className="rounded-full shadow-sm"
                                    >
                                      <ShieldCheck className="mr-1 h-3.5 w-3.5" />{" "}
                                      Autorizado
                                    </Badge>
                                  ) : (
                                    <Badge
                                      variant="secondary"
                                      className="rounded-full border border-amber-200/60 bg-amber-50/80 text-amber-700 dark:border-amber-400/40 dark:bg-amber-500/15 dark:text-amber-100"
                                    >
                                      <AlertTriangle className="mr-1 h-3.5 w-3.5" />{" "}
                                      Sin autorizar
                                    </Badge>
                                  )}
                                </div>
                              </div>
                              <div className="mt-1 grid grid-cols-2 gap-2 text-xs text-slate-600 dark:text-slate-300">
                                <div>
                                  <span className="font-medium">Serie:</span>{" "}
                                  {d.serialNumber}
                                </div>
                                <div>
                                  <span className="font-medium">Modelo:</span>{" "}
                                  {d.model}
                                </div>
                                <div>
                                  <span className="font-medium">Tamaño:</span>{" "}
                                  {formatBytes(d.size)}
                                </div>
                                <div>
                                  <span className="font-medium">Visto:</span>{" "}
                                  {formatTime(d.lastSeen)}
                                </div>
                              </div>
                            </div>
                          </div>
                        </motion.div>
                      ))
                    )}
                  </div>
                </ScrollArea>
              )}
            </TabsContent>

            <TabsContent value="history" className="h-full">
              <div className="mb-2 flex items-center justify-between gap-2">
                <div className="text-xs text-slate-600 dark:text-slate-300 p-5">
                  Rango de historial
                </div>
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
                          ? "bg-slate-900 text-white dark:bg-white dark:text-slate-900"
                          : ""
                      )}
                      onClick={() => setHistoryRange(opt as HistoryRange)}
                    >
                      {opt === 1 ? "24h" : `${opt}d`}
                    </Button>
                  ))}
                </div>
              </div>

              {errorHistory ? (
                <Alert className="rounded-2xl border-rose-200/60 bg-rose-50/90 text-rose-700 shadow-sm dark:border-rose-300/40 dark:bg-rose-500/10 dark:text-rose-100">
                  <AlertDescription>{errorHistory}</AlertDescription>
                </Alert>
              ) : (
                <ScrollArea
                  className={cn("h-[calc(100%-32px)] pr-2", scrollbarClassName)}
                  {...containerProps}
                >
                  <div className="grid gap-3">
                    {loadingHistory ? (
                      Array.from({ length: 4 }).map((_, i) => (
                        <Skeleton
                          key={i}
                          className="h-20 rounded-2xl bg-slate-100/80 dark:bg-white/10"
                        />
                      ))
                    ) : history.length === 0 ? (
                      <div className="rounded-2xl border border-white/70 bg-white/80 p-4 text-center text-slate-500 shadow-sm dark:border-white/10 dark:bg-white/5 dark:text-slate-300">
                        No hay registros en el rango seleccionado.
                      </div>
                    ) : (
                      history.map((d, index) => (
                        <motion.div
                          key={d.id}
                          whileHover={{ y: -4 }}
                          transition={{ duration: 0.2 }}
                          className="relative overflow-hidden rounded-2xl border border-white/70 bg-white/85 p-4 shadow-lg supports-[backdrop-filter]:backdrop-blur-xl dark:border-white/10 dark:bg-white/5"
                          style={{ animationDelay: `${index * 60}ms` }}
                        >
                          <div className="relative flex items-start gap-3">
                            <span className="inline-flex h-10 w-10 items-center justify-center rounded-xl border border-white/60 bg-white/80 text-rose-600 shadow-sm dark:border-white/15 dark:bg-white/10 dark:text-rose-200">
                              <Unplug className="h-5 w-5" />
                            </span>
                            <div className="flex-1">
                              <div className="flex items-center justify-between gap-2">
                                <p className="text-sm font-semibold text-slate-900 dark:text-white">
                                  {d.volumeName}
                                </p>
                                <div className="flex items-center gap-1">
                                  <Badge
                                    variant="secondary"
                                    className="rounded-full border border-white/60 bg-white/80 text-slate-600 dark:border-white/15 dark:bg-white/10 dark:text-slate-200"
                                  >
                                    <HardDrive className="mr-1 h-3.5 w-3.5" />
                                    {d.driveLetter}
                                  </Badge>
                                  {d.isWhitelisted ? (
                                    <Badge
                                      variant="success"
                                      className="rounded-full shadow-sm"
                                    >
                                      <ShieldCheck className="mr-1 h-3.5 w-3.5" />{" "}
                                      Autorizado
                                    </Badge>
                                  ) : (
                                    <Badge
                                      variant="secondary"
                                      className="rounded-full border border-amber-200/60 bg-amber-50/80 text-amber-700 dark:border-amber-400/40 dark:bg-amber-500/15 dark:text-amber-100"
                                    >
                                      <AlertTriangle className="mr-1 h-3.5 w-3.5" />{" "}
                                      Sin autorizar
                                    </Badge>
                                  )}
                                </div>
                              </div>
                              <div className="mt-1 grid grid-cols-2 gap-2 text-xs text-slate-600 dark:text-slate-300">
                                <div>
                                  <span className="font-medium">Serie:</span>{" "}
                                  {d.serialNumber}
                                </div>
                                <div>
                                  <span className="font-medium">Modelo:</span>{" "}
                                  {d.model}
                                </div>
                                <div>
                                  <span className="font-medium">Tamaño:</span>{" "}
                                  {formatBytes(d.size)}
                                </div>
                                <div>
                                  <span className="font-medium">
                                    Conectado:
                                  </span>{" "}
                                  {formatDateTime(d.connectedAt)}
                                </div>
                                <div>
                                  <span className="font-medium">
                                    Desconectado:
                                  </span>{" "}
                                  {d.disconnectedAt
                                    ? formatDateTime(d.disconnectedAt)
                                    : "—"}
                                </div>
                                {d.disconnectedAt && (
                                  <div>
                                    <span className="font-medium">
                                      Duración:
                                    </span>{" "}
                                    {formatDuration(
                                      d.connectedAt,
                                      d.disconnectedAt
                                    )}
                                  </div>
                                )}
                              </div>
                            </div>
                          </div>
                        </motion.div>
                      ))
                    )}
                  </div>
                </ScrollArea>
              )}
            </TabsContent>
          </div>
        </Tabs>
      </SheetContent>
    </Sheet>
  );
}
