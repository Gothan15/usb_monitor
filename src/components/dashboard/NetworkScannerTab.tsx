"use client";
import { useState, useEffect } from "react";
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
  ScanLine,
  CloudCog,
  Power,
  Play,
  Square,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

interface ScanResult {
  ip: string;
  alive: boolean;
  serviceInstalled?: boolean;
  serviceRunning?: boolean;
  lastServiceCheck?: string | null;
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

  const triggerScan = async () => {
    try {
      setScanning(true);
      setScanError(null);
      setScanResults(null);
      const res = await fetch("/api/network-scan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      if (!res.ok) throw new Error("Error HTTP " + res.status);
      const data = await res.json();
      setScanResults(data.results || []);
      onRefreshComputers();
    } catch (e: any) {
      setScanError(e.message);
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
    } catch (e: any) {
      setScanError(e.message);
      setScanning(false);
    }
  };

  useEffect(() => {
    if (!scanJobId) return;
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
        }
      } catch {
        /* ignore */
      }
    }, 1000);
    return () => clearInterval(interval);
  }, [scanJobId]);

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
      triggerScan();
    } catch (e: any) {
      setServiceActionMsg("Error: " + e.message);
    }
  };

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle>Escaneo de Red</CardTitle>
            <CardDescription>
              Descubre hosts activos y estado del agente
            </CardDescription>
          </div>
          <div className="flex gap-2 items-center">
            <Button
              variant="outline"
              size="sm"
              disabled={scanning}
              onClick={() => triggerScan()}
            >
              <ScanLine className="h-4 w-4 mr-2" />{" "}
              {scanning ? "Escaneando..." : "Escanear /24"}
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={scanning}
              onClick={() => startAsyncScan()}
            >
              <ScanLine className="h-4 w-4 mr-2" />{" "}
              {scanning && scanJobId ? "Async..." : "Async"}
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        {scanError && (
          <Alert className="mb-4">
            <AlertTriangle className="h-4 w-4" />
            <AlertDescription>{scanError}</AlertDescription>
          </Alert>
        )}
        {serviceActionMsg && (
          <div className="text-xs text-muted-foreground mb-2">
            {serviceActionMsg}
          </div>
        )}
        {scanning && (
          <div className="mb-3">
            <div className="text-xs mb-1">
              Progreso: {(scanProgress * 100).toFixed(1)}%
            </div>
            <div className="h-2 w-full bg-muted rounded overflow-hidden">
              <div
                className="h-full bg-primary transition-all"
                style={{ width: `${(scanProgress * 100).toFixed(1)}%` }}
              ></div>
            </div>
          </div>
        )}
        <div className="text-xs text-muted-foreground mb-3">
          Resultados: {scanResults ? scanResults.length : 0}
        </div>
        <ScrollArea className="h-[400px]">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>IP</TableHead>
                <TableHead>Vivo</TableHead>
                <TableHead>Servicio Inst.</TableHead>
                <TableHead>Servicio Activo</TableHead>
                <TableHead>Última Verif.</TableHead>
                <TableHead>Acciones</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {scanResults && scanResults.length > 0 ? (
                scanResults.map((r) => (
                  <TableRow key={r.ip}>
                    <TableCell className="font-medium">{r.ip}</TableCell>
                    <TableCell>
                      <Badge variant={r.alive ? "default" : "secondary"}>
                        {r.alive ? "Sí" : "No"}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <Badge
                        variant={r.serviceInstalled ? "default" : "secondary"}
                      >
                        {r.serviceInstalled ? "Sí" : "No"}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <Badge
                        variant={r.serviceRunning ? "default" : "secondary"}
                      >
                        {r.serviceRunning ? "Sí" : "No"}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-xs">
                      {r.lastServiceCheck
                        ? new Date(r.lastServiceCheck).toLocaleTimeString(
                            "es-ES"
                          )
                        : "-"}
                    </TableCell>
                    <TableCell>
                      <div className="flex gap-1 flex-wrap">
                        <Button
                          variant="outline"
                          size="sm"
                          disabled={!r.alive}
                          onClick={() => callServiceAction(r.ip, "install")}
                        >
                          <CloudCog className="h-3 w-3 mr-1" /> Instalar
                        </Button>
                        <Button
                          variant="outline"
                          size="sm"
                          disabled={!r.serviceInstalled}
                          onClick={() => callServiceAction(r.ip, "uninstall")}
                        >
                          <Square className="h-3 w-3 mr-1" /> Desinstalar
                        </Button>
                        <Button
                          variant="outline"
                          size="sm"
                          disabled={!r.serviceInstalled || r.serviceRunning}
                          onClick={() => callServiceAction(r.ip, "start")}
                        >
                          <Play className="h-3 w-3 mr-1" /> Iniciar
                        </Button>
                        <Button
                          variant="outline"
                          size="sm"
                          disabled={!r.serviceRunning}
                          onClick={() => callServiceAction(r.ip, "stop")}
                        >
                          <Power className="h-3 w-3 mr-1" /> Detener
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))
              ) : (
                <TableRow>
                  <TableCell
                    colSpan={6}
                    className="text-center text-xs text-muted-foreground"
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
