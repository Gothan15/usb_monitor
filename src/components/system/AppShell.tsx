"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { motion } from "framer-motion";
import type { LucideIcon } from "lucide-react";
import { Bell, Menu, RefreshCw, Search, LogOut, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { ThemeToggle } from "@/components/system/ThemeToggle";

export interface AppShellNavItem {
  key: string;
  label: string;
  description: string;
  icon: LucideIcon;
  badge?: string | number;
}

interface AppShellProps {
  navItems: AppShellNavItem[];
  activeKey: string;
  onNavigate: (key: string) => void;
  onRefresh?: () => void;
  refreshing?: boolean;
  onLogout?: () => void;
  lastUpdateLabel?: string;
  subtitle?: string;
  title?: string;
  user?: {
    name?: string | null;
    role?: string | null;
  } | null;
  children: React.ReactNode;
}

export function AppShell({
  navItems,
  activeKey,
  onNavigate,
  onRefresh,
  refreshing = false,
  onLogout,
  lastUpdateLabel,
  subtitle,
  title = "Panel corporativo",
  user,
  children,
}: AppShellProps) {
  const [isDesktop, setIsDesktop] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [isContentScrolling, setIsContentScrolling] = useState(false);
  const hideScrollbarTimeoutRef = useRef<number | null>(null);

  useEffect(() => {
    const query = window.matchMedia("(min-width: 1280px)");
    const handleChange = (event: MediaQueryListEvent) => {
      setIsDesktop(event.matches);
      if (event.matches) {
        setSidebarOpen(false);
      }
    };

    setIsDesktop(query.matches);
    query.addEventListener("change", handleChange);
    return () => query.removeEventListener("change", handleChange);
  }, []);

  const activeItem = useMemo(
    () => navItems.find((item) => item.key === activeKey) ?? navItems[0],
    [activeKey, navItems]
  );

  const toggleSidebar = () => {
    if (isDesktop) return;
    setSidebarOpen((prev) => !prev);
  };

  const closeSidebar = () => setSidebarOpen(false);

  const showScrollbars = () => {
    if (hideScrollbarTimeoutRef.current) {
      window.clearTimeout(hideScrollbarTimeoutRef.current);
      hideScrollbarTimeoutRef.current = null;
    }
    setIsContentScrolling(true);
  };

  const scheduleHideScrollbars = () => {
    if (hideScrollbarTimeoutRef.current) {
      window.clearTimeout(hideScrollbarTimeoutRef.current);
    }
    hideScrollbarTimeoutRef.current = window.setTimeout(() => {
      setIsContentScrolling(false);
      hideScrollbarTimeoutRef.current = null;
    }, 700);
  };

  const handleContentScroll = () => {
    showScrollbars();
    scheduleHideScrollbars();
  };

  const handleContentPointerEnter = () => {
    showScrollbars();
  };

  const handleContentPointerLeave = () => {
    scheduleHideScrollbars();
  };

  useEffect(() => {
    return () => {
      if (hideScrollbarTimeoutRef.current) {
        window.clearTimeout(hideScrollbarTimeoutRef.current);
      }
    };
  }, []);

  return (
    <div className="relative flex h-screen overflow-hidden bg-slate-100 text-slate-900 transition-colors dark:bg-slate-950 dark:text-slate-100">
      {!isDesktop && sidebarOpen && (
        <button
          type="button"
          onClick={closeSidebar}
          className="fixed inset-0 z-30 bg-slate-950/60 backdrop-blur-sm"
          aria-label="Cerrar menú"
        />
      )}
      <aside
        className={cn(
          "z-40 flex h-full w-72 flex-shrink-0 flex-col border-r border-slate-200/70 bg-white/85 px-6 pb-8 pt-6 shadow-2xl backdrop-blur-lg transition-transform duration-300 dark:border-slate-800/80 dark:bg-slate-950/80",
          "supports-[backdrop-filter]:bg-white/70 supports-[backdrop-filter]:dark:bg-slate-950/70",
          !isDesktop && "fixed inset-y-0 left-0",
          !isDesktop && !sidebarOpen && "-translate-x-full",
          isDesktop && "shadow-none",
          "xl:static xl:translate-x-0"
        )}
      >
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <span className="flex h-11 w-11 items-center justify-center rounded-2xl border border-slate-200/60 bg-white text-slate-700 shadow-sm dark:border-slate-800 dark:bg-slate-900 dark:text-slate-100">
              <activeItem.icon className="h-5 w-5" />
            </span>
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-[0.32em] text-slate-500 dark:text-slate-400">
                USB Monitor
              </p>
              <p className="text-sm font-semibold text-slate-800 dark:text-white">
                Gestión centralizada
              </p>
            </div>
          </div>
          {!isDesktop && (
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="h-9 w-9 rounded-full border border-slate-200/70 bg-white text-slate-500 hover:bg-slate-100 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-200"
              onClick={closeSidebar}
            >
              <X className="h-4 w-4" />
            </Button>
          )}
        </div>

        <nav className="mt-8 flex-1 space-y-1 overflow-y-auto pr-2 [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden">
          {navItems.map((item) => {
            const isActive = item.key === activeItem.key;
            const button = (
              <motion.button
                key={item.key}
                type="button"
                onClick={() => {
                  onNavigate(item.key);
                  closeSidebar();
                }}
                whileHover={{ x: 4 }}
                whileTap={{ scale: 0.98 }}
                className={cn(
                  "group relative flex w-full items-center gap-3 rounded-2xl border border-transparent px-3 py-2 text-left text-sm font-medium transition-colors",
                  isActive
                    ? "border-slate-300/70 bg-slate-100/80 text-slate-900 shadow-sm dark:border-slate-700/80 dark:bg-slate-800/60 dark:text-white"
                    : "text-slate-500 hover:border-slate-300/60 hover:bg-white hover:text-slate-800 dark:text-slate-300 dark:hover:border-slate-700/60 dark:hover:bg-slate-900/60 dark:hover:text-slate-100"
                )}
              >
                <span
                  className={cn(
                    "flex h-9 w-9 items-center justify-center rounded-xl border border-slate-200/60 bg-white text-slate-600 shadow-sm transition-colors dark:border-slate-700/70 dark:bg-slate-900 dark:text-slate-300",
                    isActive &&
                      "border-slate-300 bg-slate-50 text-slate-900 dark:border-slate-600 dark:bg-slate-800 dark:text-white"
                  )}
                >
                  <item.icon className="h-4 w-4" />
                </span>
                <div className="flex flex-1 flex-col">
                  <span className="text-sm font-semibold tracking-tight">
                    {item.label}
                  </span>
                  <span className="text-xs text-slate-400 dark:text-slate-400/80">
                    {item.description}
                  </span>
                </div>
                {item.badge && (
                  <span className="ml-auto inline-flex min-w-[24px] items-center justify-center rounded-full border border-slate-200 bg-white px-2 text-xs font-semibold text-slate-600 shadow-sm dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200">
                    {item.badge}
                  </span>
                )}
              </motion.button>
            );

            return (
              <Tooltip key={item.key} disableHoverableContent={isDesktop}>
                <TooltipTrigger asChild>{button}</TooltipTrigger>
                <TooltipContent side="right">{item.label}</TooltipContent>
              </Tooltip>
            );
          })}
        </nav>

        <div className="mt-6 rounded-2xl border border-slate-200/70 bg-white/70 p-4 text-xs text-slate-500 shadow-sm dark:border-slate-800/80 dark:bg-slate-900/60 dark:text-slate-300">
          <p className="font-semibold uppercase tracking-[0.28em]">
            Última sync
          </p>
          <p className="mt-2 text-sm font-medium text-slate-700 dark:text-slate-100">
            {lastUpdateLabel || "Sin datos"}
          </p>
        </div>
      </aside>

      <div className="relative flex flex-1 flex-col overflow-hidden">
        <header className="z-20 flex flex-shrink-0 border-b border-slate-200/70 bg-white/75 backdrop-blur-xl shadow-sm transition-colors dark:border-slate-800/70 dark:bg-slate-950/75">
          <div className="mx-auto flex w-full max-w-7xl items-center justify-between gap-6 px-4 py-4 sm:px-6 lg:px-10">
            <div className="flex flex-1 items-center gap-4">
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="h-10 w-10 rounded-full border border-slate-200/60 bg-white text-slate-600 hover:bg-slate-100 lg:hidden dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200"
                onClick={toggleSidebar}
              >
                <Menu className="h-5 w-5" />
              </Button>
              <div className="hidden flex-col lg:flex">
                <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.3em] text-slate-400 dark:text-slate-500">
                  <activeItem.icon className="h-3.5 w-3.5" />
                  {activeItem.label}
                </div>
                <h1 className="text-2xl font-semibold tracking-tight text-slate-900 dark:text-white">
                  {title}
                </h1>
                <p className="text-sm text-slate-500 dark:text-slate-400">
                  {subtitle || activeItem.description}
                </p>
              </div>
            </div>

            <div className="flex flex-1 items-center justify-end gap-3">
              <div className="relative hidden max-w-sm flex-1 items-center md:flex">
                <Search className="absolute left-3 h-4 w-4 text-slate-400" />
                <Input
                  placeholder="Buscar dispositivos, IP o usuarios"
                  className="w-full rounded-full border border-slate-200/70 bg-white pl-10 text-sm text-slate-600 shadow-sm dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200"
                />
              </div>
              <div className="flex items-center gap-2">
                {onRefresh && (
                  <Button
                    type="button"
                    size="sm"
                    disabled={refreshing}
                    onClick={onRefresh}
                    className="hidden items-center gap-2 rounded-full border border-slate-200/80 bg-white px-4 text-sm font-medium text-slate-700 shadow-sm hover:bg-slate-100 disabled:opacity-70 md:flex dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200"
                  >
                    <RefreshCw
                      className={cn(
                        "h-4 w-4 text-slate-500",
                        refreshing && "animate-spin"
                      )}
                    />
                    {refreshing ? "Sincronizando" : "Sincronizar"}
                  </Button>
                )}
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="relative h-10 w-10 rounded-full border border-slate-200/70 bg-white text-slate-600 hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200"
                >
                  <Bell className="h-4 w-4" />
                  <span className="absolute right-2 top-2 inline-flex h-2 w-2 items-center justify-center rounded-full bg-emerald-500" />
                </Button>
                <ThemeToggle />
                <div className="hidden items-center gap-3 rounded-full border border-slate-200/70 bg-white px-4 py-2 text-sm shadow-sm md:flex dark:border-slate-700 dark:bg-slate-900">
                  <div className="flex h-8 w-8 items-center justify-center rounded-full bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-200">
                    {user?.name ? user.name.slice(0, 2).toUpperCase() : "US"}
                  </div>
                  <div className="flex flex-col leading-tight">
                    <span className="font-medium text-slate-700 dark:text-slate-100">
                      {user?.name ?? "Usuario"}
                    </span>
                    <span className="text-xs uppercase tracking-[0.24em] text-slate-400 dark:text-slate-500">
                      {user?.role ?? "Admin"}
                    </span>
                  </div>
                </div>
                {onLogout && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    onClick={onLogout}
                    className="h-10 w-10 rounded-full border border-slate-200/70 bg-white text-slate-600 hover:bg-slate-100 md:h-10 md:w-10 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200"
                  >
                    <LogOut className="h-4 w-4" />
                  </Button>
                )}
              </div>
            </div>
          </div>

          <div className="px-4 pb-4 lg:hidden">
            <div className="rounded-2xl border border-slate-200/70 bg-white px-4 py-3 text-sm text-slate-600 shadow-sm dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300">
              <div className="text-xs font-semibold uppercase tracking-[0.28em] text-slate-400 dark:text-slate-500">
                {activeItem.label}
              </div>
              <div className="mt-2 text-slate-700 dark:text-slate-100">
                {title}
              </div>
              <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                {subtitle || activeItem.description}
              </p>
            </div>
          </div>
        </header>

        <div className="relative flex flex-1 overflow-hidden">
          <main
            onScroll={handleContentScroll}
            onMouseEnter={handleContentPointerEnter}
            onMouseLeave={handleContentPointerLeave}
            onFocusCapture={handleContentPointerEnter}
            onBlurCapture={handleContentPointerLeave}
            className={cn(
              "flex-1 overflow-y-auto px-4 pb-12 pt-8 sm:px-6 lg:px-10 scrollbar-ambient",
              isContentScrolling ? "scrollbar-active" : "scrollbar-idle"
            )}
          >
            <div className="mx-auto flex w-full max-w-7xl flex-col gap-8">
              {children}
            </div>
          </main>
        </div>
      </div>
    </div>
  );
}
