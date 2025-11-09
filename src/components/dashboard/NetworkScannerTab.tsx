"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { motion } from "framer-motion";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  AlertTriangle,
  CloudCog,
  Loader2,
  Play,
  Power,
  Radar,
  ScanLine,
  Sparkles,
  Square,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";

interface ScanResult {
  ip: string;
  alive: boolean;
  serviceInstalled?: boolean;
  serviceRunning?: boolean;
  lastServiceCheck?: string | null;
  healthStatus?: string;
  hostname?: string;
  latencyMs?: number;
  serviceVersion?: string;
  uptimeSeconds?: number;
  pendingUnlocks?: number;
  lastServiceHeartbeat?: string | null;
  error?: string;
}

interface Props {
  onRefreshComputers: () => void;
}

const ipToNumber = (ip: string): number => {
  return ip
    .split(".")
    .map((segment) => Number(segment) & 0xff)
    .reduce((acc, segment) => (acc << 8) + segment, 0);
};

const normalizeDate = (value: unknown): string | null => {
  if (!value) return null;
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value.toISOString();
  }
  if (typeof value === "string" || typeof value === "number") {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date.toISOString();
  }
  return null;
};

const normalizeNumber = (value: unknown): number | undefined => {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return undefined;
};

const formatTime = (value?: string | null) => {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleTimeString("es-ES", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
};

const formatTimestamp = (value?: string | null) => {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleString("es-ES", {
    hour12: false,
  });
};

const formatUptime = (seconds?: number) => {
  if (
    typeof seconds !== "number" ||
    !Number.isFinite(seconds) ||
    seconds <= 0
  ) {
    return "—";
  }
  const totalSeconds = Math.floor(seconds);
  const days = Math.floor(totalSeconds / 86400);
  const hours = Math.floor((totalSeconds % 86400) / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);

  if (days > 0) {
    return `${days}d ${hours}h`;
  }
  if (hours > 0) {
    return `${hours}h ${minutes}m`;
  }
  return `${minutes}m`;
};

const isServiceResponding = (result: ScanResult) => {
  if (result.serviceRunning) return true;
  if (!result.healthStatus) return false;
  const normalized = result.healthStatus.toLowerCase();
  if (normalized.startsWith("200")) return true;
  if (normalized.startsWith("ok")) return true;
  if (normalized.includes("ok")) return true;
  return false;
};

const healthVariantFor = (
  result: ScanResult
): "success" | "secondary" | "destructive" | "default" => {
  const label = (result.healthStatus || "").toLowerCase();
  if (
    result.serviceRunning &&
    (label.startsWith("200") || label.startsWith("ok"))
  ) {
    return "success";
  }
  if (
    label.includes("error") ||
    label.startsWith("4") ||
    label.startsWith("5")
  ) {
    return "destructive";
  }
  if (result.alive) {
    return "default";
  }
  return "secondary";
};

const versionLabelFor = (version?: string) => {
  if (!version) return "Sin versión";
  const trimmed = version.trim();
  if (!trimmed) return "Sin versión";
  return trimmed.toLowerCase().startsWith("v") ? trimmed : `v${trimmed}`;
};

const normalizeResult = (item: any): ScanResult => {
  const latency = normalizeNumber(item?.latencyMs);
  const uptime = normalizeNumber(item?.uptimeSeconds);
  const pending = normalizeNumber(item?.pendingUnlocks);

  return {
    ip: String(item?.ip || ""),
    alive: Boolean(item?.alive),
    serviceInstalled: Boolean(item?.serviceInstalled),
    serviceRunning: Boolean(item?.serviceRunning),
    lastServiceCheck: normalizeDate(item?.lastServiceCheck),
    healthStatus: item?.healthStatus ? String(item.healthStatus) : undefined,
    hostname: item?.hostname ? String(item.hostname) : undefined,
    latencyMs: typeof latency === "number" ? latency : undefined,
    serviceVersion:
      typeof item?.serviceVersion === "string" && item.serviceVersion.trim()
        ? String(item.serviceVersion)
        : undefined,
    uptimeSeconds: typeof uptime === "number" ? Math.max(0, uptime) : undefined,
    pendingUnlocks:
      typeof pending === "number"
        ? Math.max(0, Math.round(pending))
        : undefined,
    lastServiceHeartbeat: normalizeDate(item?.lastServiceHeartbeat),
    error: item?.error ? String(item.error) : undefined,
  };
};

function HealthBadge({ result }: { result: ScanResult }) {
  const label =
    result.healthStatus || (result.alive ? "Sin respuesta" : "Offline");
  const variant = healthVariantFor(result);

  return (
    <div className="flex flex-col gap-1">
      <Badge
        variant={variant}
        className={cn(
          "rounded-full px-3 py-1 text-[0.65rem] font-semibold uppercase tracking-[0.2em] shadow-sm",
          variant === "success" &&
            "border border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-400/40 dark:bg-emerald-500/15 dark:text-emerald-100",
          variant === "destructive" &&
            "border border-rose-200 bg-rose-50 text-rose-700 dark:border-rose-400/40 dark:bg-rose-500/15 dark:text-rose-100",
          variant === "default" &&
            "border border-sky-200 bg-sky-50 text-sky-700 dark:border-sky-400/40 dark:bg-sky-500/15 dark:text-sky-100",
          variant === "secondary" &&
            "border border-slate-200 bg-slate-100 text-slate-700 dark:border-white/10 dark:bg-white/10 dark:text-white"
        )}
      >
        {label}
      </Badge>
      {typeof result.latencyMs === "number" && (
        <span className="text-[10px] text-slate-500 dark:text-slate-400">
          {result.latencyMs.toFixed(0)} ms
        </span>
      )}
      {result.error && (
        <span className="text-[10px] text-rose-500 dark:text-rose-300">
          {result.error}
        </span>
      )}
    </div>
  );
}

export function NetworkScannerTab({ onRefreshComputers }: Props) {
  const [scanning, setScanning] = useState(false);
  const [scanResults, setScanResults] = useState<ScanResult[]>([]);
  const [scanError, setScanError] = useState<string | null>(null);
  const [serviceActionMsg, setServiceActionMsg] = useState<string | null>(null);
  const [lastScanAt, setLastScanAt] = useState<string | null>(null);
  const { toast } = useToast();

  const triggerScan = useCallback(
    async ({ silent, force }: { silent?: boolean; force?: boolean } = {}) => {
      const showToast = !silent;
      try {
        setScanning(true);
        setScanError(null);
        const payload: Record<string, unknown> = { force: force ?? true };
        const res = await fetch("/api/network-scan", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });

        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          const message = data?.error || `Error HTTP ${res.status}`;
          throw new Error(message);
        }

        const normalized = Array.isArray(data?.results)
          ? (data.results as unknown[])
              .map(normalizeResult)
              .sort((a, b) => ipToNumber(a.ip) - ipToNumber(b.ip))
          : [];

        setScanResults(normalized);
        setLastScanAt(new Date().toISOString());
        onRefreshComputers();

        if (showToast) {
          toast({
            title: "Escaneo completado",
            description: `${normalized.length} host${
              normalized.length === 1 ? "" : "s"
            } analizado${normalized.length === 1 ? "" : "s"}.`,
          });
        }
      } catch (error: any) {
        const message = error?.message || "No se pudo completar el escaneo";
        setScanError(message);
        if (!silent) {
          toast({
            title: "Error al escanear",
            description: message,
            variant: "destructive",
          });
        }
      } finally {
        setScanning(false);
      }
    },
    [onRefreshComputers, toast]
  );

  useEffect(() => {
    triggerScan({ silent: true, force: false }).catch(() => {
      /* handled in triggerScan */
    });
  }, [triggerScan]);

  const sortedResults = useMemo(() => {
    return [...scanResults].sort((a, b) => ipToNumber(a.ip) - ipToNumber(b.ip));
  }, [scanResults]);

  const summary = useMemo(() => {
    let alive = 0;
    let running = 0;
    let responding = 0;
    let pending = 0;

    for (const result of sortedResults) {
      if (result.alive) alive += 1;
      if (result.serviceRunning) running += 1;
      if (isServiceResponding(result)) responding += 1;
      if (typeof result.pendingUnlocks === "number") {
        pending += result.pendingUnlocks;
      }
    }

    return {
      total: sortedResults.length,
      alive,
      running,
      responding,
      pending,
    };
  }, [sortedResults]);

  const quickStats = useMemo(
    () => [
      {
        label: "Hosts vivos",
        value: scanning ? "Escaneando" : summary.alive.toString(),
        accent: "from-emerald-400/25 via-emerald-300/10",
      },
      {
        label: "Servicio OK",
        value: scanning ? "--" : summary.responding.toString(),
        accent: "from-sky-400/25 via-cyan-300/10",
      },
      {
        label: "Pendientes",
        value: scanning ? "--" : summary.pending.toString(),
        accent: "from-amber-400/25 via-amber-300/10",
      },
    ],
    [scanning, summary.alive, summary.pending, summary.responding]
  );

  const callServiceAction = useCallback(
    async (ip: string, action: "install" | "uninstall" | "start" | "stop") => {
      try {
        setServiceActionMsg(`${action.toUpperCase()} ${ip} ...`);
        const res = await fetch(`/api/service/${action}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ip }),
        });
        const data = await res.json().catch(() => ({}));

        const success = data?.success === true;
        const message = data?.message || (success ? "OK" : "FALLÓ");
        setServiceActionMsg(`${action.toUpperCase()} => ${message}`);

        toast({
          title: `Acción ${action} ${success ? "ejecutada" : "falló"}`,
          description:
            data?.message ||
            (success
              ? `${ip} respondió correctamente`
              : "Revisa los registros del agente"),
          variant: success ? "default" : "destructive",
        });
      } catch (error: any) {
        const message =
          error?.message || "No fue posible contactar al servicio";
        setServiceActionMsg(`Error: ${message}`);
        toast({
          title: `Acción ${action} falló`,
          description: message,
          variant: "destructive",
        });
      } finally {
        triggerScan({ silent: true }).catch(() => {
          /* handled */
        });
      }
    },
    [toast, triggerScan]
  );

  return (
    <motion.section
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35, ease: "easeOut" }}
    >
      <Card className="relative overflow-hidden rounded-3xl border border-slate-200/70 bg-white/85 text-slate-900 shadow-xl supports-[backdrop-filter]:backdrop-blur-2xl dark:border-white/10 dark:bg-slate-900/50 dark:text-white">
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top_left,_rgba(14,165,233,0.12),transparent_55%),radial-gradient(circle_at_bottom_right,_rgba(99,102,241,0.12),transparent_55%)] dark:bg-[radial-gradient(circle_at_top_left,_rgba(14,165,233,0.18),transparent_45%),radial-gradient(circle_at_bottom_right,_rgba(99,102,241,0.18),transparent_50%)]" />
        <CardHeader className="relative z-10 space-y-6">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
            <div className="flex items-center gap-3">
              <span className="inline-flex size-12 items-center justify-center rounded-2xl border border-sky-200/60 bg-white/80 text-sky-600 shadow-sm dark:border-sky-400/40 dark:bg-white/10 dark:text-sky-200">
                <Radar className="size-5" />
              </span>
              <div>
                <CardTitle className="text-2xl font-semibold text-slate-900 dark:text-slate-100">
                  Escaneo de servicios USB
                </CardTitle>
                <CardDescription className="text-sm text-slate-600 dark:text-slate-300/80">
                  Consulta cada host en la red y valida el endpoint
                  `/service-status`.
                </CardDescription>
                {lastScanAt && (
                  <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                    Último escaneo: {formatTimestamp(lastScanAt)}
                  </p>
                )}
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <span className="inline-flex items-center gap-1 rounded-full border border-white/70 bg-white/80 px-3 py-1 text-xs font-medium text-slate-600 shadow-sm backdrop-blur-sm dark:border-white/10 dark:bg-white/10 dark:text-slate-300/80">
                <Sparkles className="size-3" />
                Insights en vivo
              </span>
              <Button
                variant="outline"
                size="sm"
                disabled={scanning}
                onClick={() => triggerScan()}
                className="border border-white/70 bg-white/80 text-slate-700 shadow-sm transition-colors hover:border-sky-300 hover:text-slate-900 dark:border-white/10 dark:bg-white/10 dark:text-slate-100 dark:hover:border-sky-400/40"
              >
                {scanning ? (
                  <Loader2 className="mr-2 size-4 animate-spin" />
                ) : (
                  <ScanLine className="mr-2 size-4" />
                )}
                {scanning ? "Escaneando..." : "Escanear ahora"}
              </Button>
            </div>
          </div>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {quickStats.map((stat) => (
              <div
                key={stat.label}
                className="relative overflow-hidden rounded-2xl border border-white/70 bg-white/85 p-4 text-slate-700 shadow-md supports-[backdrop-filter]:backdrop-blur-xl dark:border-white/10 dark:bg-white/5 dark:text-slate-200"
              >
                <div
                  className={cn(
                    "pointer-events-none absolute inset-0 rounded-2xl bg-gradient-to-br opacity-70",
                    stat.accent
                  )}
                />
                <div className="relative flex items-center justify-between gap-3">
                  <div>
                    <p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-slate-500 dark:text-slate-400">
                      {stat.label}
                    </p>
                    <p className="mt-2 text-2xl font-semibold tracking-tight text-slate-900 dark:text-white">
                      {stat.value}
                    </p>
                  </div>
                  <span className="inline-flex size-9 items-center justify-center rounded-xl border border-white/60 bg-white/80 text-slate-500 shadow-sm dark:border-white/15 dark:bg-white/10 dark:text-slate-200">
                    {stat.label === "Hosts vivos" ? (
                      <Radar className="size-4" />
                    ) : stat.label === "Servicio OK" ? (
                      <CloudCog className="size-4" />
                    ) : (
                      <Power className="size-4" />
                    )}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </CardHeader>
        <CardContent className="relative z-10 space-y-6">
          {serviceActionMsg && (
            <div className="inline-flex items-center gap-2 rounded-full border border-slate-200/80 bg-slate-100/70 px-3 py-1 text-xs font-medium text-slate-600 shadow-sm backdrop-blur-sm dark:border-white/10 dark:bg-white/5 dark:text-slate-200">
              <CloudCog className="size-3" />
              {serviceActionMsg}
            </div>
          )}
          {scanError && (
            <Alert className="border-rose-200/60 bg-rose-50 text-rose-700 dark:border-rose-300/40 dark:bg-rose-500/10 dark:text-rose-100">
              <AlertTriangle className="h-4 w-4" />
              <AlertDescription>{scanError}</AlertDescription>
            </Alert>
          )}
          {scanning && (
            <div className="flex items-center gap-2 text-xs text-slate-600 dark:text-slate-300/80">
              <Loader2 className="size-4 animate-spin" />
              <span>Consultando servicios en la red...</span>
            </div>
          )}
          <div className="inline-flex items-center gap-2 rounded-full border border-slate-200/80 bg-slate-100/70 px-3 py-1 text-xs font-medium text-slate-600 shadow-sm backdrop-blur-sm dark:border-white/10 dark:bg-white/5 dark:text-slate-300/80">
            <ScanLine className="size-3" />
            Resultados: {sortedResults.length}
          </div>
          <ScrollArea className="max-h-[min(60vh,500px)] pr-3 [--scrollbar-size:0px] [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden">
            <Table className="min-w-full">
              <TableHeader className="sticky top-0 z-10 bg-white/95 backdrop-blur-xl dark:bg-slate-900/80">
                <TableRow className="border-white/60 dark:border-white/10">
                  <TableHead className="text-slate-600 dark:text-slate-200">
                    IP / Host
                  </TableHead>
                  <TableHead className="text-slate-600 dark:text-slate-200">
                    Vivo
                  </TableHead>
                  <TableHead className="text-slate-600 dark:text-slate-200">
                    Servicio
                  </TableHead>
                  <TableHead className="text-slate-600 dark:text-slate-200">
                    Salud
                  </TableHead>
                  <TableHead className="text-slate-600 dark:text-slate-200">
                    Uptime
                  </TableHead>
                  <TableHead className="text-slate-600 dark:text-slate-200">
                    Pulso / Check
                  </TableHead>
                  <TableHead className="text-slate-600 dark:text-slate-200">
                    Pendientes
                  </TableHead>
                  <TableHead className="text-slate-600 dark:text-slate-200">
                    Acciones
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {sortedResults.length > 0 ? (
                  sortedResults.map((result) => (
                    <TableRow
                      key={result.ip}
                      className="group border border-white/70 bg-white/75 transition-all duration-200 hover:-translate-y-0.5 hover:border-sky-300/60 hover:bg-sky-50/60 dark:border-white/5 dark:bg-white/5 dark:hover:border-sky-400/30 dark:hover:bg-sky-500/10"
                    >
                      <TableCell className="font-semibold text-slate-700 dark:text-slate-100">
                        <div className="flex flex-col">
                          <span>{result.ip}</span>
                          {result.hostname && (
                            <span className="text-[10px] uppercase tracking-wide text-slate-500 dark:text-slate-400">
                              {result.hostname}
                            </span>
                          )}
                        </div>
                      </TableCell>
                      <TableCell>
                        <Badge
                          variant={result.alive ? "success" : "secondary"}
                          className={cn(
                            "rounded-full px-3 py-1 text-[0.65rem] font-semibold uppercase tracking-[0.2em] shadow-sm",
                            !result.alive &&
                              "border border-slate-200 bg-slate-100 text-slate-700 dark:border-white/10 dark:bg-white/10 dark:text-white"
                          )}
                        >
                          {result.alive ? "Sí" : "No"}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <div className="flex flex-col gap-1">
                          <Badge
                            variant={
                              result.serviceRunning
                                ? "success"
                                : result.serviceInstalled
                                ? "default"
                                : "secondary"
                            }
                            className={cn(
                              "rounded-full px-3 py-1 text-[0.65rem] font-semibold uppercase tracking-[0.2em] shadow-sm",
                              !result.serviceInstalled &&
                                "border border-slate-200 bg-slate-100 text-slate-700 dark:border-white/10 dark:bg-white/10 dark:text-white"
                            )}
                          >
                            {result.serviceRunning
                              ? "En ejecución"
                              : result.serviceInstalled
                              ? "Instalado"
                              : "No instalado"}
                          </Badge>
                          <span className="text-[10px] text-slate-500 dark:text-slate-400">
                            {versionLabelFor(result.serviceVersion)}
                          </span>
                        </div>
                      </TableCell>
                      <TableCell>
                        <HealthBadge result={result} />
                      </TableCell>
                      <TableCell className="text-xs text-slate-600 dark:text-slate-300/80">
                        {formatUptime(result.uptimeSeconds)}
                      </TableCell>
                      <TableCell className="text-xs text-slate-600 dark:text-slate-300/80">
                        <div className="flex flex-col gap-1">
                          <span>
                            Pulso: {formatTime(result.lastServiceHeartbeat)}
                          </span>
                          <span>
                            Check: {formatTime(result.lastServiceCheck)}
                          </span>
                        </div>
                      </TableCell>
                      <TableCell>
                        {result.pendingUnlocks && result.pendingUnlocks > 0 ? (
                          <Badge
                            variant="destructive"
                            className="rounded-full px-3 py-1 text-[0.65rem] font-semibold uppercase tracking-[0.2em] shadow-sm"
                          >
                            {result.pendingUnlocks}
                          </Badge>
                        ) : (
                          <span className="text-xs text-slate-500 dark:text-slate-300/80">
                            0
                          </span>
                        )}
                      </TableCell>
                      <TableCell>
                        <div className="flex flex-wrap gap-2">
                          <Button
                            variant="outline"
                            size="sm"
                            disabled={!result.alive || scanning}
                            onClick={() =>
                              callServiceAction(result.ip, "install")
                            }
                            className="border border-white/70 bg-white/80 text-slate-700 shadow-sm transition-colors hover:border-sky-300 hover:text-slate-900 disabled:opacity-60 dark:border-white/10 dark:bg-white/10 dark:text-slate-100 dark:hover:border-sky-400/40"
                          >
                            <CloudCog className="mr-1 size-3" /> Instalar
                          </Button>
                          <Button
                            variant="outline"
                            size="sm"
                            disabled={!result.serviceInstalled || scanning}
                            onClick={() =>
                              callServiceAction(result.ip, "uninstall")
                            }
                            className="border border-white/70 bg-white/80 text-slate-700 shadow-sm transition-colors hover:border-rose-300 hover:text-slate-900 disabled:opacity-60 dark:border-white/10 dark:bg-white/10 dark:text-slate-100 dark:hover:border-rose-400/40"
                          >
                            <Square className="mr-1 size-3" /> Desinstalar
                          </Button>
                          <Button
                            variant="outline"
                            size="sm"
                            disabled={
                              !result.serviceInstalled ||
                              result.serviceRunning ||
                              scanning
                            }
                            onClick={() =>
                              callServiceAction(result.ip, "start")
                            }
                            className="border border-white/70 bg-white/80 text-slate-700 shadow-sm transition-colors hover:border-emerald-300 hover:text-slate-900 disabled:opacity-60 dark:border-white/10 dark:bg-white/10 dark:text-slate-100 dark:hover:border-emerald-400/40"
                          >
                            <Play className="mr-1 size-3" /> Iniciar
                          </Button>
                          <Button
                            variant="outline"
                            size="sm"
                            disabled={!result.serviceRunning || scanning}
                            onClick={() => callServiceAction(result.ip, "stop")}
                            className="border border-white/70 bg-white/80 text-slate-700 shadow-sm transition-colors hover:border-amber-300 hover:text-slate-900 disabled:opacity-60 dark:border-white/10 dark:bg-white/10 dark:text-slate-100 dark:hover:border-amber-400/40"
                          >
                            <Power className="mr-1 size-3" /> Detener
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))
                ) : (
                  <TableRow>
                    <TableCell
                      colSpan={8}
                      className="py-6 text-center text-xs text-slate-500 dark:text-slate-300/70"
                    >
                      Sin resultados aún. Ejecuta un escaneo.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </ScrollArea>
        </CardContent>
      </Card>
    </motion.section>
  );
}
