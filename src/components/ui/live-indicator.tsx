"use client";

import { cn } from "@/lib/utils";

type LiveStatus = "connected" | "reconnecting" | "disconnected";

interface LiveIndicatorProps {
  status?: LiveStatus;
  label?: string;
  className?: string;
  showLabel?: boolean;
  size?: "sm" | "md" | "lg";
}

const statusConfig: Record<
  LiveStatus,
  { color: string; label: string; pulse: boolean }
> = {
  connected: {
    color: "bg-success",
    label: "En vivo",
    pulse: true,
  },
  reconnecting: {
    color: "bg-warning",
    label: "Reconectando",
    pulse: true,
  },
  disconnected: {
    color: "bg-muted-foreground/40",
    label: "Desconectado",
    pulse: false,
  },
};

const sizeMap = {
  sm: "size-1.5",
  md: "size-2",
  lg: "size-2.5",
};

export function LiveIndicator({
  status = "connected",
  label,
  className,
  showLabel = true,
  size = "md",
}: LiveIndicatorProps) {
  const config = statusConfig[status];
  const displayLabel = label ?? config.label;

  return (
    <span
      data-slot="live-indicator"
      className={cn("inline-flex items-center gap-1.5", className)}
    >
      <span className="relative inline-flex">
        <span className={cn("rounded-full", sizeMap[size], config.color)} />
        {config.pulse && (
          <span
            className={cn(
              "absolute inset-0 rounded-full animate-ping",
              config.color,
              "opacity-40",
            )}
          />
        )}
      </span>
      {showLabel && (
        <span className="text-xs font-medium text-muted-foreground">
          {displayLabel}
        </span>
      )}
    </span>
  );
}
