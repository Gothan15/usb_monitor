"use client";

import { memo, useMemo } from "react";
import { motion } from "framer-motion";
import { cn } from "@/lib/utils";
import { Activity, AlertTriangle, ShieldCheck, Wifi } from "lucide-react";
import { StatCard } from "@/components/ui/stat-card";
import { GlassPanel } from "@/components/ui/glass-panel";
import { LiveIndicator } from "@/components/ui/live-indicator";

interface Props {
  activeComputers: number;
  totalComputers: number;
  totalEvents: number;
  recentEvents: number;
  whitelistCount: number;
}

const numberFormatter = new Intl.NumberFormat("es-ES");

function StatsCardsComponent({
  activeComputers,
  totalComputers,
  totalEvents,
  recentEvents,
  whitelistCount,
}: Props) {
  const liveStatus = useMemo(() => {
    const utilization = totalComputers
      ? Math.round((activeComputers / totalComputers) * 100)
      : 0;

    if (activeComputers === 0) {
      return {
        label: "Sin agentes",
        description: "No hay equipos reportando",
        chip: "Offline",
        tone: "danger" as const,
        status: "disconnected" as const,
      };
    }

    if (utilization < 60) {
      return {
        label: "Cobertura parcial",
        description: `${numberFormatter.format(activeComputers)} de ${numberFormatter.format(totalComputers)} activos`,
        chip: `${utilization}%`,
        tone: "warning" as const,
        status: "reconnecting" as const,
      };
    }

    return {
      label: "Monitoreo estable",
      description: `${numberFormatter.format(activeComputers)} equipos bajo control`,
      chip: "En vivo",
      tone: "success" as const,
      status: "connected" as const,
    };
  }, [activeComputers, totalComputers]);

  return (
    <div className="grid gap-4 lg:grid-cols-4" data-tour="stats-cards">
      {/* Hero status card */}
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.35 }}
      >
        <GlassPanel
          variant="elevated"
          className="flex h-full flex-col justify-between gap-4 p-5"
        >
          <div className="flex items-start justify-between">
            <div>
              <div className="flex items-center gap-2">
                <LiveIndicator status={liveStatus.status} size="sm" />
                <span className="text-[10px] font-semibold uppercase tracking-[0.2em] text-muted-foreground">
                  Estado en vivo
                </span>
              </div>
              <h2 className="mt-2 text-2xl font-bold tracking-tight text-foreground">
                {liveStatus.label}
              </h2>
              <p className="mt-1 text-xs text-muted-foreground">
                {liveStatus.description}
              </p>
            </div>
            <div
              className={cn(
                "flex size-10 items-center justify-center rounded-xl",
                liveStatus.tone === "success" &&
                  "bg-emerald-500/10 text-emerald-500",
                liveStatus.tone === "warning" &&
                  "bg-amber-500/10 text-amber-500",
                liveStatus.tone === "danger" && "bg-rose-500/10 text-rose-500",
              )}
            >
              <Wifi className="size-5" />
            </div>
          </div>
          <div
            className={cn(
              "flex items-center justify-between rounded-lg border px-3 py-2 text-xs font-medium",
              liveStatus.tone === "success" &&
                "border-emerald-500/20 bg-emerald-500/5 text-emerald-600 dark:text-emerald-400",
              liveStatus.tone === "warning" &&
                "border-amber-500/20 bg-amber-500/5 text-amber-600 dark:text-amber-400",
              liveStatus.tone === "danger" &&
                "border-rose-500/20 bg-rose-500/5 text-rose-600 dark:text-rose-400",
            )}
          >
            <span className="text-[10px] uppercase tracking-wider opacity-70">
              Cobertura
            </span>
            <span className="font-bold">{liveStatus.chip}</span>
          </div>
        </GlassPanel>
      </motion.div>

      {/* KPI cards */}
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.35, delay: 0.05 }}
      >
        <StatCard
          title="Whitelist"
          value={numberFormatter.format(whitelistCount)}
          tone="success"
          icon={<ShieldCheck className="size-4" />}
        />
      </motion.div>

      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.35, delay: 0.1 }}
      >
        <StatCard
          title="Eventos totales"
          value={numberFormatter.format(totalEvents)}
          icon={<Activity className="size-4" />}
        />
      </motion.div>

      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.35, delay: 0.15 }}
      >
        <StatCard
          title="Última hora"
          value={numberFormatter.format(recentEvents)}
          tone="warning"
          icon={<AlertTriangle className="size-4" />}
        />
      </motion.div>
    </div>
  );
}

export const StatsCards = memo(StatsCardsComponent);
