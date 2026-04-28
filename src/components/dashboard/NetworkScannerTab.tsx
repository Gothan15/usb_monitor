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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Network, Radar, Download, Wifi, MonitorSmartphone } from "lucide-react";
import { getCurrentIsoString } from "@/lib/time";
import { formatDateTime } from "@/components/dashboard/types";
import { getCsrfTokenFromDocument } from "@/lib/utils";
import { Spinner } from "@/components/ui/spinner";
import { RemoteInstallDialog } from "@/components/dashboard/RemoteInstallDialog";

interface NetworkInterfaceInfo {
  name: string;
  address: string;
  cidr: string;
  mac: string;
  netmask: string;
  type: "wifi" | "ethernet" | "vpn" | "other";
}

const IFACE_TYPE_LABELS: Record<NetworkInterfaceInfo["type"], string> = {
  wifi: "Wi-Fi",
  ethernet: "Ethernet",
  vpn: "VPN",
  other: "Red",
};

function InterfaceIcon({ type }: { type: NetworkInterfaceInfo["type"] }) {
  switch (type) {
    case "wifi":
      return <Wifi className="size-3.5 shrink-0 text-sky-500" />;
    case "ethernet":
      return <Network className="size-3.5 shrink-0 text-emerald-500" />;
    case "vpn":
      return <MonitorSmartphone className="size-3.5 shrink-0 text-amber-500" />;
    default:
      return <Network className="size-3.5 shrink-0 text-muted-foreground" />;
  }
}

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
  const [installDialogOpen, setInstallDialogOpen] = useState(false);
  const [installTarget, setInstallTarget] = useState<ScanResult | null>(null);

  // Network interface selector
  const [interfaces, setInterfaces] = useState<NetworkInterfaceInfo[]>([]);
  const [selectedCidr, setSelectedCidr] = useState<string>("auto");
  const [loadingInterfaces, setLoadingInterfaces] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/network-interfaces", {
          credentials: "include",
        });
        if (!res.ok) throw new Error();
        const data = await res.json();
        if (!cancelled && Array.isArray(data?.interfaces)) {
          setInterfaces(data.interfaces);
          // Auto-select if only one interface
          if (data.interfaces.length === 1) {
            setSelectedCidr(data.interfaces[0].cidr);
          }
        }
      } catch {
        // silently ignore – selector will simply not appear
      } finally {
        if (!cancelled) setLoadingInterfaces(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

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
      if (selectedCidr && selectedCidr !== "auto") {
        payload.cidr = selectedCidr;
      }
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
  }, [onRefreshComputers, selectedCidr]);

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
      className="w-full"
    >
      <Card className="relative w-full rounded-xl border border-border/60 bg-card/80 shadow-xl backdrop-blur-xl">
        <CardHeader className="flex flex-col gap-6 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex items-center gap-3">
            <span className="inline-flex size-12 items-center justify-center rounded-xl border border-border/40 bg-muted/30 text-info shadow-sm">
              <Radar className="size-5" />
            </span>
            <div>
              <CardTitle className="text-2xl font-semibold text-foreground">
                Escaneo de red LAN
              </CardTitle>
              <CardDescription className="text-sm text-muted-foreground">
                Detecta equipos activos en la red local y valida el puerto 3000
                del servicio USBMonitor.
              </CardDescription>
              <p className="mt-1 text-xs text-muted-foreground">
                Último escaneo: {formatTimestamp(lastScanAt)}
              </p>
            </div>
          </div>

          {/* Interface selector + scan button row */}
          <div className="flex flex-wrap items-center gap-3">
            {!loadingInterfaces && interfaces.length > 0 && (
              <Select
                value={selectedCidr}
                onValueChange={setSelectedCidr}
                disabled={scanning}
              >
                <SelectTrigger
                  size="sm"
                  className="min-w-[220px] border-border/40 bg-card/80 shadow-sm"
                  id="network-interface-selector"
                >
                  <SelectValue placeholder="Seleccionar interfaz" />
                </SelectTrigger>
                <SelectContent>
                  {interfaces.length > 1 && (
                    <SelectItem value="auto">
                      <span className="flex items-center gap-2">
                        <Radar className="size-3.5 shrink-0 text-muted-foreground" />
                        <span>Automática</span>
                        <span className="text-[0.65rem] text-muted-foreground">
                          (primera disponible)
                        </span>
                      </span>
                    </SelectItem>
                  )}
                  {interfaces.map((iface) => (
                    <SelectItem key={iface.cidr} value={iface.cidr}>
                      <span className="flex items-center gap-2">
                        <InterfaceIcon type={iface.type} />
                        <span>{IFACE_TYPE_LABELS[iface.type]}</span>
                        <span className="text-[0.65rem] text-muted-foreground">
                          {iface.cidr}
                        </span>
                      </span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
            <Button
              variant="outline"
              size="sm"
              disabled={scanning}
              onClick={triggerScan}
              className="border border-border/40 bg-card/80 text-foreground shadow-sm transition-colors hover:border-primary/40"
            >
              {scanning ? (
                <div className="mr-2">
                  <Spinner size={16} />
                </div>
              ) : (
                <Network className="mr-2 size-4" />
              )}
              {scanning ? "Escaneando..." : "Escanear red"}
            </Button>
          </div>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          {scanError && (
            <Alert className="border-rose-200/60 bg-rose-50 text-rose-700 dark:border-rose-300/40 dark:bg-rose-500/10 dark:text-rose-100">
              <AlertDescription>{scanError}</AlertDescription>
            </Alert>
          )}

          <div className="flex items-center justify-between rounded-xl border border-border/40 bg-card/80 px-4 py-3 text-sm shadow-sm">
            <span className="flex items-center gap-2 text-muted-foreground">
              <Radar className="size-4" /> Equipos encontrados
            </span>
            <Badge
              variant="secondary"
              className="rounded-full px-3 py-1 text-xs uppercase tracking-[0.2em]"
            >
              {results.length}
            </Badge>
          </div>

          <ScrollArea className="max-h-[min(65vh,480px)] pr-3 [--scrollbar-size:0px] [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden">
            <Table className="w-full">
              <TableHeader className="sticky top-0 z-10 bg-card/95 backdrop-blur-xl">
                <TableRow className="border-border/40">
                  <TableHead className="text-muted-foreground">
                    IP
                  </TableHead>
                  <TableHead className="text-muted-foreground">
                    Nombre
                  </TableHead>
                  <TableHead className="text-muted-foreground">
                    Puerto 3000
                  </TableHead>
                  <TableHead className="text-muted-foreground">
                    Latencia
                  </TableHead>
                  <TableHead className="text-right text-muted-foreground">
                    Acciones
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {results.length === 0 ? (
                  <TableRow>
                    <TableCell
                      colSpan={5}
                      className="py-6 text-center text-xs text-muted-foreground"
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
                        className="transition-colors duration-150"
                      >
                        <TableCell className="font-semibold text-foreground">
                          {result.ip}
                        </TableCell>
                        <TableCell className="text-xs text-muted-foreground">
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
                        <TableCell className="text-xs text-muted-foreground">
                          {typeof result.latencyMs === "number"
                            ? `${Math.max(0, Math.round(result.latencyMs))} ms`
                            : "—"}
                        </TableCell>
                        <TableCell className="text-right">
                          {!serviceOk && (
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => {
                                setInstallTarget(result);
                                setInstallDialogOpen(true);
                              }}
                              className="h-7 border-border/40 px-2.5 text-xs"
                            >
                              <Download className="mr-1.5 size-3" />
                              Instalar
                            </Button>
                          )}
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

      {installTarget && (
        <RemoteInstallDialog
          open={installDialogOpen}
          onOpenChange={(open) => {
            setInstallDialogOpen(open);
            if (!open) setInstallTarget(null);
          }}
          targetIp={installTarget.ip}
          targetHostname={installTarget.hostname}
          onInstallComplete={onRefreshComputers}
        />
      )}
    </motion.section>
  );
}
