"use client";

import * as React from "react";
import { cn } from "@/lib/utils";
import { GlassPanel } from "@/components/ui/glass-panel";
import { ArrowDown, ArrowUp, Minus, type LucideIcon } from "lucide-react";

type TrendDirection = "up" | "down" | "neutral";
type StatusTone = "default" | "success" | "warning" | "danger" | "info";

interface StatCardProps {
  title: string;
  value: string | number;
  subtitle?: string;
  icon?: React.ReactNode;
  trend?: {
    value: string | number;
    direction: TrendDirection;
    label?: string;
  };
  tone?: StatusTone;
  sparklineData?: number[];
  className?: string;
  onClick?: () => void;
}

const toneConfig: Record<
  StatusTone,
  { icon: string; glow: string; accentBorder: string }
> = {
  default: {
    icon: "text-muted-foreground",
    glow: "",
    accentBorder: "",
  },
  success: {
    icon: "text-success",
    glow: "glow-success",
    accentBorder: "border-l-success",
  },
  warning: {
    icon: "text-warning",
    glow: "glow-warning",
    accentBorder: "border-l-warning",
  },
  danger: {
    icon: "text-destructive",
    glow: "glow-danger",
    accentBorder: "border-l-destructive",
  },
  info: {
    icon: "text-info",
    glow: "glow-accent",
    accentBorder: "border-l-info",
  },
};

const trendIcons: Record<TrendDirection, LucideIcon> = {
  up: ArrowUp,
  down: ArrowDown,
  neutral: Minus,
};

const trendColors: Record<TrendDirection, string> = {
  up: "text-success",
  down: "text-destructive",
  neutral: "text-muted-foreground",
};

function MiniSparkline({
  data,
  className,
}: {
  data: number[];
  className?: string;
}) {
  if (data.length < 2) return null;

  const max = Math.max(...data);
  const min = Math.min(...data);
  const range = max - min || 1;
  const h = 24;
  const w = 64;
  const step = w / (data.length - 1);

  const points = data
    .map((v, i) => `${i * step},${h - ((v - min) / range) * h}`)
    .join(" ");

  return (
    <svg
      viewBox={`0 0 ${w} ${h}`}
      className={cn("text-primary/50", className)}
      fill="none"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <polyline
        points={points}
        stroke="currentColor"
        strokeWidth="1.5"
        fill="none"
      />
    </svg>
  );
}

export function StatCard({
  title,
  value,
  subtitle,
  icon,
  trend,
  tone = "default",
  sparklineData,
  className,
  onClick,
}: StatCardProps) {
  const config = toneConfig[tone];
  const TrendIcon = trend ? trendIcons[trend.direction] : null;

  return (
    <GlassPanel
      variant="default"
      padding="default"
      className={cn(
        "relative group border-l-2 border-l-transparent",
        tone !== "default" && config.accentBorder,
        onClick && "cursor-pointer hover:scale-[1.01] active:scale-[0.99]",
        className,
      )}
      onClick={onClick}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
            {title}
          </p>
          <p className="mt-1 text-2xl font-semibold tracking-tight text-foreground tabular-nums font-display">
            {value}
          </p>
          {subtitle && (
            <p className="mt-0.5 text-xs text-muted-foreground truncate">
              {subtitle}
            </p>
          )}
          {trend && TrendIcon && (
            <div
              className={cn(
                "mt-1.5 inline-flex items-center gap-1 text-xs font-medium",
                trendColors[trend.direction],
              )}
            >
              <TrendIcon className="size-3" />
              <span>{trend.value}</span>
              {trend.label && (
                <span className="text-muted-foreground font-normal">
                  {trend.label}
                </span>
              )}
            </div>
          )}
        </div>

        <div className="flex flex-col items-end gap-2">
          {icon && (
            <div
              className={cn(
                "flex size-9 items-center justify-center rounded-lg bg-muted/50 transition-colors",
                config.icon,
              )}
            >
              {icon}
            </div>
          )}
          {sparklineData && sparklineData.length > 1 && (
            <MiniSparkline data={sparklineData} className="size-16" />
          )}
        </div>
      </div>
    </GlassPanel>
  );
}
