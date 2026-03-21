"use client";

import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { cn } from "@/lib/utils";
import { GlassPanel } from "@/components/ui/glass-panel";
import { LiveIndicator } from "@/components/ui/live-indicator";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useLiveData } from "@/components/providers/LiveDataProvider";
import { ArrowDown, Trash2, Usb } from "lucide-react";
import type { SocketUSBEvent } from "@/hooks/useSocketEvents";

type DisplayMode = "compact" | "full";

interface ActivityFeedProps {
  /** Max items to show (default 20) */
  maxItems?: number;
  /** Layout mode */
  mode?: DisplayMode;
  /** Extra className */
  className?: string;
  /** Filter function to only show certain events */
  filter?: (event: SocketUSBEvent) => boolean;
  /** Whether to show the header with connection status */
  showHeader?: boolean;
}

function classifyEvent(message: string) {
  const normalized = message.toLowerCase();
  if (
    normalized.includes("deneg") ||
    normalized.includes("fail") ||
    normalized.includes("bloque")
  ) {
    return "blocked" as const;
  }
  if (
    normalized.includes("permit") ||
    normalized.includes("desbloque") ||
    normalized.includes("readonly removido")
  ) {
    return "allowed" as const;
  }
  return "neutral" as const;
}

const dotColors = {
  blocked: "bg-rose-500",
  allowed: "bg-emerald-500",
  neutral: "bg-muted-foreground/50",
} as const;

function formatRelativeTime(isoString: string): string {
  const diff = Date.now() - new Date(isoString).getTime();
  const seconds = Math.floor(diff / 1000);
  if (seconds < 5) return "ahora";
  if (seconds < 60) return `hace ${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `hace ${minutes}m`;
  const hours = Math.floor(minutes / 60);
  return `hace ${hours}h`;
}

export function ActivityFeed({
  maxItems = 20,
  mode = "compact",
  className,
  filter,
  showHeader = true,
}: ActivityFeedProps) {
  const { liveEvents, connectionStatus, clearLiveEvents, liveEventCount } =
    useLiveData();

  const listRef = useRef<HTMLDivElement>(null);
  const [isScrolledUp, setIsScrolledUp] = useState(false);
  const [newCount, setNewCount] = useState(0);

  const events = filter ? liveEvents.filter(filter) : liveEvents;
  const visibleEvents = events.slice(0, maxItems);

  // Track when user scrolls away from top
  useEffect(() => {
    const el = listRef.current;
    if (!el) return;
    const handleScroll = () => {
      setIsScrolledUp(el.scrollTop > 60);
    };
    el.addEventListener("scroll", handleScroll, { passive: true });
    return () => el.removeEventListener("scroll", handleScroll);
  }, []);

  // Count new events while scrolled up
  useEffect(() => {
    if (isScrolledUp) {
      setNewCount((prev) => prev + 1);
    } else {
      setNewCount(0);
    }
  }, [liveEventCount, isScrolledUp]);

  const scrollToTop = () => {
    listRef.current?.scrollTo({ top: 0, behavior: "smooth" });
    setNewCount(0);
  };

  return (
    <GlassPanel
      variant="elevated"
      padding="none"
      className={cn("flex flex-col overflow-hidden", className)}
    >
      {/* Header */}
      {showHeader && (
        <div className="flex items-center justify-between gap-2 border-b border-border/50 px-4 py-3">
          <div className="flex items-center gap-2">
            <Usb className="size-4 text-primary" />
            <h3 className="text-sm font-semibold text-foreground">
              Actividad en vivo
            </h3>
            <LiveIndicator status={connectionStatus} size="sm" showLabel />
          </div>
          <div className="flex items-center gap-1.5">
            {liveEventCount > 0 && (
              <Badge variant="secondary" className="text-[10px] tabular-nums">
                {liveEventCount}
              </Badge>
            )}
            {visibleEvents.length > 0 && (
              <Button
                variant="ghost"
                size="icon"
                className="size-7"
                onClick={clearLiveEvents}
              >
                <Trash2 className="size-3" />
              </Button>
            )}
          </div>
        </div>
      )}

      {/* Event list */}
      <div
        ref={listRef}
        className="relative flex-1 overflow-y-auto scrollbar-thin"
      >
        {visibleEvents.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-2 py-12 text-muted-foreground">
            <Usb className="size-6 opacity-20" />
            <p className="text-xs">Esperando eventos en tiempo real…</p>
          </div>
        ) : (
          <AnimatePresence initial={false}>
            {visibleEvents.map((event) => {
              const tone = classifyEvent(event.event);
              return (
                <motion.div
                  key={event.id}
                  initial={{ opacity: 0, height: 0, y: -8 }}
                  animate={{ opacity: 1, height: "auto", y: 0 }}
                  exit={{ opacity: 0, height: 0 }}
                  transition={{ duration: 0.25, ease: [0.16, 1, 0.3, 1] }}
                  className="border-b border-border/20"
                >
                  <div
                    className={cn(
                      "flex gap-3 px-4 py-2.5 transition-colors hover:bg-muted/20",
                      mode === "full" && "py-3",
                    )}
                  >
                    {/* Timeline dot */}
                    <div className="relative flex flex-col items-center pt-1.5">
                      <span
                        className={cn(
                          "size-2 rounded-full shrink-0",
                          dotColors[tone],
                        )}
                      />
                      <div className="mt-1 w-px flex-1 bg-border/30" />
                    </div>

                    {/* Content */}
                    <div className="min-w-0 flex-1">
                      <div className="flex items-baseline gap-2">
                        <span className="text-xs font-semibold text-foreground truncate">
                          {event.pcName}
                        </span>
                        <span className="text-[10px] text-muted-foreground/60">
                          ·
                        </span>
                        <span className="text-[10px] text-muted-foreground truncate">
                          {event.pcUser}
                        </span>
                        <span className="ml-auto shrink-0 text-[10px] font-mono text-muted-foreground/50">
                          {formatRelativeTime(event.createdAt)}
                        </span>
                      </div>
                      <p className="mt-0.5 text-[11px] text-muted-foreground truncate leading-relaxed">
                        {event.event}
                      </p>
                      {mode === "full" && event.serialNumber && (
                        <p className="mt-0.5 font-mono text-[10px] text-muted-foreground/60">
                          SN: {event.serialNumber}
                        </p>
                      )}
                    </div>
                  </div>
                </motion.div>
              );
            })}
          </AnimatePresence>
        )}

        {/* "New events" FAB */}
        <AnimatePresence>
          {isScrolledUp && newCount > 0 && (
            <motion.div
              initial={{ opacity: 0, scale: 0.8, y: 8 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.8, y: 8 }}
              className="sticky top-2 z-10 flex justify-center pointer-events-none"
            >
              <Button
                size="sm"
                className="pointer-events-auto gap-1.5 rounded-full shadow-lg"
                onClick={scrollToTop}
              >
                <ArrowDown className="size-3 rotate-180" />
                {newCount} nuevos
              </Button>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </GlassPanel>
  );
}
