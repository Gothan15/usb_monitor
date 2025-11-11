"use client";

import { useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { StatsCards } from "@/components/dashboard/StatsCards";
import {
  type USBEvent,
  type Computer,
  type WhitelistEntry,
  formatDateTime,
  formatHour,
} from "@/components/dashboard/types";
import {
  Activity,
  AlertTriangle,
  Clock3,
  HardDrive,
  ShieldCheck,
} from "lucide-react";
import {
  ResponsiveContainer,
  AreaChart,
  Area,
  Tooltip as ChartTooltip,
  XAxis,
  YAxis,
  CartesianGrid,
} from "recharts";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { getCurrentDate, getCurrentTimestamp } from "@/lib/time";

interface OverviewTabProps {
  events: USBEvent[];
  computers: Computer[];
  whitelist: WhitelistEntry[];
  loading: boolean;
}

const classifyEventTone = (message: string) => {
  const normalized = message.toLowerCase();
  if (
    normalized.includes("deneg") ||
    normalized.includes("fail") ||
    normalized.includes("bloque")
  ) {
    return "blocked" as const;
  }
  if (
    normalized.includes("permit") ||
    normalized.includes("desbloque") ||
    normalized.includes("readonly removido")
  ) {
    return "allowed" as const;
  }
  return "neutral" as const;
};

export function OverviewTab({
  events,
  computers,
  whitelist,
  loading,
}: OverviewTabProps) {
  const activeComputers = computers.filter(
    (computer) => computer.isActive
  ).length;
  const totalEvents = events.length;
  const recentEvents = events.filter((event) => {
    const eventDate = new Date(event.createdAt);
    const oneHourAgo = getCurrentTimestamp() - 60 * 60 * 1000;
    return eventDate.getTime() >= oneHourAgo;
  }).length;

  const trendData = useMemo(() => {
    const hours = 12;
    const now = getCurrentDate();
    const buckets = new Array(hours).fill(0).map((_, index) => {
      const bucketDate = new Date(
        now.getTime() - (hours - index - 1) * 60 * 60 * 1000
      );
      const label = formatHour(bucketDate);
      return { label, allowed: 0, blocked: 0, total: 0 };
    });

    events.forEach((event) => {
      const createdAt = new Date(event.createdAt);
      const diffHours =
        (now.getTime() - createdAt.getTime()) / (60 * 60 * 1000);
      if (diffHours < 0 || diffHours >= hours) return;
      const bucketIndex = Math.floor(hours - diffHours - 1);
      const bucket = buckets[bucketIndex];
      if (!bucket) return;

      const tone = classifyEventTone(event.event);
      if (tone === "allowed") bucket.allowed += 1;
      if (tone === "blocked") bucket.blocked += 1;
      bucket.total += 1;
    });

    return buckets;
  }, [events]);

  const latestAlerts = useMemo(
    () =>
      [...events]
        .filter((event) => classifyEventTone(event.event) !== "neutral")
        .slice(0, 6),
    [events]
  );

  const serviceSummary = useMemo(() => {
    const running = computers.filter(
      (computer) => computer.serviceRunning
    ).length;
    const responding = computers.filter(
      (computer) => computer.lastServiceCheck
    ).length;
    const offline = computers.length - running;
    return {
      running,
      responding,
      offline,
      total: computers.length,
    };
  }, [computers]);

  const whitelistStats = useMemo(() => {
    const withNotes = whitelist.filter((item) =>
      Boolean(item.notes?.trim())
    ).length;
    const withLabel = whitelist.filter((item) =>
      Boolean(item.label?.trim())
    ).length;
    return { total: whitelist.length, withNotes, withLabel };
  }, [whitelist]);

  return (
    <div className="space-y-8">
      <StatsCards
        activeComputers={activeComputers}
        totalComputers={computers.length}
        totalEvents={totalEvents}
        recentEvents={recentEvents}
        whitelistCount={whitelist.length}
      />

      <div className="grid gap-6 xl:grid-cols-[2fr_1fr]">
        <Card className="overflow-hidden rounded-3xl border border-slate-200/70 bg-white/70 shadow-xl dark:border-slate-800 dark:bg-slate-900/60">
          <CardHeader className="flex items-center justify-between gap-4 md:flex-row">
            <div>
              <CardTitle className="text-lg font-semibold text-slate-800 dark:text-slate-100">
                Tendencia de eventos (12h)
              </CardTitle>
              <p className="text-sm text-slate-500 dark:text-slate-400">
                Observa el pulso de autorizaciones y bloqueos en tiempo real.
              </p>
            </div>
            <Badge className="rounded-full border border-emerald-400/40 bg-emerald-500/10 px-3 py-1 text-xs font-semibold text-emerald-600 dark:text-emerald-200">
              <Activity className="mr-2 h-3.5 w-3.5" />
              {totalEvents} total
            </Badge>
          </CardHeader>
          <CardContent className="h-[280px] w-full">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart
                data={trendData}
                margin={{ left: 0, right: 0, top: 20, bottom: 10 }}
              >
                <defs>
                  <linearGradient id="allowed" x1="0" x2="0" y1="0" y2="1">
                    <stop offset="5%" stopColor="#10b981" stopOpacity={0.35} />
                    <stop offset="95%" stopColor="#10b981" stopOpacity={0} />
                  </linearGradient>
                  <linearGradient id="blocked" x1="0" x2="0" y1="0" y2="1">
                    <stop offset="5%" stopColor="#f97316" stopOpacity={0.4} />
                    <stop offset="95%" stopColor="#f97316" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid
                  strokeDasharray="3 3"
                  stroke="rgba(15,23,42,0.08)"
                />
                <XAxis
                  dataKey="label"
                  stroke="rgba(15,23,42,0.35)"
                  tickLine={false}
                  axisLine={false}
                  fontSize={12}
                />
                <YAxis
                  stroke="rgba(15,23,42,0.35)"
                  tickLine={false}
                  axisLine={false}
                  fontSize={12}
                  allowDecimals={false}
                />
                <ChartTooltip
                  cursor={{
                    stroke: "rgba(148,163,184,0.3)",
                    strokeDasharray: 4,
                  }}
                  contentStyle={{
                    background: "rgba(15,23,42,0.9)",
                    border: "1px solid rgba(148,163,184,0.3)",
                    borderRadius: 16,
                    color: "white",
                  }}
                  formatter={(value: number, name) => [
                    value,
                    name === "allowed"
                      ? "Autorizados"
                      : name === "blocked"
                      ? "Bloqueados"
                      : "Total",
                  ]}
                />
                <Area
                  type="monotone"
                  dataKey="allowed"
                  stroke="#10b981"
                  fill="url(#allowed)"
                  strokeWidth={2}
                />
                <Area
                  type="monotone"
                  dataKey="blocked"
                  stroke="#f97316"
                  fill="url(#blocked)"
                  strokeWidth={2}
                />
              </AreaChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        <Card className="rounded-3xl border border-slate-200/70 bg-white/70 shadow-xl dark:border-slate-800 dark:bg-slate-900/60">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-lg font-semibold text-slate-800 dark:text-slate-100">
              <AlertTriangle className="h-4 w-4 text-amber-500" />
              Alertas recientes
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {loading ? (
              <div className="h-[180px] animate-pulse rounded-2xl bg-slate-200/40 dark:bg-slate-800/40" />
            ) : latestAlerts.length === 0 ? (
              <p className="text-sm text-slate-500 dark:text-slate-400">
                No se detectaron alertas críticas en las últimas horas.
              </p>
            ) : (
              latestAlerts.map((event) => {
                const tone = classifyEventTone(event.event);
                const toneClasses = cn(
                  "rounded-2xl border px-4 py-3 shadow-sm transition",
                  tone === "blocked" &&
                    "border-rose-300/40 bg-rose-500/10 text-rose-200",
                  tone === "allowed" &&
                    "border-emerald-300/40 bg-emerald-500/10 text-emerald-200",
                  tone === "neutral" &&
                    "border-slate-300/40 bg-slate-100/70 text-slate-600"
                );

                return (
                  <div key={event.id} className={toneClasses}>
                    <p className="text-sm font-medium leading-tight">
                      {event.pcName} · {event.pcUser}
                    </p>
                    <p className="mt-1 text-xs opacity-80">{event.event}</p>
                    <p className="mt-2 text-xs opacity-60">
                      {formatDateTime(event.createdAt)}
                    </p>
                  </div>
                );
              })
            )}
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-6 xl:grid-cols-[1.5fr_1fr]">
        <Card className="rounded-3xl border border-slate-200/70 bg-white/70 shadow-xl dark:border-slate-800 dark:bg-slate-900/60">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-lg font-semibold text-slate-800 dark:text-slate-100">
              <ShieldCheck className="h-4 w-4 text-emerald-500" />
              Salud de agentes y servicios
            </CardTitle>
            <p className="text-sm text-slate-500 dark:text-slate-400">
              Conoce la disponibilidad de los agentes USBMonitor en la red
              corporativa.
            </p>
          </CardHeader>
          <CardContent className="grid gap-4 md:grid-cols-2">
            {[
              {
                label: "Servicios en ejecución",
                value: serviceSummary.running,
                total: serviceSummary.total,
                tone: "emerald" as const,
              },
              {
                label: "Con pulso reciente",
                value: serviceSummary.responding,
                total: serviceSummary.total,
                tone: "sky" as const,
              },
              {
                label: "Hosts en observación",
                value: serviceSummary.offline,
                total: serviceSummary.total,
                tone: "amber" as const,
              },
              {
                label: "Inventario total",
                value: serviceSummary.total,
                total: serviceSummary.total,
                tone: "slate" as const,
              },
            ].map((item) => {
              const percentage = item.total
                ? Math.round((item.value / item.total) * 100)
                : 0;
              const colorMap: Record<string, string> = {
                emerald: "bg-emerald-500",
                sky: "bg-sky-500",
                amber: "bg-amber-500",
                slate: "bg-slate-500",
              };

              return (
                <div
                  key={item.label}
                  className="rounded-2xl border border-slate-200/70 bg-white/70 p-4 shadow-sm dark:border-slate-700/80 dark:bg-slate-900/70"
                >
                  <p className="text-xs font-semibold uppercase tracking-[0.24em] text-slate-500 dark:text-slate-400">
                    {item.label}
                  </p>
                  <div className="mt-3 flex items-end justify-between">
                    <span className="text-3xl font-semibold text-slate-800 dark:text-white">
                      {item.value}
                    </span>
                    <span className="text-xs text-slate-500 dark:text-slate-400">
                      {percentage}%
                    </span>
                  </div>
                  <div className="mt-3 h-2 w-full rounded-full bg-slate-200/70 dark:bg-slate-800/80">
                    <div
                      className={cn("h-full rounded-full", colorMap[item.tone])}
                      style={{ width: `${Math.min(percentage, 100)}%` }}
                    />
                  </div>
                </div>
              );
            })}
          </CardContent>
        </Card>

        <Card className="rounded-3xl border border-slate-200/70 bg-white/70 shadow-xl dark:border-slate-800 dark:bg-slate-900/60">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-lg font-semibold text-slate-800 dark:text-slate-100">
              <HardDrive className="h-4 w-4 text-slate-500" />
              Resumen de whitelist
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4 text-sm text-slate-600 dark:text-slate-300">
            <div className="flex items-center justify-between rounded-2xl border border-slate-200/70 bg-white/70 px-4 py-3 shadow-sm dark:border-slate-700/70 dark:bg-slate-900/70">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.24em] text-slate-500 dark:text-slate-400">
                  Seriales autorizados
                </p>
                <p className="text-2xl font-semibold text-slate-800 dark:text-white">
                  {whitelistStats.total}
                </p>
              </div>
              <Badge
                variant="secondary"
                className="rounded-full border border-slate-200 bg-white px-3 py-1 text-xs text-slate-600 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200"
              >
                Activo
              </Badge>
            </div>
            <div className="rounded-2xl border border-slate-200/70 bg-white/70 px-4 py-3 shadow-sm dark:border-slate-700/70 dark:bg-slate-900/70">
              <p className="text-xs font-semibold uppercase tracking-[0.24em] text-slate-500 dark:text-slate-400">
                Documentados
              </p>
              <p className="mt-1">
                {whitelistStats.withNotes} dispositivos cuentan con notas
                operativas y {whitelistStats.withLabel} tienen un alias
                asignado.
              </p>
            </div>
            <div className="rounded-2xl border border-slate-200/70 bg-white/70 px-4 py-3 shadow-sm dark:border-slate-700/70 dark:bg-slate-900/70">
              <p className="text-xs font-semibold uppercase tracking-[0.24em] text-slate-500 dark:text-slate-400">
                Recomendación
              </p>
              <p className="mt-1">
                Mantén la whitelist sincronizada en menos de 15 minutos tras
                cambios críticos para asegurar el cumplimiento normativo.
              </p>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
