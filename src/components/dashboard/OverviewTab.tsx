"use client";

import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { fetchJson } from "@/lib/http";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { StatsCards } from "@/components/dashboard/StatsCards";
import {
  formatDateTime,
  formatHour,
} from "@/components/dashboard/types";
import {
  Activity,
  AlertTriangle,
  HardDrive,
  ShieldCheck,
} from "lucide-react";
import dynamic from "next/dynamic";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { getCurrentDate, getCurrentTimestamp } from "@/lib/time";
import { Skeleton } from "@/components/ui/skeleton";

interface DashboardStats {
  totalComputers: number;
  onlineComputers: number;
  totalEvents: number;
  pendingEvents: number;
  recentEvents: {
    createdAt: string;
    whitelisted: boolean;
    event: string;
    serialNumber?: string;
  }[];
  latestAlerts: {
    id: string;
    pcName: string;
    pcUser: string;
    event: string;
    createdAt: string;
  }[];
  whitelistCount: number;
  serviceRunningCount: number;
  serviceRespondingCount: number;
}

const OverviewChart = dynamic(() => import("./OverviewChart"), {
  ssr: false,
  loading: () => <div className="h-full w-full animate-pulse bg-slate-100/50 dark:bg-white/5 rounded-xl" />,
});

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

export function OverviewTab() {
  const { data: stats, isLoading } = useQuery<DashboardStats>({
    queryKey: ["dashboard-stats"],
    queryFn: () => fetchJson<DashboardStats>("/api/dashboard/stats"),
    refetchInterval: 30000,
  });

  const loading = isLoading;

  const trendData = useMemo(() => {
    if (!stats) return [];
    
    const hours = 12;
    const now = getCurrentDate();
    const buckets = new Array(hours).fill(0).map((_, index) => {
      const bucketDate = new Date(
        now.getTime() - (hours - index - 1) * 60 * 60 * 1000
      );
      const label = formatHour(bucketDate);
      return { label, allowed: 0, blocked: 0, total: 0 };
    });

    stats.recentEvents.forEach((event) => {
      const createdAt = new Date(event.createdAt);
      const diffHours =
        (now.getTime() - createdAt.getTime()) / (60 * 60 * 1000);
      if (diffHours < 0 || diffHours >= hours) return;
      const bucketIndex = Math.floor(hours - diffHours - 1);
      const bucket = buckets[bucketIndex];
      if (!bucket) return;

      if (event.whitelisted) bucket.allowed += 1;
      else bucket.blocked += 1;
      bucket.total += 1;
    });

    return buckets;
  }, [stats]);

  const serviceSummary = useMemo(() => {
    if (!stats) return { running: 0, responding: 0, offline: 0, total: 0 };
    return {
      running: stats.serviceRunningCount,
      responding: stats.serviceRespondingCount,
      offline: stats.totalComputers - stats.serviceRunningCount,
      total: stats.totalComputers,
    };
  }, [stats]);

  if (loading && !stats) {
    return (
      <div className="space-y-8">
         <div className="grid gap-4 lg:grid-cols-5">
            {[...Array(5)].map((_, i) => (
              <Skeleton key={i} className="h-32 rounded-3xl" />
            ))}
         </div>
         <div className="grid gap-6 xl:grid-cols-[2fr_1fr]">
            <Skeleton className="h-[350px] rounded-3xl" />
            <Skeleton className="h-[350px] rounded-3xl" />
         </div>
      </div>
    );
  }
  
  // Safe default if stats is null but loading is false (error state)
  const safeStats = stats || {
      totalComputers: 0,
      onlineComputers: 0,
      totalEvents: 0,
      pendingEvents: 0,
      recentEvents: [],
      latestAlerts: [],
      whitelistCount: 0,
      serviceRunningCount: 0,
      serviceRespondingCount: 0
  };

  const recentEventsCount = safeStats.recentEvents.filter((event) => {
      const eventDate = new Date(event.createdAt);
      const oneHourAgo = getCurrentTimestamp() - 60 * 60 * 1000;
      return eventDate.getTime() >= oneHourAgo;
  }).length;

  return (
    <div className="space-y-8">
      <StatsCards
        activeComputers={safeStats.onlineComputers}
        totalComputers={safeStats.totalComputers}
        totalEvents={safeStats.totalEvents}
        recentEvents={recentEventsCount}
        whitelistCount={safeStats.whitelistCount}
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
              {safeStats.totalEvents} total
            </Badge>
          </CardHeader>
          <CardContent className="h-[280px] w-full">
            <OverviewChart data={trendData} />
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
             {safeStats.latestAlerts.length === 0 ? (
              <p className="text-sm text-slate-500 dark:text-slate-400">
                No se detectaron alertas críticas recientes.
              </p>
            ) : (
              safeStats.latestAlerts.map((event) => {
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
                  {safeStats.whitelistCount}
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
                Recomendación
              </p>
              <p className="mt-1">
                Mantén la whitelist sincronizada para asegurar el cumplimiento normativo y reducir alertas.
              </p>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
