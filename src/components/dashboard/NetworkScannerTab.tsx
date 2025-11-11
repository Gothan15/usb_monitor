"use client";

import { useCallback, useMemo, useState } from "react";
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
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Loader2, Network, Radar } from "lucide-react";
import { getCurrentIsoString } from "@/lib/time";
import { formatDateTime } from "@/components/dashboard/types";
import { getCsrfTokenFromDocument } from "@/lib/utils";

interface ScanResult {
  ip: string;
  alive: boolean;
  hostname?: string;
  healthStatus?: string;
  latencyMs?: number;
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

const normalizeResult = (item: any): ScanResult => ({
  ip: String(item?.ip || "").trim(),
  alive: Boolean(item?.alive),
  hostname: item?.hostname ? String(item.hostname) : undefined,
  healthStatus: item?.healthStatus ? String(item.healthStatus) : undefined,
  latencyMs:
    typeof item?.latencyMs === "number" && Number.isFinite(item.latencyMs)
      ? item.latencyMs
      : undefined,
  error: item?.error ? String(item.error) : undefined,
});

const dedupeByIdentifier = (items: ScanResult[]): ScanResult[] => {
  // Keep the first occurrence per hostname (or IP) and prefer entries with latency data.
  const byIdentifier = new Map<string, ScanResult>();
  for (const item of items) {
    const key = (item.hostname && item.hostname.trim()) || item.ip;
    const current = byIdentifier.get(key);
    if (!current) {
      byIdentifier.set(key, item);
      continue;
    }
    if (
      (current.latencyMs == null && item.latencyMs != null) ||
      (!current.healthStatus && item.healthStatus)
    ) {
      byIdentifier.set(key, item);
    }
  }
  return Array.from(byIdentifier.values());
};

export function NetworkScannerTab({ onRefreshComputers }: Props) {
  const [scanning, setScanning] = useState(false);
  const [scanResults, setScanResults] = useState<ScanResult[]>([]);
  const [scanError, setScanError] = useState<string | null>(null);
  const [lastScanAt, setLastScanAt] = useState<string | null>(null);

  const triggerScan = useCallback(async () => {
    try {
      setScanning(true);
      setScanError(null);
      const csrfToken = getCsrfTokenFromDocument();
      if (!csrfToken) {
        throw new Error(
          "Sesión sin token de seguridad. Inicia sesión nuevamente antes de escanear."
        );
      }
      const payload: Record<string, unknown> = { force: true };
      const res = await fetch("/api/network-scan", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-csrf-token": csrfToken,
        },
        credentials: "include",
        body: JSON.stringify(payload),
      });

      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        const message = data?.error || `Error HTTP ${res.status}`;
        throw new Error(message);
      }

      const normalized = Array.isArray(data?.results)
        ? dedupeByIdentifier(
            (data.results as unknown[])
              .map(normalizeResult)
              .filter((item) => item.alive)
          ).sort((a, b) => ipToNumber(a.ip) - ipToNumber(b.ip))
        : [];

      setScanResults(normalized);
      setLastScanAt(getCurrentIsoString());
      onRefreshComputers();
    } catch (error: any) {
      const message = error?.message || "No se pudo completar el escaneo";
      setScanError(message);
    } finally {
      setScanning(false);
    }
  }, [onRefreshComputers]);

  const results = useMemo(() => scanResults, [scanResults]);

  const formatTimestamp = useCallback((value: string | null) => {
    if (!value) return "Nunca";
    return formatDateTime(value);
  }, []);

  return (
    <motion.section
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3, ease: "easeOut" }}
    >
      <Card className="relative rounded-3xl border border-slate-200/70 bg-white/85 text-slate-900 shadow-xl supports-[backdrop-filter]:backdrop-blur-2xl dark:border-white/10 dark:bg-slate-900/50 dark:text-white">
        <CardHeader className="flex flex-col gap-6 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex items-center gap-3">
            <span className="inline-flex size-12 items-center justify-center rounded-2xl border border-sky-200/60 bg-white/80 text-sky-600 shadow-sm dark:border-sky-400/40 dark:bg-white/10 dark:text-sky-200">
              <Radar className="size-5" />
            </span>
            <div>
              <CardTitle className="text-2xl font-semibold text-slate-900 dark:text-slate-100">
                Escaneo de red LAN
              </CardTitle>
              <CardDescription className="text-sm text-slate-600 dark:text-slate-300/80">
                Detecta equipos activos en la red local y valida el puerto 3000
                del servicio USBMonitor.
              </CardDescription>
              <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                Último escaneo: {formatTimestamp(lastScanAt)}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              disabled={scanning}
              onClick={triggerScan}
              className="border border-white/70 bg-white/80 text-slate-700 shadow-sm transition-colors hover:border-sky-300 hover:text-slate-900 dark:border-white/10 dark:bg-white/10 dark:text-slate-100 dark:hover:border-sky-400/40"
            >
              {scanning ? (
                <Loader2 className="mr-2 size-4 animate-spin" />
              ) : (
                <Network className="mr-2 size-4" />
              )}
              {scanning ? "Escaneando..." : "Escanear red"}
            </Button>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {scanError && (
            <Alert className="border-rose-200/60 bg-rose-50 text-rose-700 dark:border-rose-300/40 dark:bg-rose-500/10 dark:text-rose-100">
              <AlertDescription>{scanError}</AlertDescription>
            </Alert>
          )}

          <div className="flex items-center justify-between rounded-2xl border border-slate-200/70 bg-white/80 px-4 py-3 text-sm shadow-sm dark:border-white/10 dark:bg-white/10">
            <span className="flex items-center gap-2 text-slate-600 dark:text-slate-300">
              <Radar className="size-4" /> Equipos encontrados
            </span>
            <Badge
              variant="secondary"
              className="rounded-full px-3 py-1 text-xs uppercase tracking-[0.2em]"
            >
              {results.length}
            </Badge>
          </div>

          <ScrollArea className="max-h-[min(60vh,420px)] pr-3 [--scrollbar-size:0px] [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden">
            <Table className="min-w-full">
              <TableHeader className="sticky top-0 z-10 bg-white/95 backdrop-blur-xl dark:bg-slate-900/80">
                <TableRow className="border-white/60 dark:border-white/10">
                  <TableHead className="text-slate-600 dark:text-slate-200">
                    IP
                  </TableHead>
                  <TableHead className="text-slate-600 dark:text-slate-200">
                    Nombre
                  </TableHead>
                  <TableHead className="text-slate-600 dark:text-slate-200">
                    Puerto 3000
                  </TableHead>
                  <TableHead className="text-slate-600 dark:text-slate-200">
                    Latencia
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {results.length === 0 ? (
                  <TableRow>
                    <TableCell
                      colSpan={4}
                      className="py-6 text-center text-xs text-slate-500 dark:text-slate-300/70"
                    >
                      No hay equipos activos en la red local.
                    </TableCell>
                  </TableRow>
                ) : (
                  results.map((result) => {
                    const status = result.healthStatus
                      ? result.healthStatus.toLowerCase()
                      : "";
                    const serviceOk =
                      status.includes("200") || status.includes("ok");

                    return (
                      <TableRow
                        key={result.ip}
                        className="border border-white/70 bg-white/75 transition-colors hover:border-sky-300/60 hover:bg-sky-50/60 dark:border-white/5 dark:bg-white/5 dark:hover:border-sky-400/30 dark:hover:bg-sky-500/10"
                      >
                        <TableCell className="font-semibold text-slate-700 dark:text-slate-100">
                          {result.ip}
                        </TableCell>
                        <TableCell className="text-xs text-slate-600 dark:text-slate-300">
                          {result.hostname || "Sin nombre"}
                        </TableCell>
                        <TableCell>
                          <Badge
                            variant={serviceOk ? "success" : "secondary"}
                            className="rounded-full px-3 py-1 text-[0.65rem] font-semibold uppercase tracking-[0.2em]"
                          >
                            {serviceOk ? "Activo" : "Sin respuesta"}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-xs text-slate-600 dark:text-slate-300">
                          {typeof result.latencyMs === "number"
                            ? `${Math.max(0, Math.round(result.latencyMs))} ms`
                            : "—"}
                        </TableCell>
                      </TableRow>
                    );
                  })
                )}
              </TableBody>
            </Table>
          </ScrollArea>
        </CardContent>
      </Card>
    </motion.section>
  );
}
