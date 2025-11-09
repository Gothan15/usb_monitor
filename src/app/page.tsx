"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import type { LucideIcon } from "lucide-react";
import {
  LayoutDashboard,
  LogOut,
  MonitorSmartphone,
  Radar,
  RefreshCw,
  ShieldCheck,
  ArrowUpRight,
  Plus,
  Usb,
  Menu,
  ChevronsLeft,
  ChevronsRight,
} from "lucide-react";
import {
  USBEvent,
  Computer,
  WhitelistEntry,
} from "@/components/dashboard/types";
import { StatsCards } from "@/components/dashboard/StatsCards";
import { EventsTab } from "@/components/dashboard/EventsTab";
import { ComputersTab } from "@/components/dashboard/ComputersTab";
import { NetworkScannerTab } from "@/components/dashboard/NetworkScannerTab";
import { WhitelistTab } from "@/components/dashboard/WhitelistTab";
import { FullscreenSpinner } from "@/components/ui/spinner";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { AnimatePresence, motion } from "framer-motion";
import {
  Tooltip,
  TooltipTrigger,
  TooltipContent,
} from "@/components/ui/tooltip";

type ViewKey = "overview" | "events" | "computers" | "whitelist" | "network";

interface NavItem {
  key: ViewKey;
  label: string;
  description: string;
  icon: LucideIcon;
  badge?: string;
}

