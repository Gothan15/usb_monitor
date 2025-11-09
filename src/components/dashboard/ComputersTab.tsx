"use client";

import { useMemo } from "react";
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
import { Skeleton } from "@/components/ui/skeleton";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  AlertTriangle,
  Cpu,
  MonitorSmartphone,
  Router,
  Sparkles,
  Wifi,
} from "lucide-react";
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
  const quickStats = useMemo(() => {
    if (loading) {
      return [
        { label: "Activos", value: "--", accent: "from-emerald-400/30" },
        { label: "Servicios", value: "--", accent: "from-cyan-400/30" },
        { label: "Total", value: "--", accent: "from-slate-300/30" },
      ];
    }

    const activeCount = computers.filter(
      (computer) => computer.isActive
    ).length;
    const runningCount = computers.filter(
      (computer) => computer.serviceRunning
    ).length;
    const total = computers.length;

    return [
      {
        label: "Activos",
        value: activeCount.toString(),
        accent: "from-emerald-400/25 via-emerald-300/10",
      },
      {
        label: "Servicio OK",
        value: runningCount.toString(),
        accent: "from-sky-400/25 via-cyan-300/10",
      },
      {
        label: "Inventario",
        value: total.toString(),
        accent: "from-slate-400/20 via-slate-300/10",
      },
    ];
  }, [computers, loading]);

  return (
    <motion.section
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35, ease: "easeOut" }}
    >
      <Card className="relative overflow-hidden rounded-3xl border border-slate-200/70 bg-white/85 text-slate-900 shadow-xl supports-[backdrop-filter]:backdrop-blur-2xl dark:border-white/10 dark:bg-slate-900/50 dark:text-white">
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top_left,_rgba(16,185,129,0.12),transparent_55%),radial-gradient(circle_at_bottom_right,_rgba(14,165,233,0.12),transparent_55%)] dark:bg-[radial-gradient(circle_at_top_left,_rgba(16,185,129,0.16),transparent_45%),radial-gradient(circle_at_bottom_right,_rgba(14,165,233,0.18),transparent_50%)]" />
        <CardHeader className="relative z-10 space-y-6">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
            <div className="flex items-center gap-3">
              <span className="inline-flex size-12 items-center justify-center rounded-2xl border border-emerald-200/60 bg-white/80 text-emerald-600 shadow-sm dark:border-emerald-400/40 dark:bg-white/10 dark:text-emerald-200">
                <MonitorSmartphone className="size-5" />
              </span>
              <div>
                <CardTitle className="text-2xl font-semibold text-slate-900 dark:text-slate-100">
                  Computadoras monitoreadas
                </CardTitle>
                <CardDescription className="text-sm text-slate-600 dark:text-slate-300/80">
                  Visibilidad integral de hosts con el agente USB y su servicio.
                </CardDescription>
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-2 text-xs font-medium text-slate-600 dark:text-slate-300/80">
              <span className="inline-flex items-center gap-1 rounded-full border border-white/70 bg-white/80 px-3 py-1 shadow-sm backdrop-blur-sm dark:border-white/10 dark:bg-white/10">
                <Wifi className="size-3" />
                Estado de conectividad
              </span>
              <span className="inline-flex items-center gap-1 rounded-full border border-white/70 bg-white/80 px-3 py-1 shadow-sm backdrop-blur-sm dark:border-white/10 dark:bg-white/10">
                <Router className="size-3" />
                Agente USB
              </span>
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
                    {stat.label === "Activos" ? (
                      <Cpu className="size-4" />
                    ) : stat.label === "Servicio OK" ? (
                      <Sparkles className="size-4" />
                    ) : (
                      <MonitorSmartphone className="size-4" />
                    )}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </CardHeader>
        <CardContent className="relative z-10 space-y-6">
          {loading ? (
            <div className="space-y-3">
              {[...Array(5)].map((_, i) => (
                <Skeleton
                  key={i}
                  className="h-12 rounded-2xl bg-slate-100/80 dark:bg-white/10"
                />
              ))}
            </div>
          ) : computers.length === 0 ? (
            <Alert className="rounded-2xl border-amber-200/60 bg-amber-50/90 text-amber-700 shadow-sm dark:border-amber-300/40 dark:bg-amber-500/10 dark:text-amber-100">
              <AlertTriangle className="h-4 w-4" />
              <AlertDescription>
                No hay computadoras monitoreadas aún.
              </AlertDescription>
            </Alert>
          ) : (
            <>
              <div className="space-y-4 md:hidden">
                {computers.map((computer) => (
                  <motion.div
                    key={computer.id}
                    whileHover={{ y: -4 }}
                    transition={{ duration: 0.2 }}
                    className="rounded-3xl border border-white/70 bg-white/85 p-5 shadow-lg supports-[backdrop-filter]:backdrop-blur-xl dark:border-white/10 dark:bg-white/5"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="text-sm font-semibold text-slate-900 dark:text-white">
                          {computer.name}
                        </p>
                        <p className="text-xs uppercase tracking-[0.2em] text-slate-500 dark:text-slate-400">
                          {computer.ipAddress}
                        </p>
                      </div>
                      <StatusBadge active={computer.isActive} />
                    </div>
                    <div className="mt-4 grid gap-3 text-xs text-slate-600 dark:text-slate-300">
                      <div className="flex items-center justify-between">
                        <span className="font-semibold uppercase tracking-[0.18em] text-slate-400 dark:text-slate-500">
                          Servicio
                        </span>
                        <Badge
                          variant={
                            computer.serviceRunning ? "success" : "secondary"
                          }
                          className={cn(
                            "rounded-full border border-white/60 bg-white/80 px-3 py-1 text-[0.65rem] font-semibold uppercase tracking-[0.2em] text-slate-600 shadow-sm dark:border-white/15 dark:bg-white/10 dark:text-slate-200",
                            !computer.serviceRunning &&
                              "border border-slate-200 bg-slate-100 text-slate-700 dark:border-white/10 dark:bg-white/10 dark:text-white"
                          )}
                        >
                          {computer.serviceRunning ? "200 OK" : "Sin respuesta"}
                        </Badge>
                      </div>
                      {computer.lastServiceCheck && (
                        <div className="flex items-center justify-between">
                          <span className="font-semibold uppercase tracking-[0.18em] text-slate-400 dark:text-slate-500">
                            Último ping
                          </span>
                          <span>
                            {new Date(
                              computer.lastServiceCheck
                            ).toLocaleTimeString("es-ES")}
                          </span>
                        </div>
                      )}
                      <div className="flex items-center justify-between">
                        <span className="font-semibold uppercase tracking-[0.18em] text-slate-400 dark:text-slate-500">
                          Última conexión
                        </span>
                        <span>
                          {computer.lastSeen
                            ? formatDateTime(computer.lastSeen)
                            : "Nunca"}
                        </span>
                      </div>
                      <div className="flex items-center justify-between">
                        <span className="font-semibold uppercase tracking-[0.18em] text-slate-400 dark:text-slate-500">
                          Alta
                        </span>
                        <span>{formatDateTime(computer.createdAt)}</span>
                      </div>
                    </div>
                  </motion.div>
                ))}
              </div>

              <ScrollArea className="hidden max-h-[min(60vh,460px)] pr-3 [--scrollbar-size:0px] [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden md:block">
                <Table className="min-w-full">
                  <TableHeader className="sticky top-0 z-10 bg-white/95 backdrop-blur-xl dark:bg-slate-900/80">
                    <TableRow className="border-white/60 dark:border-white/10">
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
                    {computers.map((computer) => (
                      <TableRow
                        key={computer.id}
                        className="group border border-white/70 bg-white/75 transition-all duration-200 hover:-translate-y-0.5 hover:border-emerald-300/60 hover:bg-emerald-50/60 dark:border-white/5 dark:bg-white/5 dark:hover:border-emerald-400/30 dark:hover:bg-emerald-500/10"
                      >
                        <TableCell className="font-semibold text-slate-700 dark:text-slate-100">
                          {computer.name}
                        </TableCell>
                        <TableCell className="text-slate-600 dark:text-slate-300/80">
                          {computer.ipAddress}
                        </TableCell>
                        <TableCell>
                          <StatusBadge active={computer.isActive} />
                        </TableCell>
                        <TableCell>
                          <div className="flex flex-col gap-1">
                            <Badge
                              variant={
                                computer.serviceRunning
                                  ? "success"
                                  : "secondary"
                              }
                              className={cn(
                                "shadow-sm",
                                !computer.serviceRunning &&
                                  "border border-slate-200 bg-slate-100 text-slate-700 dark:border-white/10 dark:bg-white/10 dark:text-white"
                              )}
                            >
                              {computer.serviceRunning
                                ? "200 OK"
                                : "Sin respuesta"}
                            </Badge>
                            {computer.lastServiceCheck && (
                              <span className="text-[10px] text-slate-500 dark:text-slate-400">
                                {new Date(
                                  computer.lastServiceCheck
                                ).toLocaleTimeString("es-ES")}
                              </span>
                            )}
                          </div>
                        </TableCell>
                        <TableCell className="text-slate-600 dark:text-slate-200">
                          {computer.lastSeen
                            ? formatDateTime(computer.lastSeen)
                            : "Nunca"}
                        </TableCell>
                        <TableCell className="text-slate-600 dark:text-slate-200">
                          {formatDateTime(computer.createdAt)}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </ScrollArea>
            </>
          )}
        </CardContent>
      </Card>
    </motion.section>
  );
}
