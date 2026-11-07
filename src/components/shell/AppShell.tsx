"use client";

import { Fragment, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import Link from "next/link";
import Image from "next/image";
import { AnimatePresence, motion } from "framer-motion";
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
import { useLayoutStore } from "@/store/useLayoutStore";
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
  const disposicionGuardada = useLayoutStore((state) => state.disposicion);
  const mounted = useSyncExternalStore(
    () => () => {},
    () => true,
    () => false
  );

  useKeyboardShortcuts(navItems, {
    onRefresh,
    onOpenShortcuts: () => setShortcutsOpen(true),
  });

  const esLateral = mounted && disposicionGuardada === "lateral";

  /* Barra lateral desplegable: riel de iconos que se abre al pasar
     el ratón (180 ms al entrar, 300 ms al salir), como la original. */
  const [lateralAbierta, setLateralAbierta] = useState(false);
  const hoverRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const abrirLateral = () => {
    clearTimeout(hoverRef.current);
    hoverRef.current = setTimeout(() => setLateralAbierta(true), 180);
  };
  const cerrarLateral = () => {
    clearTimeout(hoverRef.current);
    hoverRef.current = setTimeout(() => setLateralAbierta(false), 300);
  };

  const activeItem = useMemo(
    () => navItems.find((item) => item.key === activeKey) ?? navItems[0],
    [activeKey, navItems],
  );

  const initials = user?.name ? user.name.slice(0, 2).toUpperCase() : "US";
  return (
    <NotificationProvider>
      <div className="relative flex h-screen flex-col overflow-hidden bg-background text-foreground">
        {/* ═══ ARMazón: cabecera reorganizada o barra lateral ═══ */}
        <div className="flex min-h-0 flex-1">
          {esLateral && (
            <aside
              data-tour="sidebar"
              onMouseEnter={abrirLateral}
              onMouseLeave={cerrarLateral}
              style={{ width: lateralAbierta ? 248 : 76 }}
              className="hidden shrink-0 flex-col overflow-hidden border-r border-border bg-background transition-[width] duration-300 ease-out lg:flex"
            >
              {/* Marca */}
              <div className="flex h-14 shrink-0 items-center gap-2.5 border-b border-border px-[22px]">
                <Image
                  src="/brujula-claro.png"
                  alt="USB Monitor"
                  width={24}
                  height={24}
                  className="size-6 shrink-0 rounded-[4px] dark:hidden"
                />
                <Image
                  src="/brujula-oscura.png"
                  alt=""
                  aria-hidden
                  width={24}
                  height={24}
                  className="hidden size-6 shrink-0 rounded-[4px] dark:block"
                />
                <AnimatePresence>
                  {lateralAbierta && (
                    <motion.span
                      initial={{ opacity: 0, width: 0 }}
                      animate={{ opacity: 1, width: "auto" }}
                      exit={{ opacity: 0, width: 0 }}
                      transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
                      className="overflow-hidden whitespace-nowrap leading-tight"
                    >
                      <span className="block font-display text-[15px] font-bold tracking-tight">
                        USB Monitor
                      </span>
                      <span className="block text-[10.5px] uppercase tracking-[0.14em] text-muted-foreground">
                        Centro de control
                      </span>
                    </motion.span>
                  )}
                </AnimatePresence>
              </div>

              {/* Navegación vertical, con aire y filete entre secciones */}
              <nav
                className="flex-1 overflow-y-auto overflow-x-hidden px-3 py-4"
                aria-label="Secciones"
              >
                {navItems.map((item, indice) => {
                  const isActive = item.key === activeKey;
                  return (
                    <div key={item.key}>
                      {indice > 0 && (
                        <div className="mx-2 my-2 h-px bg-border/80" aria-hidden />
                      )}
                      <Link
                        href={item.href}
                        prefetch
                        title={lateralAbierta ? undefined : item.label}
                        className={cn(
                          "group relative flex items-center gap-3 rounded-md px-3 py-3 text-[11.5px] font-semibold uppercase tracking-[0.09em] transition-colors",
                          isActive
                            ? "bg-primary/[0.06] text-foreground"
                            : "text-muted-foreground hover:bg-muted/50 hover:text-foreground",
                        )}
                      >
                        {isActive && (
                          <span className="absolute left-0 top-1/2 h-6 w-[2.5px] -translate-y-1/2 rounded-full bg-[var(--acero)]" />
                        )}
                        <span className="relative shrink-0">
                          <item.icon
                            className={cn(
                              "size-5 transition-colors",
                              isActive
                                ? "text-[var(--acero)]"
                                : "text-muted-foreground/70 group-hover:text-foreground/80",
                            )}
                          />
                          {!lateralAbierta && item.badge !== undefined && (
                            <span className="absolute -right-1.5 -top-1.5 size-2 rounded-full bg-[var(--acero)]" />
                          )}
                        </span>
                        <AnimatePresence>
                          {lateralAbierta && (
                            <motion.span
                              initial={{ opacity: 0, width: 0 }}
                              animate={{ opacity: 1, width: "auto" }}
                              exit={{ opacity: 0, width: 0 }}
                              transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
                              className="flex min-w-0 flex-1 items-center overflow-hidden whitespace-nowrap"
                            >
                              <span className="flex-1 truncate">{item.label}</span>
                              {item.badge !== undefined && (
                                <span className="ml-2 font-mono text-[11px] font-semibold tabular-nums text-[var(--acero)]">
                                  {item.badge}
                                </span>
                              )}
                            </motion.span>
                          )}
                        </AnimatePresence>
                      </Link>
                    </div>
                  );
                })}
              </nav>

              {/* Acciones rápidas de la barra */}
              <div
                className={cn(
                  "flex shrink-0 items-center gap-0.5 border-t border-border px-3 py-2.5",
                  lateralAbierta ? "flex-row" : "flex-col",
                )}
              >
                <button
                  type="button"
                  className="flex size-9 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                  onClick={() => {
                    document.dispatchEvent(
                      new KeyboardEvent("keydown", { key: "k", metaKey: true }),
                    );
                  }}
                  aria-label="Buscar (Ctrl/⌘ + K)"
                  data-tour="command-trigger"
                >
                  <Search className="size-4" />
                </button>
                {onRefresh && mounted && !isLiveSyncEnabled && (
                  <Button
                    variant="ghost"
                    size="icon"
                    className="size-9"
                    disabled={refreshing}
                    onClick={onRefresh}
                    aria-label="Actualizar"
                    title="Actualizar (la sincronización en vivo está en pausa)"
                  >
                    <RefreshCw className="size-4" />
                  </Button>
                )}
                <div data-tour="notifications">
                  <NotificationCenter />
                </div>
                <ThemeToggle />
              </div>

              {/* Usuario y estado, al pie de la barra */}
              <div className="shrink-0 border-t border-border px-[18px] py-4">
                <div
                  className={cn(
                    "flex items-center gap-2.5",
                    !lateralAbierta && "flex-col gap-2",
                  )}
                >
                  <span className="flex size-8 shrink-0 items-center justify-center rounded-full border border-[var(--acero)]/70 font-display text-[11px] font-bold text-[var(--acero)]">
                    {initials}
                  </span>
                  <AnimatePresence>
                    {lateralAbierta && (
                      <motion.span
                        initial={{ opacity: 0, width: 0 }}
                        animate={{ opacity: 1, width: "auto" }}
                        exit={{ opacity: 0, width: 0 }}
                        transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
                        className="min-w-0 flex-1 overflow-hidden whitespace-nowrap leading-tight"
                      >
                        <span className="block max-w-[130px] truncate text-[13px] font-medium text-foreground">
                          {user?.name ?? "Usuario"}
                        </span>
                        <span className="block text-[11px] text-muted-foreground">
                          {user?.role?.toUpperCase() === "ADMIN"
                            ? "Administrador"
                            : "Usuario"}
                        </span>
                      </motion.span>
                    )}
                  </AnimatePresence>
                  <LogoutButton
                    iconOnly
                    variant="ghost"
                    size="icon"
                    className="size-8 shrink-0"
                  />
                </div>
                <p
                  className={cn(
                    "mt-3 flex items-center gap-1.5 text-[11px]",
                    !lateralAbierta && "justify-center",
                    mounted && isLiveSyncEnabled
                      ? "text-success"
                      : "text-muted-foreground",
                  )}
                  title={
                    mounted && isLiveSyncEnabled
                      ? "Sincronización en vivo"
                      : "Sincronización en pausa"
                  }
                >
                  <span
                    className={cn(
                      "size-1.5 shrink-0 rounded-full",
                      mounted && isLiveSyncEnabled
                        ? "dot-pulse bg-success"
                        : "bg-muted-foreground/50",
                    )}
                  />
                  {lateralAbierta &&
                    (mounted && isLiveSyncEnabled
                      ? "Sincronización en vivo"
                      : "Sincronización en pausa")}
                </p>
              </div>
            </aside>
          )}

          <div className="flex min-w-0 flex-1 flex-col">
            {esLateral ? (
              /* ── Barra superior del modo lateral: solo móvil y tableta;
                   en escritorio manda la barra lateral, sin doble forma ── */
              <header className="z-30 flex-shrink-0 border-b border-border bg-background/95 lg:hidden">
                <div className="flex h-12 items-center gap-1 px-4 lg:px-6">
                  <span className="flex items-center gap-2 lg:hidden">
                    <Image
                      src="/brujula-claro.png"
                      alt="USB Monitor"
                      width={22}
                      height={22}
                      className="size-[22px] rounded-[4px] dark:hidden"
                    />
                    <Image
                      src="/brujula-oscura.png"
                      alt=""
                      aria-hidden
                      width={22}
                      height={22}
                      className="hidden size-[22px] rounded-[4px] dark:block"
                    />
                    <span className="font-display text-[15px] font-bold tracking-tight">
                      USB Monitor
                    </span>
                  </span>
                  <div className="ml-auto flex items-center gap-0.5">
                    <span
                      className={cn(
                        "mr-1.5 hidden items-center gap-1.5 text-[11px] sm:flex",
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
                    <button
                      type="button"
                      className="flex size-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                      onClick={() => {
                        document.dispatchEvent(
                          new KeyboardEvent("keydown", { key: "k", metaKey: true }),
                        );
                      }}
                      aria-label="Buscar (Ctrl/⌘ + K)"
                      data-tour="command-trigger"
                    >
                      <Search className="size-4" />
                    </button>
                    {onRefresh && mounted && !isLiveSyncEnabled && (
                      <Button
                        variant="ghost"
                        size="icon"
                        className="size-8"
                        disabled={refreshing}
                        onClick={onRefresh}
                        aria-label="Actualizar"
                        title="Actualizar (la sincronización en vivo está en pausa)"
                      >
                        <RefreshCw className="size-4" />
                      </Button>
                    )}
                    <div data-tour="notifications">
                      <NotificationCenter />
                    </div>
                    <ThemeToggle className="size-8" />
                    <span className="flex items-center gap-0.5 lg:hidden">
                      <span className="mx-1 h-5 w-px bg-border" />
                      <span className="flex size-7 items-center justify-center rounded-full border border-[var(--acero)]/70 font-display text-[11px] font-bold text-[var(--acero)]">
                        {initials}
                      </span>
                      <LogoutButton
                        iconOnly
                        variant="ghost"
                        size="icon"
                        className="size-8"
                      />
                    </span>
                  </div>
                </div>
                                {/* Navegación en fila fina (móvil y tableta, modo lateral) */}
                <nav
                  className="scrollbar-thin flex items-stretch gap-0.5 overflow-x-auto border-t border-border/60 px-2 lg:hidden"
                  aria-label="Secciones"
                >
                  {navItems.map((item) => {
                    const isActive = item.key === activeKey;
                    return (
                      <Link
                        key={item.key}
                        href={item.href}
                        prefetch
                        className={cn(
                          "relative flex items-center gap-1.5 whitespace-nowrap px-2.5 py-2.5 text-[11.5px] font-semibold uppercase tracking-[0.09em] transition-colors",
                          isActive
                            ? "text-foreground"
                            : "text-muted-foreground hover:text-foreground",
                        )}
                      >
                        <item.icon
                          className={cn(
                            "size-4 shrink-0",
                            isActive
                              ? "text-[var(--acero)]"
                              : "text-muted-foreground/70",
                          )}
                        />
                        {item.label}
                        {item.badge !== undefined && (
                          <span className="font-mono text-[10.5px] font-semibold tabular-nums text-[var(--acero)]">
                            {item.badge}
                          </span>
                        )}
                        {isActive && (
                          <motion.span
                            layoutId="nav-movil-lateral"
                            className="absolute inset-x-2.5 bottom-0 h-[2px] bg-[var(--acero)]"
                            transition={{ type: "spring", bounce: 0.18, duration: 0.55 }}
                          />
                        )}
                      </Link>
                    );
                  })}
                </nav>
              </header>
            ) : (
              /* ── Cabecera reorganizada: grupos con aire y separadores ── */
              <header className="z-30 flex-shrink-0 border-b border-border bg-background/95">
                <div className="flex h-14 w-full items-center gap-3 px-4 lg:px-8">
                  <Link
                    href={navItems[0]?.href ?? "/"}
                    className="flex shrink-0 items-center gap-2.5"
                  >
                    <Image
                      src="/brujula-claro.png"
                      alt="USB Monitor"
                      width={24}
                      height={24}
                      className="size-6 rounded-[4px] dark:hidden"
                    />
                    <Image
                      src="/brujula-oscura.png"
                      alt=""
                      aria-hidden
                      width={24}
                      height={24}
                      className="hidden size-6 rounded-[4px] dark:block"
                    />
                    <span className="font-display text-base font-bold tracking-tight">
                      USB Monitor
                    </span>
                  </Link>

                  <div className="ml-auto flex shrink-0 items-center">
                    <span
                      className={cn(
                        "hidden items-center gap-1.5 text-[11px] md:flex",
                        mounted && isLiveSyncEnabled
                          ? "text-success"
                          : "text-muted-foreground",
                      )}
                      title={mounted && isLiveSyncEnabled ? "En vivo" : "En pausa"}
                    >
                      <span
                        className={cn(
                          "size-1.5 rounded-full",
                          mounted && isLiveSyncEnabled
                            ? "dot-pulse bg-success"
                            : "bg-muted-foreground/50",
                        )}
                      />
                    </span>

                    <span className="mx-2.5 hidden h-5 w-px bg-border md:block" />

                    <div className="flex items-center gap-0.5">
                      <button
                        type="button"
                        className="flex size-9 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                        onClick={() => {
                          document.dispatchEvent(
                            new KeyboardEvent("keydown", { key: "k", metaKey: true }),
                          );
                        }}
                        aria-label="Buscar (Ctrl/⌘ + K)"
                        data-tour="command-trigger"
                      >
                        <Search className="size-4" />
                      </button>
                      {onRefresh && mounted && !isLiveSyncEnabled && (
                        <Button
                          variant="ghost"
                          size="icon"
                          className="size-9"
                          disabled={refreshing}
                          onClick={onRefresh}
                          aria-label="Actualizar"
                          title="Actualizar (la sincronización en vivo está en pausa)"
                        >
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
                      <ThemeToggle />
                    </div>

                    <span className="mx-2.5 hidden h-5 w-px bg-border sm:block" />

                    <div className="flex items-center gap-2.5">
                      <span
                        className="hidden size-8 items-center justify-center rounded-full border border-[var(--acero)]/70 font-display text-[11px] font-bold text-[var(--acero)] sm:flex"
                        title={user?.name ?? "Usuario"}
                      >
                        {initials}
                      </span>
                      <LogoutButton
                        iconOnly
                        variant="ghost"
                        size="icon"
                        className="size-9"
                      />
                    </div>
                  </div>
                </div>

                {/* Navegación en fila para TODOS los anchos (decisión
                    de Gothan): las secciones ocupan todo el ancho,
                    con «|» como divisor. Antes, a partir de 1600 px
                    se cambiaba a una navegación dentro de la cabecera;
                    esa variante se eliminó para que la vista sea la
                    misma en cualquier pantalla. */}
                <nav
                  className="scrollbar-thin flex items-stretch gap-0.5 overflow-x-auto border-t border-border/60 px-2 xl:gap-0 xl:overflow-visible"
                  aria-label="Secciones"
                >
                  {navItems.map((item, indice) => {
                    const isActive = item.key === activeKey;
                    return (
                      <Fragment key={item.key}>
                        {indice > 0 && (
                          <span
                            aria-hidden
                            className="hidden select-none items-center text-[13px] font-light text-muted-foreground/40 xl:flex"
                          >
                            |
                          </span>
                        )}
                        <Link
                          href={item.href}
                          prefetch
                          className={cn(
                            "relative flex items-center gap-1.5 whitespace-nowrap px-2.5 py-2.5 text-[11.5px] font-semibold uppercase tracking-[0.09em] transition-colors xl:flex-1 xl:justify-center",
                            isActive
                              ? "text-foreground"
                              : "text-muted-foreground hover:text-foreground",
                          )}
                        >
                          <item.icon
                            className={cn(
                              "size-4 shrink-0",
                              isActive
                                ? "text-[var(--acero)]"
                                : "text-muted-foreground/70",
                            )}
                          />
                          {item.label}
                          {item.badge !== undefined && (
                            <span className="font-mono text-[10.5px] font-semibold tabular-nums text-[var(--acero)]">
                              {item.badge}
                            </span>
                          )}
                          {isActive && (
                            <motion.span
                              layoutId="nav-underline-movil"
                              className="absolute inset-x-2.5 bottom-0 h-[2px] bg-[var(--acero)] xl:inset-x-5"
                              transition={{ type: "spring", bounce: 0.18, duration: 0.55 }}
                            />
                          )}
                        </Link>
                      </Fragment>
                    );
                  })}
                </nav>
              </header>
            )}

        {/* ═══ CONTENIDO ═══ */}
        <main className="scrollbar-thin relative flex-1 overflow-y-auto">
          <div className="relative mx-auto flex min-h-full w-full max-w-[1360px] flex-col px-4 pb-10 pt-8 lg:px-8 lg:pt-10">
            {children}

            <footer className="mt-14 flex items-center justify-between border-t border-border pt-4 text-[11px] text-muted-foreground/80">
              <span>USB Monitor</span>
              {lastUpdateLabel && <span>Sincronizado: {lastUpdateLabel}</span>}
            </footer>
          </div>
        </main>
          </div>
        </div>
      </div>
      <KeyboardShortcutsDialog
        open={shortcutsOpen}
        onOpenChange={setShortcutsOpen}
      />
    </NotificationProvider>
  );
}
