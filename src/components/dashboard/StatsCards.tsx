"use client";

import { memo, useMemo } from "react";
import { motion } from "framer-motion";
import { cn } from "@/lib/utils";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Activity, AlertTriangle, ShieldCheck } from "lucide-react";

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
        label: "Sin agentes",
        description: "No hay equipos reportando",
        chip: "Offline",
        tone: "rose" as const,
      };
    }

    if (utilization < 60) {
      return {
        label: "Cobertura parcial",
        description: `${numberFormatter.format(
          activeComputers
        )} de ${numberFormatter.format(totalComputers)} activos`,
        chip: `${utilization}% online`,
        tone: "amber" as const,
      };
    }

    return {
      label: "Monitoreo estable",
      description: `${numberFormatter.format(
        activeComputers
      )} equipos bajo control`,
      chip: "En vivo",
      tone: "emerald" as const,
    };
  }, [activeComputers, totalComputers]);

  const statCards = useMemo(
    () => [
      {
        title: "Whitelist activos",
        description: "Seriales autorizados",
        value: numberFormatter.format(whitelistCount),
        icon: <ShieldCheck className="h-4 w-4" />,
        tone: "emerald" as const,
      },
      {
        title: "Eventos totales",
        description: "Registros acumulados",
        value: numberFormatter.format(totalEvents),
        icon: <Activity className="h-4 w-4" />,
        tone: "slate" as const,
      },
      {
        title: "Eventos recientes",
        description: "Últimos 60 minutos",
        value: numberFormatter.format(recentEvents),
        icon: <AlertTriangle className="h-4 w-4" />,
        tone: "amber" as const,
      },
    ],
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
        <Card className="relative h-full overflow-hidden rounded-2xl border bg-card/80 backdrop-blur-sm shadow-lg hover:shadow-xl transition-all duration-300">
          <CardContent className="flex h-full flex-col justify-between gap-6 p-6">
            <div className="flex items-center justify-between gap-6">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.22em] text-muted-foreground">
                  Estado en vivo
                </p>
                <h2 className="mt-2 text-3xl font-semibold tracking-tight">
                  {liveStatus.label}
                </h2>
                <p className="mt-2 text-sm text-muted-foreground">
                  {liveStatus.description}
                </p>
              </div>
              <span className="inline-flex h-16 w-16 items-center justify-center rounded-2xl bg-primary/10 text-primary shadow-sm">
                <ShieldCheck className="h-8 w-8" />
              </span>
            </div>
            <div className="flex items-center justify-between rounded-xl bg-muted/50 px-4 py-3 text-sm font-semibold shadow-sm">
              <span className="text-xs uppercase tracking-[0.28em] text-muted-foreground">
                Cobertura
              </span>
              <Badge
                variant="secondary"
                className={cn(
                  "rounded-full border px-3 py-1 text-[0.65rem] font-semibold uppercase tracking-[0.24em] shadow-sm",
                  liveStatus.tone === "emerald" &&
                    "border-emerald-400/60 bg-emerald-500/15 text-emerald-600 dark:text-emerald-300",
                  liveStatus.tone === "amber" &&
                    "border-amber-400/60 bg-amber-500/15 text-amber-600 dark:text-amber-300",
                  liveStatus.tone === "rose" &&
                    "border-rose-400/60 bg-rose-500/15 text-rose-600 dark:text-rose-300"
                )}
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
          <Card className="relative overflow-hidden rounded-2xl bg-card/80 backdrop-blur-sm shadow-lg hover:shadow-xl transition-all duration-300 hover:-translate-y-1 px-5 py-6">
            <div className="relative flex flex-col gap-4">
              <div className="flex items-center justify-between">
                <p className="text-[0.7rem] font-semibold uppercase tracking-[0.22em] text-muted-foreground">
                  {card.title}
                </p>
                <span
                  className={cn(
                    "inline-flex h-9 w-9 items-center justify-center rounded-xl shadow-sm transition-transform duration-200 group-hover:scale-110",
                    card.tone === "emerald" &&
                      "bg-emerald-500/15 text-emerald-600 dark:text-emerald-300",
                    card.tone === "amber" &&
                      "bg-amber-500/15 text-amber-600 dark:text-amber-300",
                    card.tone === "slate" &&
                      "bg-muted text-muted-foreground"
                  )}
                >
                  {card.icon}
                </span>
              </div>
              <motion.span
                key={card.value}
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.35 }}
                className="text-3xl font-semibold tracking-tight"
              >
                {card.value}
              </motion.span>
              <p className="text-xs text-muted-foreground">
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
