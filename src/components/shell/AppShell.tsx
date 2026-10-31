"use client";

import { useEffect, useMemo, useState, useRef, type ReactNode } from "react";
import Link from "next/link";
import Image from "next/image";
import { motion, AnimatePresence } from "framer-motion";
import type { LucideIcon } from "lucide-react";
import { ChevronRight, Keyboard, Menu, RefreshCw, Search, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { ThemeToggle } from "@/components/system/ThemeToggle";
import { LogoutButton } from "@/components/system/LogoutButton";
import {
  NotificationCenter,
  NotificationProvider,
} from "@/components/shell/NotificationCenter";
import { KeyboardShortcutsDialog } from "@/components/shell/KeyboardShortcutsDialog";
import { useKeyboardShortcuts } from "@/hooks/useKeyboardShortcuts";
import { useLiveSyncStore } from "@/store/useLiveSyncStore";
import { Switch } from "@/components/ui/switch";

/* ────── Types ────── */
export interface AppShellNavItem {
  key: string;
  label: string;
  description: string;
  icon: LucideIcon;
  href: string;
  badge?: string | number;
}

interface AppShellProps {
  navItems: AppShellNavItem[];
  activeKey: string;
  onRefresh?: () => void;
  refreshing?: boolean;
  lastUpdateLabel?: string;
  subtitle?: string;
  title?: string;
  user?: {
    name?: string | null;
    role?: string | null;
  } | null;
  children: ReactNode;
}

/* ────── Constants ────── */
const SIDEBAR_COLLAPSED = 80;
const SIDEBAR_EXPANDED = 240;

/* ────── Component ────── */
export function AppShell({
  navItems,
  activeKey,
  onRefresh,
  refreshing = false,
  lastUpdateLabel,
  subtitle,
  title = "Panel corporativo",
  user,
  children,
}: AppShellProps) {
  const [sidebarExpanded, setSidebarExpanded] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);

  const sidebarRef = useRef<HTMLDivElement>(null);
  const hoverTimeoutRef = useRef<ReturnType<typeof setTimeout> | undefined>(
    undefined,
  );
  const [isDesktop, setIsDesktop] = useState(false);
  const { isLiveSyncEnabled, toggleLiveSync } = useLiveSyncStore();
  const [mounted, setMounted] = useState(false);

  useKeyboardShortcuts(navItems, {
    onRefresh,
    onOpenShortcuts: () => setShortcutsOpen(true),
  });

  useEffect(() => {
    setMounted(true);
    const query = window.matchMedia("(min-width: 1280px)");
    const handleChange = (event: MediaQueryListEvent) => {
      setIsDesktop(event.matches);
      if (event.matches) setMobileMenuOpen(false);
    };
    setIsDesktop(query.matches);
    query.addEventListener("change", handleChange);
    return () => query.removeEventListener("change", handleChange);
  }, []);

  const activeItem = useMemo(
    () => navItems.find((item) => item.key === activeKey) ?? navItems[0],
    [activeKey, navItems],
  );

  const handleSidebarEnter = () => {
    clearTimeout(hoverTimeoutRef.current);
    hoverTimeoutRef.current = setTimeout(() => setSidebarExpanded(true), 180);
  };
  const handleSidebarLeave = () => {
    clearTimeout(hoverTimeoutRef.current);
    hoverTimeoutRef.current = setTimeout(() => setSidebarExpanded(false), 300);
  };

  const initials = user?.name ? user.name.slice(0, 2).toUpperCase() : "US";

  return (
    <NotificationProvider>
      <div className="relative flex h-screen overflow-hidden bg-background text-foreground">
        {/* ── Mobile overlay ── */}
        {!isDesktop && mobileMenuOpen && (
          <button
            type="button"
            onClick={() => setMobileMenuOpen(false)}
            className="fixed inset-0 z-40 bg-black/40 backdrop-blur-sm"
            aria-label="Cerrar menú"
          />
        )}

        {/* ═══ SIDEBAR ═══ */}
        <aside
          ref={sidebarRef}
          data-tour="sidebar"
          onMouseEnter={isDesktop ? handleSidebarEnter : undefined}
          onMouseLeave={isDesktop ? handleSidebarLeave : undefined}
          style={{
            width: isDesktop
              ? sidebarExpanded
                ? SIDEBAR_EXPANDED
                : SIDEBAR_COLLAPSED
              : SIDEBAR_EXPANDED,
          }}
          className={cn(
            "z-50 flex h-full flex-shrink-0 flex-col bg-sidebar border-r border-sidebar-border",
            "transition-[width] duration-300 ease-[var(--ease-out-expo)]",
            /* Mobile positioning */
            !isDesktop && "fixed inset-y-0 left-0",
            !isDesktop && !mobileMenuOpen && "-translate-x-full",
            isDesktop && "relative",
          )}
        >
          {/* Brand */}
          <div className="flex h-20 items-center px-5 border-b border-sidebar-border">
            <div className="relative flex size-10 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-sidebar-primary ring-1 ring-sidebar-border/80">
              <Image
                src="/favicon.svg"
                alt="USB Monitor"
                width={24}
                height={24}
                className="size-6"
              />
              <span className="absolute right-1 top-1 size-1.5 rounded-full bg-sidebar-primary-foreground/90 dot-pulse" />
            </div>
            <AnimatePresence>
              {(sidebarExpanded || !isDesktop) && (
                <motion.div
                  initial={{ opacity: 0, width: 0 }}
                  animate={{ opacity: 1, width: "auto" }}
                  exit={{ opacity: 0, width: 0 }}
                  transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
                  className="overflow-hidden"
                >
                  <div className="ml-4 flex flex-col whitespace-nowrap">
                    <span className="text-sm font-bold uppercase tracking-[0.2em] text-sidebar-foreground/80">
                      USB Monitor
                    </span>
                    <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-sidebar-foreground/50">
                      Centro de control
                    </span>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
            {!isDesktop && (
              <Button
                variant="ghost"
                size="icon"
                className="ml-auto size-8 text-sidebar-foreground"
                onClick={() => setMobileMenuOpen(false)}
              >
                <X className="size-4" />
              </Button>
            )}
          </div>

          {/* Navigation */}
          <nav className="flex-1 overflow-y-auto overflow-x-hidden py-6 scrollbar-thin">
            <div className="flex flex-col space-y-4 px-3">
              {navItems.map((item) => {
                const isActive = item.key === activeKey;
                return (
                  <Link
                    key={item.key}
                    href={item.href}
                    prefetch
                    onClick={() => setMobileMenuOpen(false)}
                    className={cn(
                      "group relative flex items-center gap-4 rounded-lg p-3 text-sm font-medium outline-none transition-colors",
                      isActive
                        ? "text-sidebar-accent-foreground"
                        : "text-sidebar-foreground/70"
                    )}
                  >
                    {/* Hover Background */}
                    <div className="absolute inset-0 rounded-lg bg-sidebar-accent/50 opacity-0 transition-opacity duration-200 group-hover:opacity-100" />
                    
                    {/* Active Background */}
                    {isActive && (
                      <motion.div
                        layoutId="sidebar-active-bg"
                        className="absolute inset-0 rounded-lg bg-sidebar-accent"
                        transition={{ type: "spring", bounce: 0.2, duration: 0.6 }}
                      />
                    )}

                    {/* Active indicator bar */}
                    {isActive && (
                      <motion.div
                        layoutId="sidebar-active-indicator"
                        className="absolute -left-3 top-1/2 h-8 w-1 -translate-y-1/2 rounded-r-full bg-primary"
                        transition={{ type: "spring", bounce: 0.2, duration: 0.6 }}
                      />
                    )}

                    <div className="relative z-10 flex size-8 shrink-0 items-center justify-center">
                      <item.icon
                        className={cn(
                          "size-6 transition-colors duration-200",
                          isActive
                            ? "text-primary"
                            : "text-sidebar-foreground/50 group-hover:text-sidebar-foreground/80"
                        )}
                      />
                    </div>

                    <AnimatePresence>
                      {(sidebarExpanded || !isDesktop) && (
                        <motion.span
                          initial={{ opacity: 0, width: 0 }}
                          animate={{ opacity: 1, width: "auto" }}
                          exit={{ opacity: 0, width: 0 }}
                          transition={{
                            duration: 0.2,
                            ease: [0.16, 1, 0.3, 1],
                          }}
                          className="relative z-10 truncate whitespace-nowrap text-base"
                        >
                          {item.label}
                        </motion.span>
                      )}
                    </AnimatePresence>

                    {/* Badge */}
                    {item.badge !== undefined && (
                      <AnimatePresence>
                        {sidebarExpanded || !isDesktop ? (
                          <motion.span
                            initial={{ opacity: 0, scale: 0.8 }}
                            animate={{ opacity: 1, scale: 1 }}
                            exit={{ opacity: 0, scale: 0.8 }}
                            className="relative z-10 ml-auto inline-flex min-w-[24px] items-center justify-center rounded-md bg-sidebar-primary/15 px-2 py-0.5 font-mono text-xs font-semibold tabular-nums text-sidebar-primary"
                          >
                            {item.badge}
                          </motion.span>
                        ) : (
                          <span className="absolute right-2 top-2 size-2 rounded-full bg-primary" />
                        )}
                      </AnimatePresence>
                    )}
                  </Link>
                );
              })}
            </div>
          </nav>

          {/* Sidebar footer */}
          <div className="flex flex-col gap-2 border-t border-sidebar-border p-4">
            <div className="flex h-10 items-center justify-center">
              <ThemeToggle />
            </div>
            <AnimatePresence>
              {(sidebarExpanded || !isDesktop) && (
                <motion.div
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: "auto" }}
                  exit={{ opacity: 0, height: 0 }}
                  transition={{ duration: 0.15 }}
                  className="overflow-hidden"
                >
                  {lastUpdateLabel && (
                    <p className="pt-2 text-center text-[11px] text-sidebar-foreground/40">
                      Sincronizado: {lastUpdateLabel}
                    </p>
                  )}
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </aside>

        {/* ═══ MAIN AREA ═══ */}
        <div className="relative flex flex-1 flex-col overflow-hidden">
          {/* ── Header ── */}
          <header className="z-30 flex h-14 flex-shrink-0 items-center gap-4 border-b border-border bg-background/80 backdrop-blur-xl px-4 lg:px-6">
            {/* Mobile menu trigger */}
            {!isDesktop && (
              <Button
                variant="ghost"
                size="icon"
                className="size-8 lg:hidden"
                onClick={() => setMobileMenuOpen(true)}
              >
                <Menu className="size-4" />
              </Button>
            )}

            {/* Breadcrumb */}
            <div className="flex items-center gap-1.5 text-sm">
              <span className="text-muted-foreground/60 font-medium">
                {user?.role === "ADMIN" ? "Admin" : "Panel"}
              </span>
              <ChevronRight className="size-3 text-muted-foreground/40" />
              <span className="font-semibold text-foreground">{title}</span>
            </div>

            {/* Command Palette trigger (center) */}
            <div
              className="hidden flex-1 justify-center lg:flex"
              data-tour="command-trigger"
            >
              <button
                type="button"
                className="flex h-8 w-full max-w-sm items-center gap-2 rounded-lg border border-border/60 bg-muted/30 px-3 text-sm text-muted-foreground transition-colors hover:bg-muted/50 hover:border-border"
                onClick={() => {
                  /* Abre la paleta con el atajo */
                  document.dispatchEvent(
                    new KeyboardEvent("keydown", { key: "k", metaKey: true }),
                  );
                }}
              >
                <Search className="size-3.5" />
                <span className="flex-1 text-left">
                  Buscar o ejecutar comando...
                </span>
                <kbd className="pointer-events-none hidden h-5 select-none items-center gap-1 rounded border border-border/50 bg-muted/60 px-1.5 text-[10px] font-mono font-medium text-muted-foreground/70 lg:flex">
                  ⌘K
                </kbd>
              </button>
            </div>

            {/* Right actions */}
            <div className="ml-auto flex items-center gap-2">
              {/* Live Sync Toggle */}
              {mounted && (
                <div className="flex items-center gap-2 mr-2">
                  <span className={cn("text-[10px] font-semibold uppercase tracking-wider hidden lg:inline-block", isLiveSyncEnabled ? "text-success" : "text-muted-foreground")}>
                    {isLiveSyncEnabled ? "Live" : "Paused"}
                  </span>
                  <Switch 
                    checked={isLiveSyncEnabled} 
                    onCheckedChange={toggleLiveSync}
                    className="data-[state=checked]:bg-success scale-75 lg:scale-100"
                  />
                </div>
              )}

              {/* Refresh */}
              {onRefresh && (
                <Button
                  variant="ghost"
                  size="icon"
                  className="size-8 relative"
                  disabled={refreshing || (mounted && isLiveSyncEnabled)}
                  onClick={onRefresh}
                >
                  {mounted && isLiveSyncEnabled && (
                    <span className="absolute top-1.5 right-1.5 flex size-1.5">
                      <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-success opacity-75"></span>
                      <span className="relative inline-flex rounded-full size-1.5 bg-success"></span>
                    </span>
                  )}
                  <motion.span
                    animate={{ rotate: refreshing ? 360 : 0 }}
                    transition={{
                      duration: 0.8,
                      ease: [0.4, 0, 0.2, 1],
                      repeat: refreshing ? Infinity : 0,
                    }}
                    className="inline-flex"
                  >
                    <RefreshCw className="size-3.5" />
                  </motion.span>
                </Button>
              )}

              {/* Notification bell placeholder */}
              <div data-tour="notifications">
                <NotificationCenter />
              </div>

              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="size-8"
                    onClick={() => setShortcutsOpen(true)}
                    aria-label="Atajos de teclado"
                  >
                    <Keyboard className="size-3.5" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="bottom">Atajos (Ctrl/⌘ + /)</TooltipContent>
              </Tooltip>

              {/* User info */}
              <div className="hidden items-center gap-2.5 rounded-lg border border-border/50 bg-muted/20 px-3 py-1.5 text-sm lg:flex">
                <div className="flex size-7 items-center justify-center rounded-md bg-primary/10 text-primary text-xs font-bold">
                  {initials}
                </div>
                <div className="flex flex-col leading-tight">
                  <span className="text-xs font-semibold text-foreground">
                    {user?.name ?? "Usuario"}
                  </span>
                  <span className="text-[10px] uppercase tracking-wider text-muted-foreground">
                    {user?.role ?? "Admin"}
                  </span>
                </div>
              </div>

              <Tooltip>
                <TooltipTrigger asChild>
                  <div>
                    <LogoutButton
                      iconOnly
                      variant="ghost"
                      size="icon"
                      className="size-8 rounded-lg"
                    />
                  </div>
                </TooltipTrigger>
                <TooltipContent side="bottom">Cerrar sesión</TooltipContent>
              </Tooltip>
            </div>
          </header>

          {/* ── Subtitle bar (optional) ── */}
          {subtitle && (
            <div className="flex items-center gap-2 border-b border-border/50 bg-muted/10 px-4 py-1.5 lg:px-6">
              <p className="text-xs text-muted-foreground">{subtitle}</p>
              {refreshing && (
                <span className="inline-flex size-1.5 animate-pulse rounded-full bg-primary" />
              )}
            </div>
          )}

          {/* ── Content area ── */}
          <main className="relative flex-1 overflow-y-auto scrollbar-thin">
            <div
              aria-hidden
              className="dot-grid pointer-events-none absolute inset-x-0 top-0 h-64 text-foreground opacity-40 [mask-image:linear-gradient(to_bottom,black,transparent)]"
            />
            <div className="relative mx-auto w-full max-w-[1400px] px-4 py-6 lg:px-6 lg:py-8">
              {children}
            </div>
          </main>
        </div>
      </div>
      <KeyboardShortcutsDialog
        open={shortcutsOpen}
        onOpenChange={setShortcutsOpen}
      />
    </NotificationProvider>
  );
}
