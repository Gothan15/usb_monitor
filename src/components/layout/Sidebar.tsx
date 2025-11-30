/**
 * Componente Sidebar
 * Sidebar de navegación fijo que permanece visible mientras se desplaza el contenido
 * Adaptable a móvil con menú hamburguesa
 */

"use client";

import { useMemo } from "react";
import { usePathname, useRouter } from "next/navigation";
import { motion } from "framer-motion";
import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";

export interface SidebarItem {
  key: string;
  label: string;
  description: string;
  icon: LucideIcon;
  href: string;
  badge?: string | number;
}

interface SidebarProps {
  items: SidebarItem[];
  isOpen?: boolean;
  onClose?: () => void;
  className?: string;
}

export function Sidebar({ items, isOpen = true, onClose, className }: SidebarProps) {
  const pathname = usePathname();
  const router = useRouter();

  const activeItem = useMemo(
    () => items.find((item) => pathname === item.href || pathname?.startsWith(item.href + "/")) ?? items[0],
    [pathname, items]
  );

  const handleNavigation = (item: SidebarItem) => {
    router.push(item.href);
    onClose?.();
  };

  return (
    <aside
      className={cn(
        "flex h-full w-64 flex-col border-r border-slate-200 bg-white transition-transform dark:border-slate-800 dark:bg-slate-900",
        !isOpen && "max-xl:-translate-x-full",
        className
      )}
    >
      {/* Logo/Header */}
      <div className="flex h-16 items-center border-b border-slate-200 px-4 dark:border-slate-800">
        <h1 className="text-lg font-semibold text-slate-900 dark:text-slate-100">
          Monitor USB
        </h1>
      </div>

      {/* Navigation Items */}
      <ScrollArea className="flex-1">
        <nav className="space-y-1 p-3">
          {items.map((item) => {
            const Icon = item.icon;
            const isActive = item.key === activeItem?.key;

            return (
              <motion.button
                key={item.key}
                onClick={() => handleNavigation(item)}
                className={cn(
                  "group relative w-full rounded-lg px-3 py-2.5 text-left transition-colors",
                  isActive
                    ? "bg-slate-900 text-white dark:bg-slate-700"
                    : "text-slate-700 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800"
                )}
                whileHover={{ scale: 1.02 }}
                whileTap={{ scale: 0.98 }}
              >
                {/* Active Indicator */}
                {isActive && (
                  <motion.div
                    layoutId="activeNav"
                    className="absolute inset-0 rounded-lg bg-slate-900 dark:bg-slate-700"
                    transition={{ type: "spring", bounce: 0.2, duration: 0.6 }}
                  />
                )}

                <div className="relative flex items-center gap-3">
                  <Icon
                    className={cn(
                      "h-5 w-5 shrink-0 transition-colors",
                      isActive
                        ? "text-white"
                        : "text-slate-500 group-hover:text-slate-700 dark:text-slate-400 dark:group-hover:text-slate-200"
                    )}
                  />
                  <div className="flex-1 overflow-hidden">
                    <div className="flex items-center justify-between gap-2">
                      <span
                        className={cn(
                          "truncate text-sm font-medium",
                          isActive ? "text-white" : ""
                        )}
                      >
                        {item.label}
                      </span>
                      {item.badge !== undefined && (
                        <Badge
                          variant={isActive ? "secondary" : "outline"}
                          className="shrink-0 text-xs"
                        >
                          {item.badge}
                        </Badge>
                      )}
                    </div>
                    <p
                      className={cn(
                        "truncate text-xs",
                        isActive
                          ? "text-slate-200"
                          : "text-slate-500 dark:text-slate-400"
                      )}
                    >
                      {item.description}
                    </p>
                  </div>
                </div>
              </motion.button>
            );
          })}
        </nav>
      </ScrollArea>
    </aside>
  );
}
