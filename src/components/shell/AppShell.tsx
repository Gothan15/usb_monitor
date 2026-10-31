"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
import Link from "next/link";
import Image from "next/image";
import { motion } from "framer-motion";
import type { LucideIcon } from "lucide-react";
import { Keyboard, RefreshCw, Search } from "lucide-react";
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

/* ────── Component — cabecera editorial «Herencia» ──────
   Sin barra lateral: membrete superior con la marca en serif,
   navegación horizontal con subrayado de latón y cabecera de
   página editorial sobre el contenido. */
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
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const { isLiveSyncEnabled, toggleLiveSync } = useLiveSyncStore();
  const [mounted, setMounted] = useState(false);

  useKeyboardShortcuts(navItems, {
    onRefresh,
    onOpenShortcuts: () => setShortcutsOpen(true),
  });

  useEffect(() => {
    setMounted(true);
  }, []);

  const activeItem = useMemo(
    () => navItems.find((item) => item.key === activeKey) ?? navItems[0],
    [activeKey, navItems],
  );

  const initials = user?.name ? user.name.slice(0, 2).toUpperCase() : "US";
  const fechaEditorial = useMemo(
    () =>
      new Intl.DateTimeFormat("es-ES", {
        weekday: "long",
        day: "numeric",
        month: "long",
        year: "numeric",
      }).format(new Date()),
    [],
  );

  return (
    <NotificationProvider>
      <div className="relative flex h-screen flex-col overflow-hidden bg-background text-foreground">
        {/* ═══ MEMBRETE — cabecera de periódico ═══ */}
        <header className="z-30 flex-shrink-0 border-b border-border bg-card/60">
          {/* Franja superior: fecha y estado */}
          <div className="border-b border-border/70">
            <div className="mx-auto flex h-8 w-full max-w-[1360px] items-center justify-between px-4 lg:px-8">
              <span className="smallcaps hidden text-muted-foreground sm:block">
                {fechaEditorial}
              </span>
              <span className="smallcaps text-muted-foreground sm:hidden">
                USB Monitor
              </span>
              <span className="flex items-center gap-4">
                {lastUpdateLabel && (
                  <span className="smallcaps hidden text-muted-foreground/80 md:block">
                    Sincronizado: {lastUpdateLabel}
                  </span>
                )}
                <span
                  className={cn(
                    "smallcaps flex items-center gap-1.5",
                    mounted && isLiveSyncEnabled
                      ? "text-success"
                      : "text-muted-foreground",
                  )}
                >
                  <span
                    className={cn(
                      "size-1.5 rounded-full",
                      mounted && isLiveSyncEnabled
                        ? "dot-pulse bg-success"
                        : "bg-muted-foreground/50",
                    )}
                  />
                  {mounted && isLiveSyncEnabled ? "En vivo" : "En pausa"}
                </span>
              </span>
            </div>
          </div>

          {/* Fila principal: buscar · marca centrada · acciones */}
          <div className="relative mx-auto flex h-[4.5rem] w-full max-w-[1360px] items-center gap-3 px-4 lg:px-8">
            <div
              className="hidden w-56 flex-1 md:block"
              data-tour="command-trigger"
            >
              <button
                type="button"
                className="flex h-9 w-full max-w-[13rem] items-center gap-2 border-b border-border pb-1 text-[13px] text-muted-foreground transition-colors hover:border-[var(--brass)] hover:text-foreground"
                onClick={() => {
                  document.dispatchEvent(
                    new KeyboardEvent("keydown", { key: "k", metaKey: true }),
                  );
                }}
              >
                <Search className="size-3.5" />
                <span className="flex-1 text-left">Buscar…</span>
                <kbd className="pointer-events-none hidden h-5 select-none items-center gap-1 rounded-sm border border-border bg-muted px-1.5 font-mono text-[10px] font-medium text-muted-foreground/80 lg:flex">
                  ⌘K
                </kbd>
              </button>
            </div>

            {/* Marca centrada */}
            <Link
              href={navItems[0]?.href ?? "/"}
              className="flex items-center gap-3 md:absolute md:left-1/2 md:-translate-x-1/2"
            >
              <span className="flex size-10 items-center justify-center overflow-hidden rounded-sm shadow-sm ring-1 ring-border">
                <Image
                  src="/favicon.svg"
                  alt="USB Monitor"
                  width={40}
                  height={40}
                  className="size-10"
                />
              </span>
              <span className="flex flex-col items-start leading-none">
                <span className="font-display text-[1.45rem] font-bold tracking-tight">
                  USB Monitor
                </span>
                <span className="smallcaps mt-1 text-muted-foreground">
                  Centro de control
                </span>
              </span>
            </Link>

            {/* Acciones */}
            <div className="ml-auto flex flex-1 items-center justify-end gap-1.5">
              {mounted && (
                <div className="mr-1 hidden items-center gap-2 xl:flex">
                  <Switch
                    checked={isLiveSyncEnabled}
                    onCheckedChange={toggleLiveSync}
                    className="data-[state=checked]:bg-success scale-90"
                    aria-label="Sincronización en vivo"
                  />
                </div>
              )}

              {onRefresh && (
                <Button
                  variant="ghost"
                  size="icon"
                  className="relative size-9"
                  disabled={refreshing || (mounted && isLiveSyncEnabled)}
                  onClick={onRefresh}
                  aria-label="Actualizar"
                >
                  {mounted && isLiveSyncEnabled && (
                    <span className="absolute right-1.5 top-1.5 flex size-1.5">
                      <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-success opacity-75"></span>
                      <span className="relative inline-flex size-1.5 rounded-full bg-success"></span>
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
                    <RefreshCw className="size-4" />
                  </motion.span>
                </Button>
              )}

              <div data-tour="notifications">
                <NotificationCenter />
              </div>

              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="hidden size-9 sm:inline-flex"
                    onClick={() => setShortcutsOpen(true)}
                    aria-label="Atajos de teclado"
                  >
                    <Keyboard className="size-4" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="bottom">Atajos (Ctrl/⌘ + /)</TooltipContent>
              </Tooltip>

              <ThemeToggle />

              <span className="mx-1 hidden h-8 w-px bg-border lg:block" />

              {/* Usuario */}
              <div className="hidden items-center gap-2.5 lg:flex">
                <span className="flex size-9 items-center justify-center rounded-full border border-[var(--brass)] font-display text-[13px] font-bold text-[var(--brass)]">
                  {initials}
                </span>
                <span className="flex flex-col leading-tight">
                  <span className="text-[13px] font-semibold">
                    {user?.name ?? "Usuario"}
                  </span>
                  <span className="smallcaps text-muted-foreground">
                    {user?.role ?? "Admin"}
                  </span>
                </span>
              </div>

              <Tooltip>
                <TooltipTrigger asChild>
                  <div>
                    <LogoutButton
                      iconOnly
                      variant="ghost"
                      size="icon"
                      className="size-9"
                    />
                  </div>
                </TooltipTrigger>
                <TooltipContent side="bottom">Cerrar sesión</TooltipContent>
              </Tooltip>
            </div>
          </div>

          {/* ── Navegación horizontal ── */}
          <nav
            data-tour="sidebar"
            className="border-t border-border/70"
            aria-label="Secciones"
          >
            <div className="scrollbar-thin mx-auto flex w-full max-w-[1360px] items-stretch gap-1 overflow-x-auto px-2 lg:px-6">
              {navItems.map((item) => {
                const isActive = item.key === activeKey;
                return (
                  <Link
                    key={item.key}
                    href={item.href}
                    prefetch
                    className={cn(
                      "group relative flex items-center gap-2 whitespace-nowrap px-3.5 py-3 text-[12px] font-semibold uppercase tracking-[0.11em] transition-colors",
                      isActive
                        ? "text-foreground"
                        : "text-muted-foreground hover:text-foreground",
                    )}
                  >
                    <item.icon
                      className={cn(
                        "size-4 transition-colors",
                        isActive
                          ? "text-[var(--brass)]"
                          : "text-muted-foreground/70 group-hover:text-foreground/80",
                      )}
                    />
                    {item.label}
                    {item.badge !== undefined && (
                      <span className="inline-flex min-w-[22px] items-center justify-center rounded-full border border-[var(--brass)]/60 px-1.5 py-px font-mono text-[11px] font-semibold tabular-nums normal-case tracking-normal text-[var(--brass)]">
                        {item.badge}
                      </span>
                    )}
                    {isActive && (
                      <motion.span
                        layoutId="nav-underline"
                        className="absolute inset-x-3 bottom-0 h-[2px] bg-[var(--brass)]"
                        transition={{ type: "spring", bounce: 0.18, duration: 0.55 }}
                      />
                    )}
                  </Link>
                );
              })}
              <span className="ml-auto hidden shrink-0 items-center pl-6 2xl:flex">
                <span className="max-w-[240px] truncate font-display text-[13px] italic text-muted-foreground">
                  {activeItem?.description}
                </span>
              </span>
            </div>
          </nav>
        </header>

        {/* ═══ CONTENIDO ═══ */}
        <main className="scrollbar-thin relative flex-1 overflow-y-auto">
          <div className="relative mx-auto w-full max-w-[1360px] px-4 pb-10 pt-8 lg:px-8 lg:pt-10">
            {/* Cabecera editorial de la página */}
            <div className="animate-view-in mb-8">
              <p className="smallcaps text-[var(--brass)]">
                {user?.role === "ADMIN" ? "Administración" : "Panel"} — Registro
                de dispositivos
              </p>
              <h1 className="font-display mt-2 text-[2.1rem] font-bold leading-tight tracking-tight lg:text-[2.5rem]">
                {title}
              </h1>
              {subtitle && (
                <p className="mt-2 max-w-xl text-[15px] leading-relaxed text-muted-foreground">
                  {subtitle}
                </p>
              )}
              {refreshing && (
                <span className="mt-3 inline-flex size-1.5 animate-pulse rounded-full bg-[var(--brass)]" />
              )}
              <div className="rule-brass mt-5 w-24" />
              <div className="mt-px h-px w-full bg-border" />
            </div>

            {children}

            {/* Pie de página */}
            <footer className="mt-14 flex flex-col items-center gap-1.5 border-t border-border pt-6 text-center">
              <span className="font-display text-sm italic text-muted-foreground">
                USB Monitor — cada dispositivo, registrado
              </span>
              {lastUpdateLabel && (
                <span className="smallcaps text-muted-foreground/70">
                  Sincronizado: {lastUpdateLabel}
                </span>
              )}
            </footer>
          </div>
        </main>
      </div>
      <KeyboardShortcutsDialog
        open={shortcutsOpen}
        onOpenChange={setShortcutsOpen}
      />
    </NotificationProvider>
  );
}