export default function Home() {
  const router = useRouter();
  const [events, setEvents] = useState<USBEvent[]>([]);
  const [computers, setComputers] = useState<Computer[]>([]);
  const [whitelist, setWhitelist] = useState<WhitelistEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [lastUpdate, setLastUpdate] = useState<Date>(new Date());
  const [checkingRole, setCheckingRole] = useState(true);
  const [activeView, setActiveView] = useState<ViewKey>("overview");
  const [isDesktop, setIsDesktop] = useState(false);
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false);
  const [isMobileSidebarOpen, setIsMobileSidebarOpen] = useState(false);
  const { toast } = useToast();

  // Verificar rol de usuario
  useEffect(() => {
    const checkRole = async () => {
      try {
        const res = await fetch("/api/auth/session", {
          credentials: "include",
        });
        const data = await res.json();

        if (data.ok && data.user) {
          if (data.user.role === "user") {
            router.push("/unlocked");
            return;
          }
        }
        setCheckingRole(false);
      } catch (error) {
        console.error("Error verificando rol:", error);
        setCheckingRole(false);
      }
    };

    checkRole();
  }, [router]);

  const logout = async () => {
    try {
      await fetch("/api/auth/logout", { method: "POST" });
      try {
        const ch = new BroadcastChannel("auth-state");
        ch.postMessage({ type: "logout" });
        ch.close();
      } catch {}
      window.location.href = "/login";
    } catch {}
  };

  // Lógica de network scanner se movió a componente NetworkScannerTab

  const fetchData = async (manual = false) => {
    try {
      if (manual) {
        setRefreshing(true);
      } else {
        setLoading(true);
      }
      setErrorMsg(null);
      const [eventsResponse, computersResponse, whitelistResponse] =
        await Promise.all([
          fetch("/api/usb-event", {
            cache: "no-store",
            credentials: "include",
          }),
          fetch("/api/computers", {
            cache: "no-store",
            credentials: "include",
          }),
          fetch("/api/whitelist", {
            cache: "no-store",
            credentials: "include",
          }),
        ]);
      // Ya no se redirige a login porque autenticación fue removida.
      const allOk =
        eventsResponse.ok && computersResponse.ok && whitelistResponse.ok;

      if (!allOk) {
        const errorSummary = `Eventos ${eventsResponse.status} / PCs ${computersResponse.status} / Whitelist ${whitelistResponse.status}`;
        setErrorMsg(`Error al obtener datos (${errorSummary})`);
        if (manual) {
          toast({
            title: "Error al actualizar",
            description: errorSummary,
            variant: "destructive",
          });
        }
      }
      if (eventsResponse.ok) {
        const eventsData = await eventsResponse.json();
        setEvents(eventsData);
      }
      if (computersResponse.ok) {
        const computersData = await computersResponse.json();
        setComputers(computersData);
      }
      if (whitelistResponse.ok) {
        const whitelistData = await whitelistResponse.json();
        setWhitelist(whitelistData?.items ?? []);
      }
      setLastUpdate(new Date());
      if (manual && allOk) {
        toast({
          title: "Datos sincronizados",
          description: `Actualizado a las ${new Date().toLocaleTimeString(
            "es-ES"
          )}`,
        });
      }
    } catch (error: any) {
      console.error("Error al cargar datos:", error);
      setErrorMsg(error.message || "Fallo de red");
      if (manual) {
        toast({
          title: "Fallo al actualizar",
          description: error.message || "Revisa tu conexión",
          variant: "destructive",
        });
      }
    } finally {
      if (manual) {
        setRefreshing(false);
      } else {
        setLoading(false);
      }
    }
  };

  const handleCreateWhitelist = async (payload: {
    serialNumber: string;
    label?: string;
    notes?: string;
  }) => {
    const response = await fetch("/api/whitelist", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      credentials: "include",
    });

    const data = await response.json().catch(() => null);
    const ok = response.ok && data?.ok;

    if (!ok) {
      const message = data?.error || `Error HTTP ${response.status}`;
      toast({
        title: "No se pudo agregar el serial",
        description: message,
        variant: "destructive",
      });
      throw new Error(message);
    }

    setWhitelist((prev) => [data.item, ...prev]);
    toast({
      title: "Serial autorizado",
      description: `El dispositivo ${
        data?.item?.serialNumber ?? payload.serialNumber
      } fue agregado.`,
    });
  };

  const handleDeleteWhitelist = async (id: string) => {
    const response = await fetch(`/api/whitelist/${id}`, {
      method: "DELETE",
      credentials: "include",
    });

    const data = await response.json().catch(() => null);
    const ok = response.ok && data?.ok;

    if (!ok) {
      const message = data?.error || `Error HTTP ${response.status}`;
      toast({
        title: "No se pudo eliminar el serial",
        description: message,
        variant: "destructive",
      });
      throw new Error(message);
    }

    setWhitelist((prev) => prev.filter((entry) => entry.id !== id));
    toast({
      title: "Serial removido",
      description: `Se eliminó ${
        data?.item?.serialNumber ?? "el dispositivo"
      } de la whitelist.`,
    });
  };

  useEffect(() => {
    fetchData();

    // Auto-refresh cada 30 segundos
    const interval = setInterval(fetchData, 30000);

    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    const mediaQuery = window.matchMedia("(min-width: 1024px)");
    const handleChange = (event: MediaQueryListEvent) => {
      setIsDesktop(event.matches);
      if (event.matches) {
        setIsSidebarCollapsed(false);
        setIsMobileSidebarOpen(false);
      } else {
        setIsSidebarCollapsed(true);
        setIsMobileSidebarOpen(false);
      }
    };

    setIsDesktop(mediaQuery.matches);
    if (mediaQuery.matches) {
      setIsSidebarCollapsed(false);
    } else {
      setIsSidebarCollapsed(true);
    }

    mediaQuery.addEventListener("change", handleChange);
    return () => mediaQuery.removeEventListener("change", handleChange);
  }, []);

  // Helpers movidos a modules (formatDateTime y badges dentro de components)

  const activeComputers = computers.filter((c) => c.isActive).length;
  const totalEvents = events.length;
  const recentEvents = events.filter((e) => {
    const eventDate = new Date(e.createdAt);
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
    return eventDate > oneHourAgo;
  }).length;

  const navItems = useMemo<NavItem[]>(
    () => [
      {
        key: "overview",
        label: "Resumen",
        description: "Estado general y métricas en vivo",
        icon: LayoutDashboard,
      },
      {
        key: "events",
        label: "Eventos USB",
        description: "Historial detallado de eventos en la red",
        icon: Usb,
        badge: totalEvents > 0 ? String(totalEvents) : undefined,
      },
      {
        key: "computers",
        label: "Equipos",
        description: "Inventario y estado de los agentes instalados",
        icon: MonitorSmartphone,
        badge:
          computers.length > 0
            ? `${activeComputers}/${computers.length}`
            : undefined,
      },
      {
        key: "whitelist",
        label: "Whitelist",
        description: "Gestiona dispositivos autorizados",
        icon: ShieldCheck,
        badge: whitelist.length > 0 ? String(whitelist.length) : undefined,
      },
      {
        key: "network",
        label: "Escáner de red",
        description: "Descubre hosts activos y estado del agente",
        icon: Radar,
      },
    ],
    [activeComputers, computers.length, totalEvents, whitelist.length]
  );

  const activeItem =
    navItems.find((item) => item.key === activeView) ?? navItems[0];
  const ActiveIcon = activeItem.icon;
  const formattedLastUpdate = lastUpdate.toLocaleTimeString("es-ES");
  const recentEventsForOverview = useMemo(() => events.slice(0, 10), [events]);
  const formattedDate = useMemo(
    () =>
      new Intl.DateTimeFormat("es-ES", {
        weekday: "long",
        year: "numeric",
        month: "long",
        day: "numeric",
      }).format(new Date()),
    []
  );

  const showLabels = isDesktop ? !isSidebarCollapsed : isMobileSidebarOpen;
  const isCompact = !showLabels;
  const sidebarWidth = showLabels
    ? isDesktop
      ? 296
      : 240
    : isDesktop
    ? 96
    : 68;
  const sidebarTargetWidth: number | string = isDesktop
    ? sidebarWidth
    : showLabels
    ? "100%"
    : sidebarWidth;

  const toggleSidebar = () => {
    if (isDesktop) {
      setIsSidebarCollapsed((prev) => !prev);
    } else {
      setIsMobileSidebarOpen((prev) => !prev);
    }
  };

  const handleNavigate = (key: ViewKey) => {
    setActiveView(key);
    if (!isDesktop) {
      setIsMobileSidebarOpen(false);
    }
  };

  let mainContent: React.ReactNode = null;

  switch (activeView) {
    case "overview":
      mainContent = (
        <div className="space-y-6">
          <StatsCards
            activeComputers={activeComputers}
            totalComputers={computers.length}
            totalEvents={totalEvents}
            recentEvents={recentEvents}
            // lastUpdate={lastUpdate}
            whitelistCount={whitelist.length}
          />
          {/* <EventsTab events={recentEventsForOverview} loading={loading} />
          <div className="grid gap-6 lg:grid-cols-3">
            <OverviewComputersCard
              computers={computers}
              onNavigate={() => handleNavigate("computers")}
            />
            <NetworkActionsCard
              onNavigateNetwork={() => handleNavigate("network")}
              onQuickSync={() => fetchData(true)}
              syncing={refreshing}
              totals={{ active: activeComputers, total: computers.length }}
            />
            <WhitelistOverviewCard
              entries={whitelist}
              onNavigate={() => handleNavigate("whitelist")}
            />
          </div> */}
        </div>
      );
      break;
    case "events":
      mainContent = <EventsTab events={events} loading={loading} />;
      break;
    case "computers":
      mainContent = <ComputersTab computers={computers} loading={loading} />;
      break;
    case "whitelist":
      mainContent = (
        <WhitelistTab
          entries={whitelist}
          loading={loading && whitelist.length === 0}
          onCreate={handleCreateWhitelist}
          onDelete={handleDeleteWhitelist}
        />
      );
      break;
    case "network":
      mainContent = <NetworkScannerTab onRefreshComputers={fetchData} />;
      break;
    default:
      mainContent = null;
      break;
  }

  if (checkingRole) {
    return <FullscreenSpinner label="Verificando permisos" />;
  }

  return (
    <div className="relative min-h-screen w-full overflow-x-hidden bg-gradient-to-br from-slate-50 via-white to-slate-100 text-slate-900 transition-colors dark:from-slate-950 dark:via-slate-950 dark:to-slate-900 dark:text-slate-100">
      <div className="pointer-events-none absolute inset-0 opacity-80 [background:radial-gradient(circle_at_top,_rgba(59,130,246,0.08),transparent_55%),radial-gradient(circle_at_bottom,_rgba(16,185,129,0.08),transparent_50%)] dark:[background:radial-gradient(circle_at_top,_rgba(79,70,229,0.12),transparent_55%),radial-gradient(circle_at_bottom,_rgba(56,189,248,0.12),transparent_50%)]" />
      <div className="relative flex min-h-screen w-full flex-col gap-6 px-4 pb-12 pt-10 sm:px-6 lg:flex-row lg:items-start lg:px-12 xl:px-16">
        <motion.aside
          initial={false}
          animate={{ width: sidebarTargetWidth }}
          transition={{ type: "spring", stiffness: 260, damping: 24 }}
          className={cn(
            "relative flex h-full max-h-[calc(100vh-4rem)] flex-col overflow-hidden rounded-3xl border border-slate-200/70 bg-white/60 p-3 text-slate-600 shadow-[0_25px_60px_-35px_rgba(14,165,233,0.35)] transition-colors duration-300 backdrop-blur-xl dark:border-white/10 dark:bg-white/[0.05] dark:text-slate-100 lg:sticky lg:top-10 lg:max-h-[calc(100vh-5rem)] lg:flex-none",
            "supports-[backdrop-filter]:bg-white/30 supports-[backdrop-filter]:dark:bg-white/[0.04]"
          )}
          style={{ width: sidebarTargetWidth }}
        >
          <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top,_rgba(14,165,233,0.12),transparent_55%),radial-gradient(circle_at_bottom,_rgba(16,185,129,0.12),transparent_55%)] opacity-90 dark:bg-[radial-gradient(circle_at_top,_rgba(14,165,233,0.18),transparent_45%),radial-gradient(circle_at_bottom,_rgba(99,102,241,0.18),transparent_50%)]" />
          <div className="relative flex flex-1 flex-col gap-6">
            <div
              className={cn(
                "flex items-center gap-3",
                isCompact && "justify-center"
              )}
            >
              <span className="inline-flex h-11 w-11 items-center justify-center rounded-2xl border border-white/40 bg-white/80 text-cyan-600 shadow-sm dark:border-white/10 dark:bg-white/10 dark:text-cyan-100">
                <Usb className="h-5 w-5" />
              </span>
              <AnimatePresence initial={false}>
                {showLabels && (
                  <motion.div
                    key="sidebar-brand"
                    initial={{ opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -8 }}
                    transition={{ duration: 0.2, ease: "easeOut" }}
                    className="space-y-0.5"
                  >
                    <p className="text-[11px] font-semibold uppercase tracking-[0.28em] text-slate-500 dark:text-slate-400">
                      Monitor USB
                    </p>
                    <p className="text-base font-semibold text-slate-900 dark:text-white">
                      Panel administrativo
                    </p>
                  </motion.div>
                )}
              </AnimatePresence>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    onClick={toggleSidebar}
                    className="ml-auto h-9 w-9 shrink-0 rounded-full border border-white/30 bg-white/80 text-slate-500 shadow-sm hover:bg-white dark:border-white/10 dark:bg-white/10 dark:text-slate-200"
                    aria-label={
                      isDesktop
                        ? isSidebarCollapsed
                          ? "Expandir navegación"
                          : "Contraer navegación"
                        : isMobileSidebarOpen
                        ? "Contraer navegación"
                        : "Expandir navegación"
                    }
                  >
                    {isDesktop ? (
                      isSidebarCollapsed ? (
                        <ChevronsRight className="h-4 w-4" />
                      ) : (
                        <ChevronsLeft className="h-4 w-4" />
                      )
                    ) : (
                      <Menu className="h-4 w-4" />
                    )}
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="right" className="capitalize">
                  {isDesktop
                    ? isSidebarCollapsed
                      ? "Expandir"
                      : "Contraer"
                    : isMobileSidebarOpen
                    ? "Ocultar"
                    : "Mostrar"}
                </TooltipContent>
              </Tooltip>
            </div>
            <nav
              className={cn(
                "flex-1 space-y-1 overflow-y-auto pr-1 [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden",
                showLabels ? "pt-2" : "pt-4"
              )}
            >
              {navItems.map((item) => {
                const isActive = activeView === item.key;
                const button = (
                  <motion.button
                    key={item.key}
                    type="button"
                    onClick={() => handleNavigate(item.key)}
                    whileHover={{
                      scale: showLabels ? 1.01 : 1.05,
                      x: showLabels ? 4 : 0,
                    }}
                    whileTap={{ scale: 0.98 }}
                    className={cn(
                      "group relative flex w-full items-center gap-3 overflow-hidden rounded-2xl px-3 py-2 text-sm font-medium text-slate-500 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400/60 focus-visible:ring-offset-2 focus-visible:ring-offset-white dark:text-slate-300 dark:focus-visible:ring-offset-slate-900",
                      isCompact ? "justify-center" : "pl-3 pr-4",
                      isActive
                        ? "text-cyan-700 dark:text-white"
                        : "hover:text-slate-900 dark:hover:text-white"
                    )}
                    aria-current={isActive ? "page" : undefined}
                  >
                    {isActive && (
                      <motion.span
                        layoutId="sidebar-active-highlight"
                        className="absolute inset-0 rounded-2xl border border-cyan-300/50 bg-cyan-100/60 shadow-[0_10px_35px_-25px_rgba(14,165,233,0.8)] dark:border-cyan-500/30 dark:bg-cyan-500/10"
                        transition={{
                          type: "spring",
                          stiffness: 260,
                          damping: 30,
                        }}
                      />
                    )}
                    <span
                      className={cn(
                        "relative z-10 inline-flex h-9 w-9 items-center justify-center rounded-xl border border-white/40 bg-white/80 text-slate-500 shadow-sm transition-colors dark:border-white/10 dark:bg-white/10 dark:text-slate-200",
                        isActive &&
                          "border-cyan-300/60 bg-cyan-50 text-cyan-600 dark:border-cyan-500/40 dark:bg-cyan-500/10 dark:text-cyan-100"
                      )}
                    >
                      <item.icon className="h-4 w-4" />
                    </span>
                    {showLabels && (
                      <motion.div
                        initial={false}
                        animate={{ opacity: 1, x: 0 }}
                        exit={{ opacity: 0, x: -8 }}
                        className="relative z-10 flex flex-1 flex-col gap-0.5 text-left"
                      >
                        <span className="text-sm font-semibold text-slate-700 dark:text-slate-100">
                          {item.label}
                        </span>
                        <span className="text-xs text-slate-400 dark:text-slate-400/90">
                          {item.description}
                        </span>
                      </motion.div>
                    )}
                    {showLabels && item.badge && (
                      <span className="relative z-10 ml-auto rounded-full border border-cyan-200 bg-cyan-100 px-2 py-0.5 text-xs font-semibold text-cyan-700 shadow-sm dark:border-cyan-400/40 dark:bg-cyan-500/10 dark:text-cyan-100">
                        {item.badge}
                      </span>
                    )}
                    {isCompact && item.badge && (
                      <motion.span
                        layoutId={`${item.key}-badge`}
                        className="absolute -right-0.5 top-1.5 z-10 flex min-h-[18px] min-w-[18px] items-center justify-center rounded-full border border-cyan-200 bg-cyan-100 px-1 text-[10px] font-semibold text-cyan-700 shadow-sm dark:border-cyan-400/40 dark:bg-cyan-500/10 dark:text-cyan-100"
                      >
                        {item.badge}
                      </motion.span>
                    )}
                  </motion.button>
                );

                if (isCompact) {
                  return (
                    <Tooltip key={item.key}>
                      <TooltipTrigger asChild>{button}</TooltipTrigger>
                      <TooltipContent side="right" align="center">
                        {item.label}
                      </TooltipContent>
                    </Tooltip>
                  );
                }

                return <div key={item.key}>{button}</div>;
              })}
            </nav>
            <div className="hidden text-xs text-slate-500 dark:text-slate-400 lg:block">
              <p className="font-medium uppercase tracking-[0.24em] text-slate-400 dark:text-slate-500">
                Última sync
              </p>
              <p className="mt-1 font-semibold text-slate-700 dark:text-slate-200">
                {formattedLastUpdate}
              </p>
            </div>
          </div>
        </motion.aside>
        <div className="relative flex min-w-0 flex-1 flex-col">
          <header className="rounded-3xl border border-slate-200/70 bg-white/80 px-5 py-6 shadow-[0_35px_60px_-40px_rgba(15,23,42,0.45)] backdrop-blur-xl transition-colors dark:border-white/10 dark:bg-white/[0.05]">
            <div className="flex flex-col gap-6 lg:flex-row lg:items-center lg:justify-between">
              <div className="space-y-2">
                <div className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white/90 px-4 py-2 text-xs font-semibold uppercase tracking-[0.28em] text-slate-600 shadow-sm dark:border-white/10 dark:bg-white/5 dark:text-slate-300">
                  <ActiveIcon className="h-3.5 w-3.5" />
                  {activeItem.label}
                </div>
                <div>
                  <h1 className="text-3xl font-semibold tracking-tight text-slate-900 sm:text-4xl dark:text-white">
                    Panel administrativo
                  </h1>
                  <p className="max-w-xl text-sm text-slate-600 sm:text-base dark:text-slate-400">
                    {activeItem.description}
                  </p>
                </div>
              </div>
              <div className="flex flex-col items-start gap-3 sm:flex-row sm:items-center">
                <div className="flex items-center gap-2">
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    onClick={toggleSidebar}
                    className="rounded-full border border-slate-200 bg-white text-slate-600 shadow-sm hover:bg-slate-100 lg:hidden dark:border-white/10 dark:bg-white/5 dark:text-slate-200"
                    aria-label={
                      isMobileSidebarOpen
                        ? "Ocultar navegación"
                        : "Mostrar navegación"
                    }
                  >
                    <Menu className="h-4 w-4" />
                  </Button>
                  <div className="rounded-2xl border border-slate-200/80 bg-white/90 px-4 py-2 text-sm font-medium text-slate-600 shadow-sm dark:border-white/10 dark:bg-white/5 dark:text-slate-200">
                    {formattedDate}
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <span className="hidden text-xs text-slate-500 md:inline-flex dark:text-slate-400">
                    Última actualización: {formattedLastUpdate}
                  </span>
                  <Button
                    onClick={() => fetchData(true)}
                    variant="secondary"
                    size="sm"
                    disabled={refreshing}
                    className={cn(
                      "gap-2 rounded-full border border-cyan-200 bg-cyan-50/80 text-cyan-700 shadow-sm transition-colors hover:bg-cyan-100 dark:border-cyan-400/40 dark:bg-cyan-500/10 dark:text-cyan-100 dark:hover:bg-cyan-500/20",
                      refreshing && "opacity-75"
                    )}
                  >
                    <RefreshCw
                      className={cn("h-4 w-4", refreshing && "animate-spin")}
                    />
                    {refreshing ? "Actualizando" : "Sincronizar"}
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={logout}
                    className="gap-2 rounded-full border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-600 shadow-sm transition-colors hover:bg-slate-100 dark:border-white/10 dark:bg-white/5 dark:text-slate-200"
                  >
                    <LogOut className="h-4 w-4" />
                    Salir
                  </Button>
                </div>
              </div>
            </div>
          </header>
          <main className="mt-6 flex-1">
            {errorMsg && (
              <div className="mb-6 rounded-2xl border border-rose-200 bg-rose-50 px-5 py-3 text-sm text-rose-700 shadow-sm dark:border-rose-500/30 dark:bg-rose-500/10 dark:text-rose-100">
                {errorMsg}
              </div>
            )}
            <AnimatePresence mode="wait">
              <motion.div
                key={activeView}
                initial={{ opacity: 0, x: 20 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -20 }}
                transition={{ duration: 0.25, ease: "easeOut" }}
                className="w-full"
              >
                {mainContent}
              </motion.div>
            </AnimatePresence>
          </main>
        </div>
      </div>
    </div>
  );
}
