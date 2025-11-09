"use client";

import { memo, useMemo } from "react";
import { motion } from "framer-motion";
import { cn } from "@/lib/utils";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Activity, AlertTriangle, RefreshCw, ShieldCheck } from "lucide-react";

interface Props {
  activeComputers: number;
  totalComputers: number;
  totalEvents: number;
  recentEvents: number;
  // lastUpdate: Date;
  whitelistCount: number;
}

const numberFormatter = new Intl.NumberFormat("es-ES");

function StatsCardsComponent({
  activeComputers,
  totalComputers,
  totalEvents,
  recentEvents,
  // lastUpdate,
  whitelistCount,
}: Props) {
  const liveStatus = useMemo(() => {
    const utilization = totalComputers
      ? Math.round((activeComputers / totalComputers) * 100)
      : 0;
    if (activeComputers === 0) {
      return {
        label: "En standby",
        description: "Sin agentes activos",
        chip: "offline",
        glow: "from-slate-800 via-slate-900 to-slate-950",
      };
    }

    if (utilization < 60) {
      return {
        label: "Monitoreo parcial",
        description: `${numberFormatter.format(
          activeComputers
        )} de ${numberFormatter.format(totalComputers)} activos`,
        chip: `${utilization}% online`,
        glow: "from-emerald-500/40 via-emerald-600/20 to-transparent",
      };
    }

    return {
      label: "Autorizado",
      description: `${numberFormatter.format(
        activeComputers
      )} equipos bajo control`,
      chip: "en vivo",
      glow: "from-emerald-500/60 via-emerald-400/30 to-transparent",
    };
  }, [activeComputers, totalComputers]);

  const statCards = useMemo(
    () => [
      {
        title: "Whitelist activos",
        description: "seriales autorizados",
        value: numberFormatter.format(whitelistCount),
        icon: <ShieldCheck className="h-4 w-4" />,
        accent: "from-lime-500/60 via-emerald-500/20 to-transparent",
      },
      {
        title: "Eventos totales",
        description: "registros acumulados",
        value: numberFormatter.format(totalEvents),
        icon: <Activity className="h-4 w-4" />,
        accent: "from-sky-500/50 via-blue-500/20 to-transparent",
      },
      {
        title: "Eventos recientes",
        description: "últimos 60 minutos",
        value: numberFormatter.format(recentEvents),
        icon: <AlertTriangle className="h-4 w-4" />,
        accent: "from-amber-500/50 via-orange-500/20 to-transparent",
      },
      // {
      //   title: "Última sincronización",
      //   description: "actualización automática",
      //   value: new Intl.DateTimeFormat("es-ES", {
      //     hour: "2-digit",
      //     minute: "2-digit",
      //     second: "2-digit",
      //   }).format(lastUpdate),
      //   icon: <RefreshCw className="h-4 w-4" />,
      //   accent: "from-cyan-500/50 via-blue-500/20 to-transparent",
      // },
    ],
    // [lastUpdate, recentEvents, totalEvents, whitelistCount]
    [recentEvents, totalEvents, whitelistCount]
  );

  return (
    <div className="grid gap-4 lg:grid-cols-5">
      <motion.div
        className="lg:col-span-2"
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4 }}
      >
        <Card className="relative h-full overflow-hidden rounded-3xl border border-emerald-200/60 bg-emerald-50/90 text-emerald-700 shadow-lg supports-[backdrop-filter]:backdrop-blur-lg dark:border-emerald-400/40 dark:bg-emerald-500/15 dark:text-emerald-100">
          <div className="pointer-events-none absolute -right-12 top-8 h-40 w-40 rounded-full bg-emerald-200/60 blur-3xl dark:bg-emerald-400/40" />
          <CardContent className="relative flex h-full flex-col justify-between p-0">
            <div className="flex items-center justify-between gap-6 p-6">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.18em] text-emerald-500 dark:text-emerald-200/80">
                  Estado en vivo
                </p>
                <h2 className="mt-2 text-3xl font-semibold text-emerald-800 dark:text-emerald-100">
                  {liveStatus.label}
                </h2>
                <p className="mt-1 text-sm text-emerald-700/80 dark:text-emerald-100/80">
                  {liveStatus.description}
                </p>
              </div>
              <span className="inline-flex h-16 w-16 items-center justify-center rounded-2xl border border-emerald-200/70 bg-white/70 text-emerald-600 shadow-sm dark:border-emerald-400/50 dark:bg-emerald-500/20 dark:text-emerald-100">
                <ShieldCheck className="h-8 w-8" />
              </span>
            </div>
            <div className="border-t border-emerald-200/60 bg-white/60 px-6 py-4 text-sm font-semibold uppercase tracking-[0.28em] text-emerald-500 dark:border-emerald-400/40 dark:bg-emerald-500/10 dark:text-emerald-100/80">
              <Badge
                variant="secondary"
                className="rounded-full border border-emerald-200/70 bg-white px-3 py-1 text-xs font-semibold uppercase tracking-[0.28em] text-emerald-600 shadow-sm dark:border-emerald-400/60 dark:bg-emerald-500/20 dark:text-emerald-100"
              >
                {liveStatus.chip}
              </Badge>
            </div>
          </CardContent>
        </Card>
      </motion.div>

      {statCards.map((card, index) => (
        <motion.div
          key={card.title}
          className="group"
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4, delay: 0.05 * (index + 1) }}
        >
          <Card className="relative overflow-hidden rounded-3xl border border-slate-200/70 bg-white/85 px-5 py-6 text-slate-900 shadow-lg transition-all duration-300 hover:-translate-y-1 supports-[backdrop-filter]:backdrop-blur-xl dark:border-white/10 dark:bg-white/5 dark:text-white">
            <div
              className={cn(
                "pointer-events-none absolute inset-x-6 inset-y-4 rounded-2xl bg-gradient-to-br opacity-0 blur-2xl transition-opacity duration-500 group-hover:opacity-100",
                card.accent
              )}
            />
            <div className="relative flex flex-col gap-4">
              <div className="flex items-center justify-between">
                <p className="text-[0.7rem] font-semibold uppercase tracking-[0.18em] text-slate-600 dark:text-slate-200">
                  {card.title}
                </p>
                <Badge
                  variant="secondary"
                  className="border border-slate-200 bg-slate-100 p-2 text-slate-700 shadow-sm dark:border-white/10 dark:bg-white/10 dark:text-white"
                >
                  {card.icon}
                </Badge>
              </div>
              <motion.span
                key={card.value}
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.35 }}
                className="text-3xl font-semibold tracking-tight text-slate-900 dark:text-white"
              >
                {card.value}
              </motion.span>
              <p className="text-xs text-slate-500 dark:text-slate-300">
                {card.description}
              </p>
            </div>
          </Card>
        </motion.div>
      ))}
    </div>
  );
}

export const StatsCards = memo(StatsCardsComponent);
