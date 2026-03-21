"use client";

import { useMemo, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { StatsCards } from "@/components/dashboard/StatsCards";
import { GlassPanel } from "@/components/ui/glass-panel";
import { Badge } from "@/components/ui/badge";
import {
  type USBEvent,
  type Computer,
  type WhitelistEntry,
  formatDateTime,
  formatHour,
} from "@/components/dashboard/types";
import { Activity, AlertTriangle, HardDrive, ShieldCheck } from "lucide-react";
import {
  ResponsiveContainer,
  AreaChart,
  Area,
  BarChart,
  Bar,
  Tooltip as ChartTooltip,
  XAxis,
  YAxis,
  CartesianGrid,
  PieChart,
  Pie,
  Cell,
  Legend,
} from "recharts";
import { cn } from "@/lib/utils";
import { getCurrentDate, getCurrentTimestamp } from "@/lib/time";
import { ActivityFeed } from "@/components/shared/ActivityFeed";

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
    (computer) => computer.isActive,
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
        now.getTime() - (hours - index - 1) * 60 * 60 * 1000,
      );
      const label = formatHour(bucketDate);
      return { label, allowed: 0, blocked: 0, total: 0 };
    });

    // Mapear seriales en whitelist para clasificación precisa
    const whitelistSerials = new Set(
      whitelist
        .map((w) => w.serialNumber?.trim().toLowerCase())
        .filter((s): s is string => Boolean(s)),
    );

    events.forEach((event) => {
      const createdAt = new Date(event.createdAt);
      const diffHours =
        (now.getTime() - createdAt.getTime()) / (60 * 60 * 1000);
      if (diffHours < 0 || diffHours >= hours) return;
      const bucketIndex = Math.floor(hours - diffHours - 1);
      const bucket = buckets[bucketIndex];
      if (!bucket) return;

      const isWhitelisted =
        Boolean(event.whitelisted) ||
        (event.serialNumber
          ? whitelistSerials.has(event.serialNumber.trim().toLowerCase())
          : false);

      if (isWhitelisted) bucket.allowed += 1;
      else bucket.blocked += 1;
      bucket.total += 1;
    });

    return buckets;
  }, [events, whitelist]);

  const latestAlerts = useMemo(
    () =>
      [...events]
        .filter((event) => classifyEventTone(event.event) !== "neutral")
        .slice(0, 6),
    [events],
  );

  const serviceSummary = useMemo(() => {
    const running = computers.filter(
      (computer) => computer.serviceRunning,
    ).length;
    const responding = computers.filter(
      (computer) => computer.lastServiceCheck,
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
      Boolean(item.notes?.trim()),
    ).length;
    const withLabel = whitelist.filter((item) =>
      Boolean(item.label?.trim()),
    ).length;
    return { total: whitelist.length, withNotes, withLabel };
  }, [whitelist]);

  /* ── Event Distribution (pie data) ── */
  const eventDistribution = useMemo(() => {
    let allowed = 0;
    let blocked = 0;
    let neutral = 0;

    const whitelistSerials = new Set(
      whitelist
        .map((w) => w.serialNumber?.trim().toLowerCase())
        .filter((s): s is string => Boolean(s)),
    );

    events.forEach((ev) => {
      const tone = classifyEventTone(ev.event);
      if (tone === "blocked") blocked++;
      else if (tone === "allowed") allowed++;
      else {
        const isWl =
          Boolean(ev.whitelisted) ||
          (ev.serialNumber
            ? whitelistSerials.has(ev.serialNumber.trim().toLowerCase())
            : false);
        if (isWl) allowed++;
        else neutral++;
      }
    });

    return [
      { name: "Autorizados", value: allowed, color: "oklch(0.72 0.17 160)" },
      { name: "Bloqueados", value: blocked, color: "oklch(0.7 0.18 30)" },
      { name: "Otros", value: neutral, color: "oklch(0.55 0.02 250)" },
    ].filter((d) => d.value > 0);
  }, [events, whitelist]);

  /* ── Top Devices (bar data) ── */
  const topDevices = useMemo(() => {
    const counts = new Map<string, number>();
    events.forEach((ev) => {
      const serial = ev.serialNumber?.trim();
      if (!serial) return;
      counts.set(serial, (counts.get(serial) ?? 0) + 1);
    });
    return [...counts.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 6)
      .map(([serial, count]) => ({
        serial: serial.length > 12 ? serial.slice(0, 12) + "…" : serial,
        count,
      }));
  }, [events]);

  /* ── Chart type toggle ── */
  const [chartType, setChartType] = useState<"area" | "bar">("area");

  return (
    <div className="space-y-6">
      <StatsCards
        activeComputers={activeComputers}
        totalComputers={computers.length}
        totalEvents={totalEvents}
        recentEvents={recentEvents}
        whitelistCount={whitelist.length}
      />

      <div className="grid gap-6 xl:grid-cols-[2fr_1fr]">
        {/* ── Event Trend Chart ── */}
        <GlassPanel
          variant="elevated"
          padding="none"
          className="overflow-hidden"
        >
          <div className="flex items-center justify-between gap-4 border-b border-border/50 px-5 py-4">
            <div>
              <h3 className="text-sm font-semibold text-foreground">
                Tendencia de eventos (12h)
              </h3>
              <p className="mt-0.5 text-xs text-muted-foreground">
                Autorizaciones vs bloqueos en tiempo real
              </p>
            </div>
            <div className="flex items-center gap-2">
              {/* Chart type toggle */}
              <div className="flex items-center rounded-lg border border-border/50 bg-muted/30 p-0.5">
                <button
                  type="button"
                  onClick={() => setChartType("area")}
                  className={cn(
                    "rounded-md px-2 py-1 text-[10px] font-medium transition-all",
                    chartType === "area"
                      ? "bg-background text-foreground shadow-sm"
                      : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  Área
                </button>
                <button
                  type="button"
                  onClick={() => setChartType("bar")}
                  className={cn(
                    "rounded-md px-2 py-1 text-[10px] font-medium transition-all",
                    chartType === "bar"
                      ? "bg-background text-foreground shadow-sm"
                      : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  Barras
                </button>
              </div>
              <Badge variant="outline" className="gap-1.5 text-xs">
                <Activity className="size-3" />
                {totalEvents} total
              </Badge>
            </div>
          </div>
          <div className="h-[280px] w-full px-2 pb-2">
            <ResponsiveContainer width="100%" height="100%">
              {chartType === "area" ? (
                <AreaChart
                  data={trendData}
                  margin={{ left: 0, right: 0, top: 16, bottom: 4 }}
                >
                  <defs>
                    <linearGradient id="allowed" x1="0" x2="0" y1="0" y2="1">
                      <stop
                        offset="5%"
                        stopColor="oklch(0.72 0.17 160)"
                        stopOpacity={0.3}
                      />
                      <stop
                        offset="95%"
                        stopColor="oklch(0.72 0.17 160)"
                        stopOpacity={0}
                      />
                    </linearGradient>
                    <linearGradient id="blocked" x1="0" x2="0" y1="0" y2="1">
                      <stop
                        offset="5%"
                        stopColor="oklch(0.7 0.18 30)"
                        stopOpacity={0.35}
                      />
                      <stop
                        offset="95%"
                        stopColor="oklch(0.7 0.18 30)"
                        stopOpacity={0}
                      />
                    </linearGradient>
                  </defs>
                  <CartesianGrid
                    strokeDasharray="3 3"
                    stroke="var(--color-border)"
                    strokeOpacity={0.4}
                  />
                  <XAxis
                    dataKey="label"
                    stroke="var(--color-muted-foreground)"
                    tickLine={false}
                    axisLine={false}
                    fontSize={11}
                    className="font-mono"
                  />
                  <YAxis
                    stroke="var(--color-muted-foreground)"
                    tickLine={false}
                    axisLine={false}
                    fontSize={11}
                    allowDecimals={false}
                    className="font-mono"
                  />
                  <ChartTooltip
                    cursor={{
                      stroke: "var(--color-border)",
                      strokeDasharray: 4,
                    }}
                    contentStyle={{
                      background: "var(--color-popover)",
                      border: "1px solid var(--color-border)",
                      borderRadius: 12,
                      color: "var(--color-popover-foreground)",
                      fontSize: 12,
                      backdropFilter: "blur(12px)",
                    }}
                    formatter={(value: number, name) => [
                      value,
                      name === "allowed"
                        ? "Autorizados"
                        : name === "blocked"
                          ? "Denegados"
                          : "Total",
                    ]}
                  />
                  <Area
                    type="monotone"
                    dataKey="allowed"
                    stroke="oklch(0.72 0.17 160)"
                    fill="url(#allowed)"
                    strokeWidth={2}
                  />
                  <Area
                    type="monotone"
                    dataKey="blocked"
                    stroke="oklch(0.7 0.18 30)"
                    fill="url(#blocked)"
                    strokeWidth={2}
                  />
                </AreaChart>
              ) : (
                <BarChart
                  data={trendData}
                  margin={{ left: 0, right: 0, top: 16, bottom: 4 }}
                >
                  <CartesianGrid
                    strokeDasharray="3 3"
                    stroke="var(--color-border)"
                    strokeOpacity={0.4}
                  />
                  <XAxis
                    dataKey="label"
                    stroke="var(--color-muted-foreground)"
                    tickLine={false}
                    axisLine={false}
                    fontSize={11}
                    className="font-mono"
                  />
                  <YAxis
                    stroke="var(--color-muted-foreground)"
                    tickLine={false}
                    axisLine={false}
                    fontSize={11}
                    allowDecimals={false}
                    className="font-mono"
                  />
                  <ChartTooltip
                    contentStyle={{
                      background: "var(--color-popover)",
                      border: "1px solid var(--color-border)",
                      borderRadius: 12,
                      color: "var(--color-popover-foreground)",
                      fontSize: 12,
                      backdropFilter: "blur(12px)",
                    }}
                    formatter={(value: number, name) => [
                      value,
                      name === "allowed"
                        ? "Autorizados"
                        : name === "blocked"
                          ? "Denegados"
                          : "Total",
                    ]}
                  />
                  <Bar
                    dataKey="allowed"
                    fill="oklch(0.72 0.17 160)"
                    radius={[4, 4, 0, 0]}
                  />
                  <Bar
                    dataKey="blocked"
                    fill="oklch(0.7 0.18 30)"
                    radius={[4, 4, 0, 0]}
                  />
                </BarChart>
              )}
            </ResponsiveContainer>
          </div>
        </GlassPanel>

        {/* ── Recent Alerts ── */}
        <GlassPanel variant="elevated" padding="none">
          <div className="flex items-center gap-2 border-b border-border/50 px-5 py-4">
            <AlertTriangle className="size-4 text-amber-500" />
            <h3 className="text-sm font-semibold text-foreground">
              Alertas recientes
            </h3>
          </div>
          <div className="max-h-[320px] overflow-y-auto scrollbar-thin">
            {loading ? (
              <div className="space-y-3 p-4">
                {[1, 2, 3].map((i) => (
                  <div
                    key={i}
                    className="h-16 animate-pulse rounded-lg bg-muted/40"
                  />
                ))}
              </div>
            ) : latestAlerts.length === 0 ? (
              <div className="flex flex-col items-center gap-2 py-12 text-muted-foreground">
                <ShieldCheck className="size-8 opacity-30" />
                <p className="text-xs">Sin alertas recientes</p>
              </div>
            ) : (
              <div className="divide-y divide-border/30">
                {latestAlerts.map((event) => {
                  const tone = classifyEventTone(event.event);
                  return (
                    <div
                      key={event.id}
                      className={cn(
                        "px-4 py-3 transition-colors hover:bg-muted/30",
                        tone === "blocked" && "border-l-2 border-l-rose-500/60",
                        tone === "allowed" &&
                          "border-l-2 border-l-emerald-500/60",
                      )}
                    >
                      <p className="text-xs font-medium text-foreground">
                        {event.pcName} · {event.pcUser}
                      </p>
                      <p className="mt-0.5 text-[11px] text-muted-foreground truncate">
                        {event.event}
                      </p>
                      <p className="mt-1 text-[10px] font-mono text-muted-foreground/60">
                        {formatDateTime(event.createdAt)}
                      </p>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </GlassPanel>
      </div>

      <div className="grid gap-6 xl:grid-cols-[1.5fr_1fr]">
        {/* ── Agent Health ── */}
        <GlassPanel variant="elevated" padding="none">
          <div className="border-b border-border/50 px-5 py-4">
            <h3 className="flex items-center gap-2 text-sm font-semibold text-foreground">
              <ShieldCheck className="size-4 text-emerald-500" />
              Salud de agentes y servicios
            </h3>
            <p className="mt-0.5 text-xs text-muted-foreground">
              Disponibilidad de los agentes USBMonitor en la red
            </p>
          </div>
          <div className="grid gap-3 p-4 md:grid-cols-2">
            {[
              {
                label: "En ejecución",
                value: serviceSummary.running,
                total: serviceSummary.total,
                color: "bg-emerald-500",
              },
              {
                label: "Con pulso reciente",
                value: serviceSummary.responding,
                total: serviceSummary.total,
                color: "bg-sky-500",
              },
              {
                label: "En observación",
                value: serviceSummary.offline,
                total: serviceSummary.total,
                color: "bg-amber-500",
              },
              {
                label: "Inventario total",
                value: serviceSummary.total,
                total: serviceSummary.total,
                color: "bg-muted-foreground",
              },
            ].map((item) => {
              const pct = item.total
                ? Math.round((item.value / item.total) * 100)
                : 0;
              return (
                <div
                  key={item.label}
                  className="rounded-lg border border-border/40 bg-card/50 p-3.5"
                >
                  <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-muted-foreground">
                    {item.label}
                  </p>
                  <div className="mt-2 flex items-end justify-between">
                    <span className="text-2xl font-bold tabular-nums text-foreground">
                      {item.value}
                    </span>
                    <span className="text-[10px] font-mono text-muted-foreground">
                      {pct}%
                    </span>
                  </div>
                  <div className="mt-2 h-1.5 w-full rounded-full bg-muted/60">
                    <div
                      className={cn(
                        "h-full rounded-full transition-all duration-500",
                        item.color,
                      )}
                      style={{ width: `${Math.min(pct, 100)}%` }}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        </GlassPanel>

        {/* ── Whitelist Summary ── */}
        <GlassPanel variant="elevated" padding="none">
          <div className="flex items-center gap-2 border-b border-border/50 px-5 py-4">
            <HardDrive className="size-4 text-muted-foreground" />
            <h3 className="text-sm font-semibold text-foreground">
              Resumen de lista blanca
            </h3>
          </div>
          <div className="space-y-3 p-4 text-sm">
            <div className="flex items-center justify-between rounded-lg border border-border/40 bg-card/50 px-4 py-3">
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-muted-foreground">
                  Seriales autorizados
                </p>
                <p className="mt-1 text-xl font-bold tabular-nums text-foreground">
                  {whitelistStats.total}
                </p>
              </div>
              <Badge variant="outline" className="text-[10px]">
                Activo
              </Badge>
            </div>
            <div className="rounded-lg border border-border/40 bg-card/50 px-4 py-3">
              <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-muted-foreground">
                Documentados
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                {whitelistStats.withNotes} con notas ·{" "}
                {whitelistStats.withLabel} con alias
              </p>
            </div>
            <div className="rounded-lg border border-border/40 bg-card/50 px-4 py-3">
              <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-muted-foreground">
                Recomendación
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                Sincroniza la lista blanca en menos de 15 min tras cambios
                críticos.
              </p>
            </div>
          </div>
        </GlassPanel>
      </div>

      {/* ── Row 3: Distribution · Top Devices · Live Feed ── */}
      <div className="grid gap-6 xl:grid-cols-3">
        {/* ── Event Distribution Pie ── */}
        <GlassPanel variant="elevated" padding="none">
          <div className="border-b border-border/50 px-5 py-4">
            <h3 className="text-sm font-semibold text-foreground">
              Distribución de eventos
            </h3>
            <p className="mt-0.5 text-xs text-muted-foreground">
              Clasificación general
            </p>
          </div>
          <div className="flex h-[240px] items-center justify-center px-2">
            {eventDistribution.length === 0 ? (
              <p className="text-xs text-muted-foreground">Sin datos</p>
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={eventDistribution}
                    dataKey="value"
                    nameKey="name"
                    cx="50%"
                    cy="50%"
                    innerRadius={50}
                    outerRadius={80}
                    paddingAngle={3}
                    strokeWidth={0}
                  >
                    {eventDistribution.map((entry) => (
                      <Cell key={entry.name} fill={entry.color} />
                    ))}
                  </Pie>
                  <ChartTooltip
                    contentStyle={{
                      background: "var(--color-popover)",
                      border: "1px solid var(--color-border)",
                      borderRadius: 12,
                      color: "var(--color-popover-foreground)",
                      fontSize: 12,
                      backdropFilter: "blur(12px)",
                    }}
                  />
                  <Legend
                    verticalAlign="bottom"
                    height={36}
                    formatter={(value: string) => (
                      <span className="text-xs text-muted-foreground">
                        {value}
                      </span>
                    )}
                  />
                </PieChart>
              </ResponsiveContainer>
            )}
          </div>
        </GlassPanel>

        {/* ── Top Devices Bar ── */}
        <GlassPanel variant="elevated" padding="none">
          <div className="border-b border-border/50 px-5 py-4">
            <h3 className="text-sm font-semibold text-foreground">
              Dispositivos más activos
            </h3>
            <p className="mt-0.5 text-xs text-muted-foreground">
              Por cantidad de eventos
            </p>
          </div>
          <div className="flex h-[240px] items-center justify-center px-2 pb-2">
            {topDevices.length === 0 ? (
              <p className="text-xs text-muted-foreground">Sin datos</p>
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart
                  data={topDevices}
                  layout="vertical"
                  margin={{ left: 4, right: 16, top: 8, bottom: 4 }}
                >
                  <CartesianGrid
                    strokeDasharray="3 3"
                    stroke="var(--color-border)"
                    strokeOpacity={0.3}
                    horizontal={false}
                  />
                  <XAxis
                    type="number"
                    stroke="var(--color-muted-foreground)"
                    tickLine={false}
                    axisLine={false}
                    fontSize={10}
                    allowDecimals={false}
                    className="font-mono"
                  />
                  <YAxis
                    type="category"
                    dataKey="serial"
                    stroke="var(--color-muted-foreground)"
                    tickLine={false}
                    axisLine={false}
                    fontSize={10}
                    width={90}
                    className="font-mono"
                  />
                  <ChartTooltip
                    contentStyle={{
                      background: "var(--color-popover)",
                      border: "1px solid var(--color-border)",
                      borderRadius: 12,
                      color: "var(--color-popover-foreground)",
                      fontSize: 12,
                      backdropFilter: "blur(12px)",
                    }}
                    formatter={(value: number) => [value, "Eventos"]}
                  />
                  <Bar
                    dataKey="count"
                    fill="var(--color-primary)"
                    radius={[0, 4, 4, 0]}
                    barSize={14}
                  />
                </BarChart>
              </ResponsiveContainer>
            )}
          </div>
        </GlassPanel>

        {/* ── Live Activity Feed ── */}
        <ActivityFeed maxItems={15} mode="compact" className="max-h-[340px]" />
      </div>
    </div>
  );
}
