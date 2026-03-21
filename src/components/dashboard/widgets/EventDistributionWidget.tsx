"use client";

import { useMemo } from "react";
import { GlassPanel } from "@/components/ui/glass-panel";
import { Badge } from "@/components/ui/badge";
import {
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
  Tooltip as ChartTooltip,
  Legend,
} from "recharts";
import type { USBEvent, WhitelistEntry } from "@/components/dashboard/types";

interface EventDistributionWidgetProps {
  events: USBEvent[];
  whitelist: WhitelistEntry[];
}

function classifyEventTone(message: string) {
  const normalized = message.toLowerCase();
  if (
    normalized.includes("deneg") ||
    normalized.includes("fail") ||
    normalized.includes("bloque")
  )
    return "blocked" as const;
  if (
    normalized.includes("permit") ||
    normalized.includes("desbloque") ||
    normalized.includes("readonly removido")
  )
    return "allowed" as const;
  return "neutral" as const;
}

export function EventDistributionWidget({
  events,
  whitelist,
}: EventDistributionWidgetProps) {
  const data = useMemo(() => {
    let allowed = 0;
    let blocked = 0;
    let neutral = 0;

    const wlSerials = new Set(
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
            ? wlSerials.has(ev.serialNumber.trim().toLowerCase())
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

  return (
    <div className="flex h-[220px] items-center justify-center px-2">
      {data.length === 0 ? (
        <p className="text-xs text-muted-foreground">Sin datos</p>
      ) : (
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie
              data={data}
              dataKey="value"
              nameKey="name"
              cx="50%"
              cy="50%"
              innerRadius={45}
              outerRadius={72}
              paddingAngle={3}
              strokeWidth={0}
            >
              {data.map((entry) => (
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
              height={30}
              formatter={(value: string) => (
                <span className="text-[10px] text-muted-foreground">
                  {value}
                </span>
              )}
            />
          </PieChart>
        </ResponsiveContainer>
      )}
    </div>
  );
}
