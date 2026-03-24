"use client";

import { useMemo } from "react";
import { cn } from "@/lib/utils";
import type { Computer } from "@/components/dashboard/types";
import { Wifi, WifiOff } from "lucide-react";

interface FleetStatusWidgetProps {
  computers: Computer[];
}

function timeSince(dateStr: string | null): string {
  if (!dateStr) return "Sin datos";
  const diff = Date.now() - new Date(dateStr).getTime();
  const minutes = Math.floor(diff / 60000);
  if (minutes < 1) return "ahora";
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  return `${Math.floor(hours / 24)}d`;
}

export function FleetStatusWidget({ computers }: FleetStatusWidgetProps) {
  const sorted = useMemo(
    () =>
      [...computers].sort((a, b) => {
        if (a.isActive !== b.isActive) return a.isActive ? -1 : 1;
        return (
          new Date(b.lastSeen ?? 0).getTime() -
          new Date(a.lastSeen ?? 0).getTime()
        );
      }),
    [computers],
  );

  if (sorted.length === 0) {
    return (
      <div className="flex h-[200px] items-center justify-center">
        <p className="text-xs text-muted-foreground">Sin equipos registrados</p>
      </div>
    );
  }

  return (
    <div className="max-h-[260px] divide-y divide-border/20 overflow-y-auto scrollbar-thin">
      {sorted.slice(0, 10).map((pc) => (
        <div
          key={pc.id}
          className="flex items-center gap-3 px-4 py-2.5 transition-colors hover:bg-muted/20"
        >
          <div
            className={cn(
              "flex size-8 items-center justify-center rounded-lg",
              pc.isActive
                ? "bg-[oklch(0.75_0.12_160/0.12)] text-[oklch(0.55_0.12_160)]"
                : "bg-muted/50 text-muted-foreground/50",
            )}
          >
            {pc.isActive ? (
              <Wifi className="size-3.5" />
            ) : (
              <WifiOff className="size-3.5" />
            )}
          </div>
          <div className="min-w-0 flex-1">
            <p className="truncate text-xs font-semibold text-foreground">
              {pc.name}
            </p>
            <p className="text-[10px] font-mono text-muted-foreground/60">
              {pc.ipAddress}
            </p>
          </div>
          <div className="text-right">
            <span
              className={cn(
                "inline-flex items-center gap-1 text-[10px] font-medium",
                pc.isActive ? "text-[oklch(0.55_0.12_160)]" : "text-muted-foreground/50",
              )}
            >
              <span
                className={cn(
                  "size-1.5 rounded-full",
                  pc.isActive
                    ? "bg-[oklch(0.55_0.12_160)] animate-pulse"
                    : "bg-muted-foreground/30",
                )}
              />
              {pc.isActive ? "Online" : "Offline"}
            </span>
            <p className="text-[10px] font-mono text-muted-foreground/40">
              {timeSince(pc.lastSeen)}
            </p>
          </div>
        </div>
      ))}
    </div>
  );
}
