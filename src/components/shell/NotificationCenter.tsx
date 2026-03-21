"use client";

import {
  createContext,
  useCallback,
  useContext,
  useState,
  type ReactNode,
} from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Bell, Check, Trash2 } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { ScrollArea } from "@/components/ui/scroll-area";

/* ────── Types ────── */
export interface Notification {
  id: string;
  title: string;
  description?: string;
  icon?: LucideIcon;
  tone?: "default" | "success" | "warning" | "danger" | "info";
  read: boolean;
  timestamp: Date;
}

interface NotificationContextValue {
  notifications: Notification[];
  unreadCount: number;
  addNotification: (n: Omit<Notification, "id" | "read" | "timestamp">) => void;
  markAllRead: () => void;
  clearAll: () => void;
  dismissOne: (id: string) => void;
}

/* ────── Context ────── */
const NotificationContext = createContext<NotificationContextValue | null>(
  null,
);

export function useNotifications() {
  const ctx = useContext(NotificationContext);
  if (!ctx) {
    throw new Error("useNotifications must be within NotificationProvider");
  }
  return ctx;
}

/* ────── Provider ────── */
const MAX_NOTIFICATIONS = 50;

export function NotificationProvider({ children }: { children: ReactNode }) {
  const [notifications, setNotifications] = useState<Notification[]>([]);

  const addNotification = useCallback(
    (n: Omit<Notification, "id" | "read" | "timestamp">) => {
      const entry: Notification = {
        ...n,
        id: crypto.randomUUID(),
        read: false,
        timestamp: new Date(),
      };
      setNotifications((prev) => [entry, ...prev].slice(0, MAX_NOTIFICATIONS));
    },
    [],
  );

  const markAllRead = useCallback(() => {
    setNotifications((prev) => prev.map((n) => ({ ...n, read: true })));
  }, []);

  const clearAll = useCallback(() => setNotifications([]), []);

  const dismissOne = useCallback((id: string) => {
    setNotifications((prev) => prev.filter((n) => n.id !== id));
  }, []);

  const unreadCount = notifications.filter((n) => !n.read).length;

  return (
    <NotificationContext.Provider
      value={{
        notifications,
        unreadCount,
        addNotification,
        markAllRead,
        clearAll,
        dismissOne,
      }}
    >
      {children}
    </NotificationContext.Provider>
  );
}

/* ────── Bell + Panel ────── */
const toneColors: Record<string, string> = {
  default: "bg-muted-foreground/20",
  success: "bg-emerald-500/20 text-emerald-600 dark:text-emerald-400",
  warning: "bg-amber-500/20 text-amber-600 dark:text-amber-400",
  danger: "bg-rose-500/20 text-rose-600 dark:text-rose-400",
  info: "bg-slate-400/20 text-slate-600 dark:text-slate-300",
};

function timeAgo(date: Date): string {
  const seconds = Math.floor((Date.now() - date.getTime()) / 1000);
  if (seconds < 60) return "ahora";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  return `${Math.floor(hours / 24)}d`;
}

export function NotificationCenter() {
  const { notifications, unreadCount, markAllRead, clearAll, dismissOne } =
    useNotifications();
  const [open, setOpen] = useState(false);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="icon" className="relative size-8">
          <Bell className="size-3.5" />
          {unreadCount > 0 && (
            <motion.span
              initial={{ scale: 0 }}
              animate={{ scale: 1 }}
              className="absolute -right-0.5 -top-0.5 flex size-4 items-center justify-center rounded-full bg-primary text-[9px] font-bold text-primary-foreground"
            >
              {unreadCount > 9 ? "9+" : unreadCount}
            </motion.span>
          )}
        </Button>
      </PopoverTrigger>

      <PopoverContent
        align="end"
        sideOffset={8}
        className="w-80 p-0 bg-popover/95 backdrop-blur-xl border-border/60"
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-border/50 px-4 py-3">
          <h4 className="text-sm font-semibold">Notificaciones</h4>
          <div className="flex items-center gap-1">
            {unreadCount > 0 && (
              <Button
                variant="ghost"
                size="icon"
                className="size-7"
                onClick={markAllRead}
                title="Marcar todo como leído"
              >
                <Check className="size-3.5" />
              </Button>
            )}
            {notifications.length > 0 && (
              <Button
                variant="ghost"
                size="icon"
                className="size-7"
                onClick={clearAll}
                title="Limpiar todo"
              >
                <Trash2 className="size-3.5" />
              </Button>
            )}
          </div>
        </div>

        {/* List */}
        <ScrollArea className="max-h-80">
          {notifications.length === 0 ? (
            <div className="flex flex-col items-center gap-2 py-10 text-muted-foreground">
              <Bell className="size-8 opacity-30" />
              <p className="text-xs">Sin notificaciones</p>
            </div>
          ) : (
            <AnimatePresence initial={false}>
              {notifications.map((n) => {
                const Icon = n.icon;
                return (
                  <motion.button
                    key={n.id}
                    type="button"
                    initial={{ opacity: 0, height: 0 }}
                    animate={{ opacity: 1, height: "auto" }}
                    exit={{ opacity: 0, height: 0 }}
                    onClick={() => dismissOne(n.id)}
                    className={cn(
                      "group flex w-full items-start gap-3 border-b border-border/30 px-4 py-3 text-left transition-colors hover:bg-muted/40",
                      !n.read && "bg-primary/5",
                    )}
                  >
                    {/* Icon dot */}
                    <div
                      className={cn(
                        "mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-lg text-xs",
                        toneColors[n.tone ?? "default"],
                      )}
                    >
                      {Icon ? (
                        <Icon className="size-3.5" />
                      ) : (
                        <Bell className="size-3.5" />
                      )}
                    </div>

                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="truncate text-xs font-medium text-foreground">
                          {n.title}
                        </span>
                        {!n.read && (
                          <span className="size-1.5 shrink-0 rounded-full bg-primary" />
                        )}
                      </div>
                      {n.description && (
                        <p className="mt-0.5 truncate text-[11px] text-muted-foreground">
                          {n.description}
                        </p>
                      )}
                    </div>

                    <span className="shrink-0 text-[10px] text-muted-foreground/60">
                      {timeAgo(n.timestamp)}
                    </span>
                  </motion.button>
                );
              })}
            </AnimatePresence>
          )}
        </ScrollArea>
      </PopoverContent>
    </Popover>
  );
}
