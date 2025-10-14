"use client";
import { useEffect, useRef, useState } from "react";
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
  Power,
  Play,
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
}

interface Props {
  onRefreshComputers: () => void;
}

export function NetworkScannerTab({ onRefreshComputers }: Props) {
  const [scanning, setScanning] = useState(false);
  const [scanResults, setScanResults] = useState<ScanResult[] | null>(null);
  const [scanError, setScanError] = useState<string | null>(null);
  const [serviceActionMsg, setServiceActionMsg] = useState<string | null>(null);
  const [scanJobId, setScanJobId] = useState<string | null>(null);
  const [scanProgress, setScanProgress] = useState<number>(0);
  const asyncCompletionNotified = useRef(false);
  const { toast } = useToast();

  const triggerScan = async ({ silent }: { silent?: boolean } = {}) => {
    const showToast = !silent;
    try {
      setScanning(true);
      setScanError(null);
      if (showToast) {
        setScanResults(null);
      }
      const res = await fetch("/api/network-scan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      if (!res.ok) throw new Error("Error HTTP " + res.status);
      const data = await res.json();
      setScanResults(data.results || []);
      onRefreshComputers();
      if (showToast) {
        const total = (data.results || []).length;
        toast({
          title: "Escaneo completado",
          description: `${total} host${total === 1 ? "" : "s"} analizado${
            total === 1 ? "" : "s"
          }.`,
        });
      }
    } catch (e: any) {
      setScanError(e.message);
      if (showToast) {
        toast({
          title: "Error al escanear",
          description: e.message || "No se pudo completar el escaneo",
          variant: "destructive",
        });
      }
    } finally {
      setScanning(false);
    }
  };

  const startAsyncScan = async () => {
    try {
      setScanning(true);
      setScanError(null);
      setScanResults(null);
      setScanProgress(0);
      setScanJobId(null);
      const res = await fetch("/api/network-scan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ async: true }),
      });
      if (!res.ok) throw new Error("Error iniciando escaneo");
      const data = await res.json();
      setScanJobId(data.jobId);
      setScanProgress(data.progress || 0);
      asyncCompletionNotified.current = false;
      toast({
        title: "Escaneo asíncrono iniciado",
        description: "Monitoreando el progreso cada segundo.",
      });
    } catch (e: any) {
      setScanError(e.message);
      setScanning(false);
      toast({
        title: "No se pudo iniciar el escaneo",
        description: e.message || "Intenta nuevamente más tarde",
        variant: "destructive",
      });
    }
  };

  useEffect(() => {
    if (!scanJobId) return;
    asyncCompletionNotified.current = false;
    const interval = setInterval(async () => {
      try {
        const res = await fetch(`/api/network-scan?jobId=${scanJobId}`);
        if (!res.ok) return;
        const data = await res.json();
        setScanProgress(data.progress || 0);
        if (data.results) setScanResults(data.results);
        if (data.status === "finished" || data.status === "error") {
          setScanning(false);
          clearInterval(interval);
          onRefreshComputers();
          if (!asyncCompletionNotified.current) {
            asyncCompletionNotified.current = true;
            if (data.status === "finished") {
              const total = (data.results || []).length;
              toast({
                title: "Escaneo completado",
                description: `${total} host${total === 1 ? "" : "s"} analizado${
                  total === 1 ? "" : "s"
                }.`,
              });
            } else {
              toast({
                title: "Escaneo fallido",
                description:
                  data.error || "Hubo un problema al completar el escaneo.",
                variant: "destructive",
              });
            }
          }
        }
      } catch {
        /* ignore */
      }
    }, 1000);
    return () => clearInterval(interval);
  }, [scanJobId, onRefreshComputers, toast]);

  const callServiceAction = async (ip: string, action: string) => {
    try {
      setServiceActionMsg(`${action.toUpperCase()} ${ip} ...`);
      const res = await fetch(`/api/service/${action}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ip }),
      });
      const data = await res.json();
      setServiceActionMsg(
        `${action.toUpperCase()} => ${
          data.message || (data.success ? "OK" : "FALLÓ")
        }`
      );
      if (data.success) {
        toast({
          title: `Acción ${action} ejecutada`,
          description: data.message || `${ip} respondió correctamente`,
        });
      } else {
        toast({
          title: `Acción ${action} falló`,
          description: data.message || "Revisa los registros del agente",
          variant: "destructive",
        });
      }
      await triggerScan({ silent: true });
    } catch (e: any) {
      setServiceActionMsg("Error: " + e.message);
      toast({
        title: `Acción ${action} falló`,
        description: e.message || "No fue posible contactar al servicio",
        variant: "destructive",
      });
    }
  };

  const renderHealthBadge = (result: ScanResult) => {
    const statusLabel = result.healthStatus
      ? result.healthStatus
      : result.serviceRunning
      ? "200 OK"
      : "Sin respuesta";

    const normalized = statusLabel.toLowerCase();
    const firstChar = statusLabel.trim().charAt(0);
    let variant: "success" | "secondary" | "destructive" | "default" =
      "secondary";

    if (result.serviceRunning || statusLabel.startsWith("200")) {
      variant = "success";
    } else if (
      normalized.includes("error") ||
      firstChar === "4" ||
      firstChar === "5"
    ) {
      variant = "destructive";
    } else if (statusLabel.trim() !== "Sin respuesta") {
      variant = "default";
    }

    return (
      <div className="flex flex-col gap-1">
        <Badge
          variant={variant}
          className={cn(
            "shadow-sm",
            variant === "secondary" &&
              "border border-slate-200 bg-slate-100 text-slate-700 dark:border-white/10 dark:bg-white/10 dark:text-white"
          )}
        >
          {statusLabel}
        </Badge>
        {typeof result.latencyMs === "number" && (
          <span className="text-[10px] text-slate-500 dark:text-muted-foreground">
            {result.latencyMs.toFixed(0)} ms
          </span>
        )}
      </div>
    );
  };

  return (
    <Card className="border border-slate-200/80 bg-white/90 text-slate-900 shadow-lg supports-[backdrop-filter]:backdrop-blur-xl dark:border-white/10 dark:bg-slate-900/50 dark:text-white">
      <CardHeader className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex items-center gap-3">
          <span className="inline-flex size-9 items-center justify-center rounded-full border border-sky-200/60 bg-sky-50/90 text-sky-600 shadow-sm dark:border-sky-400/40 dark:bg-sky-500/10 dark:text-sky-200">
            <Radar className="size-4" />
          </span>
          <div>
            <CardTitle className="text-lg font-semibold text-slate-900 dark:text-slate-100">
              Escaneo de red
            </CardTitle>
            <CardDescription className="text-slate-600 dark:text-slate-300/80">
              Descubre hosts activos, estado del agente y tiempos de respuesta
            </CardDescription>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span className="inline-flex items-center gap-1 rounded-full border border-slate-200/80 bg-slate-100/70 px-3 py-1 text-xs font-medium text-slate-600 shadow-sm backdrop-blur-sm dark:border-white/10 dark:bg-white/5 dark:text-slate-300/80">
            <Sparkles className="size-3" />
            Insights en vivo
          </span>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              disabled={scanning}
              onClick={() => triggerScan()}
              className="border border-slate-200/80 bg-white/85 text-slate-700 shadow-sm transition-colors hover:border-sky-300 hover:text-slate-900 dark:border-white/10 dark:bg-white/5 dark:text-slate-100 dark:hover:border-white/30"
            >
              <ScanLine className="mr-2 size-4" />
              {scanning ? "Escaneando..." : "Escanear /24"}
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={scanning}
              onClick={() => startAsyncScan()}
              className="border border-slate-200/80 bg-gradient-to-r from-sky-200/70 via-indigo-200/70 to-purple-200/70 text-slate-700 shadow-sm transition-colors hover:border-indigo-300 hover:text-slate-900 dark:border-white/10 dark:from-sky-500/20 dark:via-indigo-500/20 dark:to-purple-500/20 dark:text-slate-100 dark:hover:border-white/30"
            >
              <CloudCog className="mr-2 size-4" />
              {scanning && scanJobId ? "Async..." : "Async"}
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        {scanError && (
          <Alert className="mb-4 border-rose-200/60 bg-rose-50 text-rose-700 dark:border-rose-300/40 dark:bg-rose-500/10 dark:text-rose-100">
            <AlertTriangle className="h-4 w-4" />
            <AlertDescription>{scanError}</AlertDescription>
          </Alert>
        )}
        {serviceActionMsg && (
          <div className="mb-2 inline-flex items-center gap-2 rounded-full border border-slate-200/80 bg-slate-100/70 px-3 py-1 text-xs font-medium text-slate-600 shadow-sm backdrop-blur-sm dark:border-white/10 dark:bg-white/5 dark:text-slate-200">
            <CloudCog className="size-3" />
            {serviceActionMsg}
          </div>
        )}
        {scanning && (
          <div className="mb-4 space-y-2">
            <div className="flex items-center justify-between text-xs text-slate-600 dark:text-slate-300/80">
              <span>Progreso</span>
              <span>{(scanProgress * 100).toFixed(1)}%</span>
            </div>
            <div className="h-2 w-full overflow-hidden rounded-full bg-slate-200/70 dark:bg-white/10">
              <div
                className="h-full bg-gradient-to-r from-sky-400 via-indigo-400 to-purple-400 transition-all duration-300 dark:from-sky-400 dark:via-indigo-400 dark:to-purple-400"
                style={{ width: `${(scanProgress * 100).toFixed(1)}%` }}
              />
            </div>
          </div>
        )}
        <div className="mb-3 inline-flex items-center gap-2 rounded-full border border-slate-200/80 bg-slate-100/70 px-3 py-1 text-xs font-medium text-slate-600 shadow-sm backdrop-blur-sm dark:border-white/10 dark:bg-white/5 dark:text-slate-300/80">
          <ScanLine className="size-3" />
          Resultados: {scanResults ? scanResults.length : 0}
        </div>
        <ScrollArea className="h-[420px] pr-2">
          <Table className="min-w-full">
            <TableHeader className="sticky top-0 z-10 bg-white/95 backdrop-blur-lg dark:bg-slate-900/80">
              <TableRow className="border-slate-200/80 dark:border-white/10">
                <TableHead className="text-slate-600 dark:text-slate-200">
                  IP
                </TableHead>
                <TableHead className="text-slate-600 dark:text-slate-200">
                  Vivo
                </TableHead>
                <TableHead className="text-slate-600 dark:text-slate-200">
                  Servicio inst.
                </TableHead>
                <TableHead className="text-slate-600 dark:text-slate-200">
                  Servicio activo
                </TableHead>
                <TableHead className="text-slate-600 dark:text-slate-200">
                  Health
                </TableHead>
                <TableHead className="text-slate-600 dark:text-slate-200">
                  Última verif.
                </TableHead>
                <TableHead className="text-slate-600 dark:text-slate-200">
                  Acciones
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {scanResults && scanResults.length > 0 ? (
                scanResults.map((r) => (
                  <TableRow
                    key={r.ip}
                    className="group border border-slate-100/70 transition-all duration-200 hover:translate-x-[1px] hover:border-sky-300/60 dark:border-white/5 dark:hover:border-sky-400/30"
                  >
                    <TableCell className="font-medium text-slate-700 dark:text-slate-100">
                      <div className="flex flex-col">
                        <span>{r.ip}</span>
                        {r.hostname && (
                          <span className="text-[10px] uppercase tracking-wide text-slate-500 dark:text-slate-400">
                            {r.hostname}
                          </span>
                        )}
                      </div>
                    </TableCell>
                    <TableCell>
                      <Badge
                        variant={r.alive ? "success" : "secondary"}
                        className={cn(
                          "shadow-sm",
                          !r.alive &&
                            "border border-slate-200 bg-slate-100 text-slate-700 dark:border-white/10 dark:bg-white/10 dark:text-white"
                        )}
                      >
                        {r.alive ? "Sí" : "No"}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <Badge
                        variant={r.serviceInstalled ? "success" : "secondary"}
                        className={cn(
                          "shadow-sm",
                          !r.serviceInstalled &&
                            "border border-slate-200 bg-slate-100 text-slate-700 dark:border-white/10 dark:bg-white/10 dark:text-white"
                        )}
                      >
                        {r.serviceInstalled ? "Sí" : "No"}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <Badge
                        variant={r.serviceRunning ? "success" : "secondary"}
                        className={cn(
                          "shadow-sm",
                          !r.serviceRunning &&
                            "border border-slate-200 bg-slate-100 text-slate-700 dark:border-white/10 dark:bg-white/10 dark:text-white"
                        )}
                      >
                        {r.serviceRunning ? "Sí" : "No"}
                      </Badge>
                    </TableCell>
                    <TableCell>{renderHealthBadge(r)}</TableCell>
                    <TableCell className="text-xs text-slate-600 dark:text-slate-300/80">
                      {r.lastServiceCheck
                        ? new Date(r.lastServiceCheck).toLocaleTimeString(
                            "es-ES"
                          )
                        : "-"}
                    </TableCell>
                    <TableCell>
                      <div className="flex flex-wrap gap-2">
                        <Button
                          variant="outline"
                          size="sm"
                          disabled={!r.alive}
                          onClick={() => callServiceAction(r.ip, "install")}
                          className="border border-slate-200/80 bg-white/85 text-slate-700 shadow-sm transition-colors hover:border-sky-300 hover:text-slate-900 disabled:opacity-60 dark:border-white/10 dark:bg-white/5 dark:text-slate-100 dark:hover:border-sky-400/40"
                        >
                          <CloudCog className="mr-1 size-3" /> Instalar
                        </Button>
                        <Button
                          variant="outline"
                          size="sm"
                          disabled={!r.serviceInstalled}
                          onClick={() => callServiceAction(r.ip, "uninstall")}
                          className="border border-slate-200/80 bg-white/85 text-slate-700 shadow-sm transition-colors hover:border-rose-300 hover:text-slate-900 disabled:opacity-60 dark:border-white/10 dark:bg-white/5 dark:text-slate-100 dark:hover:border-rose-400/40"
                        >
                          <Square className="mr-1 size-3" /> Desinstalar
                        </Button>
                        <Button
                          variant="outline"
                          size="sm"
                          disabled={!r.serviceInstalled || r.serviceRunning}
                          onClick={() => callServiceAction(r.ip, "start")}
                          className="border border-slate-200/80 bg-white/85 text-slate-700 shadow-sm transition-colors hover:border-emerald-300 hover:text-slate-900 disabled:opacity-60 dark:border-white/10 dark:bg-white/5 dark:text-slate-100 dark:hover:border-emerald-400/40"
                        >
                          <Play className="mr-1 size-3" /> Iniciar
                        </Button>
                        <Button
                          variant="outline"
                          size="sm"
                          disabled={!r.serviceRunning}
                          onClick={() => callServiceAction(r.ip, "stop")}
                          className="border border-slate-200/80 bg-white/85 text-slate-700 shadow-sm transition-colors hover:border-amber-300 hover:text-slate-900 disabled:opacity-60 dark:border-white/10 dark:bg-white/5 dark:text-slate-100 dark:hover:border-amber-400/40"
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
                    colSpan={7}
                    className="text-center text-xs text-slate-500 dark:text-slate-300/70"
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
  );
}
