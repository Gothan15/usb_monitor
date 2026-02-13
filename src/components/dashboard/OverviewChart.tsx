"use client";

import {
  ResponsiveContainer,
  AreaChart,
  Area,
  Tooltip as ChartTooltip,
  XAxis,
  YAxis,
  CartesianGrid,
} from "recharts";

interface OverviewChartProps {
  data: {
    label: string;
    allowed: number;
    blocked: number;
    total: number;
  }[];
}

export default function OverviewChart({ data }: OverviewChartProps) {
  return (
    <ResponsiveContainer width="100%" height="100%">
      <AreaChart
        data={data}
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
        <CartesianGrid strokeDasharray="3 3" stroke="rgba(15,23,42,0.08)" />
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
              ? "Whitelisted"
              : name === "blocked"
              ? "Denegados/Apagado"
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
  );
}
