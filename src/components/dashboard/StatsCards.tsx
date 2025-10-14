"use client";

import { memo, useMemo } from "react";
import { motion } from "framer-motion";
import { cn } from "@/lib/utils";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Activity, AlertTriangle, MonitorCheck, RefreshCw } from "lucide-react";

interface Props {
  activeComputers: number;
  totalComputers: number;
  totalEvents: number;
  recentEvents: number;
  lastUpdate: Date;
}

interface StatCardConfig {
  title: string;
  description: string;
  value: string;
  icon: React.ReactNode;
  accentLight: string;
  accentDark: string;
  gradientLight: string;
  gradientDark: string;
}

const numberFormatter = new Intl.NumberFormat("es-ES");

function StatsCardsComponent({
  activeComputers,
  totalComputers,
  totalEvents,
  recentEvents,
  lastUpdate,
}: Props) {
  const statCards = useMemo<StatCardConfig[]>(
    () => [
      {
        title: "Computadoras activas",
        description: `de ${numberFormatter.format(
          totalComputers
        )} monitoreadas`,
        value: numberFormatter.format(activeComputers),
        icon: <MonitorCheck className="size-4" />,
        accentLight: "border-emerald-200 bg-emerald-50/90 text-emerald-600",
        accentDark:
          "dark:border-emerald-400/30 dark:bg-emerald-500/15 dark:text-emerald-100",
        gradientLight: "from-emerald-200/60 via-emerald-100/40 to-transparent",
        gradientDark:
          "dark:from-emerald-500/20 dark:via-emerald-400/10 dark:to-transparent",
      },
      {
        title: "Eventos totales",
        description: "registros acumulados",
        value: numberFormatter.format(totalEvents),
        icon: <Activity className="size-4" />,
        accentLight: "border-indigo-200 bg-indigo-50/90 text-indigo-600",
        accentDark:
          "dark:border-indigo-400/30 dark:bg-indigo-500/15 dark:text-indigo-100",
        gradientLight: "from-indigo-200/50 via-sky-100/40 to-transparent",
        gradientDark:
          "dark:from-indigo-500/20 dark:via-sky-400/10 dark:to-transparent",
      },
      {
        title: "Eventos recientes",
        description: "registrados en la última hora",
        value: numberFormatter.format(recentEvents),
        icon: <AlertTriangle className="size-4" />,
        accentLight: "border-amber-200 bg-amber-50/90 text-amber-600",
        accentDark:
          "dark:border-amber-400/30 dark:bg-amber-500/15 dark:text-amber-100",
        gradientLight: "from-amber-200/60 via-orange-100/40 to-transparent",
        gradientDark:
          "dark:from-amber-400/25 dark:via-orange-400/10 dark:to-transparent",
      },
      {
        title: "Última sincronización",
        description: "auto-refresco cada 30 segundos",
        value: new Intl.DateTimeFormat("es-ES", {
          hour: "2-digit",
          minute: "2-digit",
          second: "2-digit",
        }).format(lastUpdate),
        icon: <RefreshCw className="size-4" />,
        accentLight: "border-sky-200 bg-sky-50/90 text-sky-600",
        accentDark:
          "dark:border-sky-400/30 dark:bg-sky-500/15 dark:text-sky-100",
        gradientLight: "from-sky-200/60 via-blue-100/40 to-transparent",
        gradientDark:
          "dark:from-sky-400/25 dark:via-blue-500/10 dark:to-transparent",
      },
    ],
    [activeComputers, totalComputers, totalEvents, recentEvents, lastUpdate]
  );

  return (
    <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
      {statCards.map((card, index) => (
        <motion.div
          key={card.title}
          className="group"
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4, delay: index * 0.05 }}
        >
          <Card className="relative overflow-hidden border border-slate-200/70 bg-white/85 text-slate-900 shadow-lg transition-all duration-300 hover:-translate-y-1 hover:shadow-xl supports-[backdrop-filter]:backdrop-blur-xl dark:border-white/10 dark:bg-white/5 dark:text-white">
            <div
              className={cn(
                "pointer-events-none absolute inset-x-6 inset-y-4 rounded-2xl bg-gradient-to-br opacity-0 blur-2xl transition-opacity duration-500 group-hover:opacity-100",
                card.gradientLight,
                card.gradientDark
              )}
            />
            <CardHeader className="relative z-10 flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-[0.7rem] font-semibold uppercase tracking-[0.18em] text-slate-600 dark:text-slate-200">
                {card.title}
              </CardTitle>
              <Badge
                variant="secondary"
                className={cn(
                  "border px-2 py-1 text-[0.65rem] font-semibold uppercase tracking-wide transition-colors duration-300",
                  card.accentLight,
                  card.accentDark,
                  "backdrop-blur"
                )}
              >
                {card.icon}
              </Badge>
            </CardHeader>
            <CardContent className="relative z-10 space-y-3">
              <motion.div
                key={card.value}
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.4, delay: 0.1 }}
                className="text-3xl font-semibold tracking-tight text-slate-900 dark:text-white"
              >
                {card.value}
              </motion.div>
              <p className="text-xs font-medium text-slate-500 dark:text-slate-300">
                {card.description}
              </p>
            </CardContent>
          </Card>
        </motion.div>
      ))}
    </div>
  );
}

export const StatsCards = memo(StatsCardsComponent);
