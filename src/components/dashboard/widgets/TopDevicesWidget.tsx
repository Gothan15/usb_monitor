"use client";

import { useMemo } from "react";
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip as ChartTooltip,
} from "recharts";
import type { USBEvent } from "@/components/dashboard/types";

interface TopDevicesWidgetProps {
  events: USBEvent[];
  maxItems?: number;
}

export function TopDevicesWidget({
  events,
  maxItems = 6,
}: TopDevicesWidgetProps) {
  const data = useMemo(() => {
    const counts = new Map<string, number>();
    events.forEach((ev) => {
      const serial = ev.serialNumber?.trim();
      if (!serial) return;
      counts.set(serial, (counts.get(serial) ?? 0) + 1);
    });
    return [...counts.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, maxItems)
      .map(([serial, count]) => ({
        serial: serial.length > 12 ? serial.slice(0, 12) + "…" : serial,
        count,
      }));
  }, [events, maxItems]);

  if (data.length === 0) {
    return (
      <div className="flex h-[220px] items-center justify-center">
        <p className="text-xs text-muted-foreground">Sin datos</p>
      </div>
    );
  }

  return (
    <div className="h-[220px] px-2 pb-2">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart
          data={data}
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
    </div>
  );
}
