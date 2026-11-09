"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { motion } from "framer-motion";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Network,
  Radar,
  Download,
  Wifi,
  MonitorSmartphone,
} from "lucide-react";
import { getCurrentIsoString } from "@/lib/time";
import { formatDateTime } from "@/components/dashboard/types";
import {
  cn,
  getCsrfTokenFromDocument,
  normalizeComputerName,
} from "@/lib/utils";
import { Spinner } from "@/components/ui/spinner";
import {
  InstallTaskDialog,
  type DestinoTarea,
} from "@/components/dashboard/InstallTaskDialog";
import { RowCheckbox } from "@/components/dashboard/BulkSelection";
import { useRouter } from "next/navigation";

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
      return <Wifi className="size-3.5 shrink-0 text-muted-foreground" />;
    case "ethernet":
      return <Network className="size-3.5 shrink-0 text-muted-foreground" />;
    case "vpn":
      return (
        <MonitorSmartphone className="size-3.5 shrink-0 text-muted-foreground" />
      );
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

interface VersionConocida {
  version: string | null;
  desactualizado: boolean;
}

export function NetworkScannerTab({ onRefreshComputers }: Props) {
  const router = useRouter();
  const [versiones, setVersiones] = useState<Map<string, VersionConocida>>(
    new Map(),
  );

  const cargarVersiones = useCallback(async () => {
    try {
      const res = await fetch("/api/computers", { credentials: "include" });
      const datos = await res.json().catch(() => null);
      if (!res.ok || !Array.isArray(datos)) return;
      const mapa = new Map<string, VersionConocida>();
      for (const c of datos) {
        const entrada: VersionConocida = {
          version:
            typeof c?.agentVersion === "string" ? c.agentVersion : null,
          desactualizado: c?.actualizacionDisponible === true,
        };
        if (typeof c?.ipAddress === "string" && c.ipAddress) {
          mapa.set(c.ipAddress.trim().toLowerCase(), entrada);
        }
        if (typeof c?.name === "string" && c.name) {
          mapa.set(
            normalizeComputerName(c.name).toLowerCase(),
            entrada,
          );
        }
      }
      setVersiones(mapa);
    } catch {
      // Sin versiones conocidas el escáner sigue igual: la fila
      // simplemente no enseña etiqueta.
    }
  }, []);

  useEffect(() => {
    queueMicrotask(() => {
      void cargarVersiones();
    });
  }, [cargarVersiones]);
  const [scanning, setScanning] = useState(false);
  const [scanResults, setScanResults] = useState<ScanResult[]>([]);
  const [scanError, setScanError] = useState<string | null>(null);
  const [scanNotice, setScanNotice] = useState<string | null>(null);
  const [lastScanAt, setLastScanAt] = useState<string | null>(null);
  const [installDialogOpen, setInstallDialogOpen] = useState(false);
  const [destinosDialog, setDestinosDialog] = useState<DestinoTarea[]>([]);
  const [seleccionados, setSeleccionados] = useState<ReadonlySet<string>>(
    new Set(),
  );

  const alternarSeleccion = (ip: string) => {
    setSeleccionados((prev) => {
      const next = new Set(prev);
      if (next.has(ip)) {
        next.delete(ip);
      } else {
        next.add(ip);
      }
      return next;
    });
  };

  const abrirInstalacion = (destinos: DestinoTarea[]) => {
    setDestinosDialog(destinos);
    setInstallDialogOpen(true);
  };

  // Network interface selector
  const [interfaces, setInterfaces] = useState<NetworkInterfaceInfo[]>([]);
  const [selectedCidr, setSelectedCidr] = useState<string>(() => {
    try {
      return localStorage.getItem("usbmonitor:interfaz") ?? "auto";
    } catch {
      return "auto";
    }
  });
  const elegirInterfaz = (cidr: string) => {
    setSelectedCidr(cidr);
    try {
      localStorage.setItem("usbmonitor:interfaz", cidr);
    } catch { /* sin almacenamiento */ }
  };
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
    return () => {
      cancelled = true;
    };
  }, []);

  const triggerScan = useCallback(async () => {
    try {
      setScanning(true);
      setScanError(null);
      setScanNotice(null);
      const csrfToken = getCsrfTokenFromDocument();
      if (!csrfToken) {
        throw new Error(
          "Sesión sin token de seguridad. Inicia sesión nuevamente antes de escanear.",
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
              .filter((item) => item.alive),
          ).sort((a, b) => ipToNumber(a.ip) - ipToNumber(b.ip))
        : [];

      setScanResults(normalized);
      setLastScanAt(getCurrentIsoString());
      // Información de cobertura del escaneo (no es un error): qué
      // redes entraron, cuántos hosts vivos salieron y cuántos
      // tienen agente. Una red mayor que una /16 no se barre
      // entera: se avisa de su cobertura parcial.
      const redes: Array<{
        cidr: string;
        coberturaParcial?: boolean;
        motivoParcial?: string;
      }> = Array.isArray(data?.redesEscaneadas) ? data.redesEscaneadas : [];
      if (redes.length > 0) {
        const partes: string[] = [
          `Redes escaneadas: ${redes.map((r) => r.cidr).join(", ")}.`,
          `${typeof data?.hostsVivos === "number" ? data.hostsVivos : normalized.length} equipos vivos, ${typeof data?.conAgente === "number" ? data.conAgente : 0} con agente.`,
        ];
        for (const parcial of redes.filter((r) => r.coberturaParcial)) {
          partes.push(
            `Cobertura parcial en ${parcial.cidr}: ${parcial.motivoParcial || "solo se barrió alrededor de las direcciones conocidas"}.`,
          );
        }
        if (data?.metodo === "tcp") {
          partes.push(
            "No se pudo leer la tabla de vecinos del sistema: se usó el sondeo directo del puerto del agente, que solo detecta equipos con el agente activo.",
          );
        }
        setScanNotice(partes.join(" "));
      }
      onRefreshComputers();
      void cargarVersiones();
    } catch (error: any) {
      const message = error?.message || "No se pudo completar el escaneo";
      setScanError(message);
    } finally {
      setScanning(false);
    }
  }, [onRefreshComputers, selectedCidr, cargarVersiones]);

  const results = useMemo(() => scanResults, [scanResults]);

  const formatTimestamp = useCallback((value: string | null) => {
    if (!value) return "Nunca";
    return formatDateTime(value);
  }, []);

  return (
    <motion.section
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3, ease: "easeOut" }}
      className="w-full"
      data-tour="network-main"
    >
      {/* ── Fila de control ── */}
      <div className="flex flex-col gap-6 border-b border-border pb-7 lg:flex-row lg:items-end lg:justify-between">
        <div className="max-w-xl">
          <h2 className="font-display text-[1.65rem] font-bold leading-tight text-foreground">
            Escaneo de red LAN
          </h2>
          <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
            Detecta equipos activos en la red local y valida el puerto 5001
            del servicio USBMonitor.
          </p>
          <p className="smallcaps mt-4 text-muted-foreground">
            Último escaneo · {formatTimestamp(lastScanAt)}
          </p>
        </div>

        {/* Interface selector + scan button row */}
        <div className="flex flex-wrap items-center gap-3">
          {!loadingInterfaces && interfaces.length > 0 && (
            <Select
              value={selectedCidr}
              onValueChange={elegirInterfaz}
              disabled={scanning}
            >
              <SelectTrigger
                size="sm"
                className="min-w-[220px]"
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
                        (todas las redes)
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
          >
            {scanning ? (
              <span className="mr-2 inline-flex">
                <Spinner size={16} />
              </span>
            ) : (
              <Network className="mr-2 size-4" />
            )}
            {scanning ? "Escaneando..." : "Escanear red"}
          </Button>
        </div>
      </div>

      {scanError && (
        <Alert className="mt-6 border-destructive/40 bg-transparent text-destructive">
          <AlertDescription>{scanError}</AlertDescription>
        </Alert>
      )}

      {scanNotice && !scanError && (
        <Alert className="mt-6 bg-transparent">
          <AlertDescription>{scanNotice}</AlertDescription>
        </Alert>
      )}

      {/* ── Cifra de resultados ── */}
      <div className="flex items-baseline gap-3 border-b border-border py-5">
        <span className="font-display text-[1.9rem] font-bold leading-none tabular-nums text-foreground">
          {results.length}
        </span>
        <span className="smallcaps text-muted-foreground">
          Equipos encontrados
        </span>
      </div>

      {/* ── Resultados: filas de anfitrión ── */}
      <ScrollArea className="max-h-[min(70vh,560px)] [--scrollbar-size:0px] [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden">
        {results.length === 0 ? (
          <p className="flex items-center gap-3 py-10 text-sm text-muted-foreground">
            {scanning && <Spinner size={16} />}
            {scanning
              ? "Escaneando la red local…"
              : "No hay equipos activos en la red local."}
          </p>
        ) : (
          <>
            <div className="smallcaps sticky top-0 z-10 hidden grid-cols-[auto_minmax(11rem,1.2fr)_minmax(10rem,1.4fr)_minmax(9rem,1fr)_minmax(5.5rem,auto)_8.5rem] items-center gap-x-8 gap-y-2 border-b border-border bg-card py-3.5 text-muted-foreground md:grid">
              <span />
              <span>IP</span>
              <span>Nombre</span>
              <span>Puerto del agente</span>
              <span>Latencia</span>
              <span className="text-right">Acciones</span>
            </div>
            <ul className="divide-y divide-border">
              {results.map((result) => {
                const status = result.healthStatus
                  ? result.healthStatus.toLowerCase()
                  : "";
                const serviceOk =
                  status.includes("200") || status.includes("ok");

                return (
                  <li
                    key={result.ip}
                    className="grid gap-x-8 gap-y-2.5 px-1 py-6 transition-colors duration-150 md:grid-cols-[auto_minmax(11rem,1.2fr)_minmax(10rem,1.4fr)_minmax(9rem,1fr)_minmax(5.5rem,auto)_8.5rem] md:items-center"
                  >
                    <span>
                      {!serviceOk && (
                        <RowCheckbox
                          checked={seleccionados.has(result.ip)}
                          onChange={() => alternarSeleccion(result.ip)}
                          label={`Seleccionar ${result.ip} para instalar`}
                        />
                      )}
                    </span>
                    <span className="font-display text-[1.5rem] font-bold leading-none tracking-tight text-foreground">
                      {result.ip}
                    </span>
                    <span className="min-w-0 truncate text-[0.95rem] text-muted-foreground">
                      {result.hostname || "Sin nombre"}
                      {(() => {
                        const info =
                          versiones.get(result.ip.toLowerCase()) ??
                          (result.hostname
                            ? versiones.get(
                                normalizeComputerName(
                                  result.hostname,
                                ).toLowerCase(),
                              )
                            : undefined);
                        if (!info?.version) return null;
                        return (
                          <span className="ml-2 inline-flex items-center gap-1.5">
                            <span className="inline-flex items-center border border-border px-1.5 py-0.5 font-mono text-[11px] text-foreground">
                              Agente v{info.version}
                            </span>
                            {info.desactualizado && (
                              <span className="inline-flex items-center border border-amber-600/50 px-1.5 py-0.5 text-[11px] font-medium text-amber-700 dark:text-amber-500">
                                Desactualizado
                              </span>
                            )}
                          </span>
                        );
                      })()}
                    </span>
                    <span className="flex items-center gap-2.5 text-[0.95rem] text-foreground">
                      <span
                        className={cn(
                          "size-2 shrink-0 rounded-full",
                          serviceOk
                            ? "bg-success"
                            : "bg-muted-foreground/50",
                        )}
                      />
                      {serviceOk ? "Activo" : "Sin respuesta"}
                    </span>
                    <span className="font-mono text-sm tabular-nums text-muted-foreground">
                      {typeof result.latencyMs === "number"
                        ? `${Math.max(0, Math.round(result.latencyMs))} ms`
                        : "—"}
                    </span>
                    <span className="md:text-right">
                      {!serviceOk && (
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => {
                            abrirInstalacion([
                              {
                                pcName: result.hostname || result.ip,
                                ip: result.ip,
                              },
                            ]);
                          }}
                          className="h-8 px-3 text-[0.8rem]"
                        >
                          <Download className="mr-1.5 size-3.5" />
                          Instalar
                        </Button>
                      )}
                    </span>
                  </li>
                );
              })}
            </ul>
          </>
        )}
      </ScrollArea>

      {seleccionados.size > 0 && (
        <div className="sticky bottom-4 z-10 mt-4 flex flex-wrap items-center gap-x-5 gap-y-2 border border-border bg-card px-4 py-3 shadow-lg">
          <span className="text-sm text-foreground">
            <strong className="tabular-nums">{seleccionados.size}</strong>{" "}
            <span className="text-muted-foreground">
              equipo{seleccionados.size === 1 ? "" : "s"} seleccionado
              {seleccionados.size === 1 ? "" : "s"}
            </span>
          </span>
          <span className="ml-auto flex items-center gap-1">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setSeleccionados(new Set())}
            >
              Limpiar
            </Button>
            <Button
              size="sm"
              onClick={() => {
                abrirInstalacion(
                  results
                    .filter((r) => seleccionados.has(r.ip))
                    .map((r) => ({
                      pcName: r.hostname || r.ip,
                      ip: r.ip,
                    })),
                );
              }}
            >
              <Download className="mr-1.5 size-3.5" />
              Instalar el agente
            </Button>
          </span>
        </div>
      )}

      <InstallTaskDialog
        open={installDialogOpen}
        onOpenChange={setInstallDialogOpen}
        destinos={destinosDialog}
        onCreada={() => {
          setSeleccionados(new Set());
          onRefreshComputers();
          router.push("/admin/tasks");
        }}
      />
    </motion.section>
  );
}
