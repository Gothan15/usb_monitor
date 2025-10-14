"use client";

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
import { Skeleton } from "@/components/ui/skeleton";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { AlertTriangle, MonitorSmartphone, Wifi } from "lucide-react";
import { Computer, formatDateTime } from "./types";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

interface Props {
  computers: Computer[];
  loading: boolean;
}

function StatusBadge({ active }: { active: boolean }) {
  return (
    <Badge
      variant={active ? "success" : "secondary"}
      className={cn(
        "shadow-sm",
        !active &&
          "border border-slate-200 bg-slate-100 text-slate-700 dark:border-white/10 dark:bg-white/10 dark:text-white"
      )}
    >
      {active ? "Activo" : "Inactivo"}
    </Badge>
  );
}

export function ComputersTab({ computers, loading }: Props) {
  return (
    <Card className="border border-slate-200/80 bg-white/90 text-slate-900 shadow-lg supports-[backdrop-filter]:backdrop-blur-xl dark:border-white/10 dark:bg-slate-900/50 dark:text-white">
      <CardHeader className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex items-center gap-3">
          <span className="inline-flex size-9 items-center justify-center rounded-full border border-emerald-200/60 bg-emerald-50/90 text-emerald-600 shadow-sm dark:border-emerald-400/40 dark:bg-emerald-500/15 dark:text-emerald-200">
            <MonitorSmartphone className="size-4" />
          </span>
          <div>
            <CardTitle className="text-lg font-semibold text-slate-900 dark:text-slate-100">
              Computadoras monitoreadas
            </CardTitle>
            <CardDescription className="text-slate-600 dark:text-slate-300/80">
              Seguimiento de hosts con el agente USB instalado
            </CardDescription>
          </div>
        </div>
        <div className="flex items-center gap-2 text-xs font-medium text-slate-600 dark:text-slate-300/80">
          <span className="inline-flex items-center gap-1 rounded-full border border-slate-200/80 bg-slate-100/70 px-3 py-1 shadow-sm backdrop-blur-sm dark:border-white/10 dark:bg-white/5">
            <Wifi className="size-3" />
            Estado de conectividad
          </span>
        </div>
      </CardHeader>
      <CardContent>
        {loading ? (
          <div className="space-y-3">
            {[...Array(5)].map((_, i) => (
              <Skeleton
                key={i}
                className="h-12 rounded-xl bg-slate-100 dark:bg-white/10"
              />
            ))}
          </div>
        ) : computers.length === 0 ? (
          <Alert className="border-amber-200/60 bg-amber-50 text-amber-700 dark:border-amber-300/40 dark:bg-amber-500/10 dark:text-amber-100">
            <AlertTriangle className="h-4 w-4" />
            <AlertDescription>
              No hay computadoras monitoreadas aún.
            </AlertDescription>
          </Alert>
        ) : (
          <ScrollArea className="h-[420px] pr-2">
            <Table className="min-w-full">
              <TableHeader className="sticky top-0 z-10 bg-white/95 backdrop-blur-lg dark:bg-slate-900/80">
                <TableRow className="border-slate-200/80 dark:border-white/10">
                  <TableHead className="text-slate-600 dark:text-slate-200">
                    Nombre
                  </TableHead>
                  <TableHead className="text-slate-600 dark:text-slate-200">
                    Dirección IP
                  </TableHead>
                  <TableHead className="text-slate-600 dark:text-slate-200">
                    Estado
                  </TableHead>
                  <TableHead className="text-slate-600 dark:text-slate-200">
                    Servicio
                  </TableHead>
                  <TableHead className="text-slate-600 dark:text-slate-200">
                    Última conexión
                  </TableHead>
                  <TableHead className="text-slate-600 dark:text-slate-200">
                    Fecha registro
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {computers.map((c) => (
                  <TableRow
                    key={c.id}
                    className="group border border-slate-100/70 transition-all duration-200 hover:translate-x-[1px] hover:border-emerald-300/60 dark:border-white/5 dark:hover:border-emerald-400/30"
                  >
                    <TableCell className="font-medium text-slate-700 dark:text-slate-100">
                      {c.name}
                    </TableCell>
                    <TableCell className="text-slate-600 dark:text-slate-300/80">
                      {c.ipAddress}
                    </TableCell>
                    <TableCell>
                      <StatusBadge active={c.isActive} />
                    </TableCell>
                    <TableCell>
                      <div className="flex flex-col gap-1">
                        <Badge
                          variant={c.serviceRunning ? "success" : "secondary"}
                          className={cn(
                            "shadow-sm",
                            !c.serviceRunning &&
                              "border border-slate-200 bg-slate-100 text-slate-700 dark:border-white/10 dark:bg-white/10 dark:text-white"
                          )}
                        >
                          {c.serviceRunning ? "200 OK" : "Sin respuesta"}
                        </Badge>
                        {c.lastServiceCheck && (
                          <span className="text-[10px] text-slate-500 dark:text-slate-400">
                            {new Date(c.lastServiceCheck).toLocaleTimeString(
                              "es-ES"
                            )}
                          </span>
                        )}
                      </div>
                    </TableCell>
                    <TableCell className="text-slate-600 dark:text-slate-200">
                      {c.lastSeen ? formatDateTime(c.lastSeen) : "Nunca"}
                    </TableCell>
                    <TableCell className="text-slate-600 dark:text-slate-200">
                      {formatDateTime(c.createdAt)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </ScrollArea>
        )}
      </CardContent>
    </Card>
  );
}
