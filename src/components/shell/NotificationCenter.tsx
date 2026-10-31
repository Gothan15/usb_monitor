"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import { onNotification } from "@/lib/notificationBus";
import { AnimatePresence, motion } from "framer-motion";
import { Bell } from "lucide-react";
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

  // Avisos emitidos desde capas superiores del árbol (datos en vivo).
  useEffect(() => onNotification(addNotification), [addNotification]);

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

/* ────── Bell + Panel ──────
   Panel de papel a juego con el diseño: sin cristal ni cajitas de
   color; cada aviso es una línea de registro con un punto de tono. */
const toneDot: Record<string, string> = {
  default: "bg-muted-foreground/40",
  success: "bg-success",
  warning: "bg-warning",
  danger: "bg-destructive",
  info: "bg-[var(--acero)]",
};

function timeAgo(date: Date): string {
  const seconds = Math.floor((Date.now() - date.getTime()) / 1000);
  if (seconds < 60) return "ahora mismo";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `hace ${minutes} min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `hace ${hours} h`;
  const days = Math.floor(hours / 24);
  return days === 1 ? "hace 1 día" : `hace ${days} días`;
}

export function NotificationCenter() {
  const { notifications, unreadCount, markAllRead, clearAll, dismissOne } =
    useNotifications();
  const [open, setOpen] = useState(false);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="relative size-8"
          aria-label="Notificaciones"
        >
          <Bell className="size-4" />
          {unreadCount > 0 && (
            <motion.span
              initial={{ scale: 0 }}
              animate={{ scale: 1 }}
              className="absolute -right-0.5 -top-0.5 flex size-4 items-center justify-center rounded-full bg-[var(--acero)] text-[9px] font-bold text-white"
            >
              {unreadCount > 9 ? "9+" : unreadCount}
            </motion.span>
          )}
        </Button>
      </PopoverTrigger>

      <PopoverContent
        align="end"
        sideOffset={8}
        className="w-[21rem] border-border bg-popover p-0 shadow-md"
      >
        {/* Cabecera */}
        <div className="border-b border-border px-4 pb-2.5 pt-3.5">
          <div className="flex items-baseline justify-between">
            <h4 className="smallcaps text-foreground">Notificaciones</h4>
            {unreadCount > 0 && (
              <span className="font-mono text-[11px] text-[var(--acero)]">
                {unreadCount} sin leer
              </span>
            )}
          </div>
          {(unreadCount > 0 || notifications.length > 0) && (
            <div className="mt-1.5 flex items-center gap-4 text-[11px] font-medium">
              {unreadCount > 0 && (
                <button
                  type="button"
                  onClick={markAllRead}
                  className="text-muted-foreground transition-colors hover:text-foreground"
                >
                  Marcar leídas
                </button>
              )}
              {notifications.length > 0 && (
                <button
                  type="button"
                  onClick={clearAll}
                  className="text-muted-foreground transition-colors hover:text-destructive"
                >
                  Limpiar todo
                </button>
              )}
            </div>
          )}
        </div>

        {/* Lista */}
        <ScrollArea className="max-h-80">
          {notifications.length === 0 ? (
            <div className="px-4 py-9 text-center">
              <p className="text-[13px] text-muted-foreground">
                Sin notificaciones
              </p>
              <p className="mt-1 text-xs text-muted-foreground/70">
                Los avisos de seguridad aparecerán aquí.
              </p>
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
                    title="Pulsa para descartar"
                    className={cn(
                      "flex w-full items-start gap-3 border-b border-border/60 border-l-2 border-l-transparent px-4 py-3 text-left transition-colors last:border-b-0 hover:bg-muted/40",
                      !n.read && "border-l-[var(--acero)] bg-primary/[0.04]",
                    )}
                  >
                    <span
                      className={cn(
                        "mt-[7px] size-1.5 shrink-0 rounded-full",
                        toneDot[n.tone ?? "default"],
                      )}
                    />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-baseline gap-2">
                        {Icon && (
                          <Icon className="size-3.5 shrink-0 translate-y-0.5 text-muted-foreground" />
                        )}
                        <span
                          className={cn(
                            "text-[13px] leading-snug text-foreground",
                            !n.read && "font-semibold",
                          )}
                        >
                          {n.title}
                        </span>
                      </div>
                      {n.description && (
                        <p className="mt-0.5 line-clamp-2 text-xs leading-snug text-muted-foreground">
                          {n.description}
                        </p>
                      )}
                    </div>
                    <span className="shrink-0 text-[10.5px] text-muted-foreground/70">
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
