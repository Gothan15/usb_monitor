"use client";

import { useMemo, type ReactNode } from "react";
import { usePathname } from "next/navigation";
import { AnimatePresence, motion } from "framer-motion";
import {
  LayoutDashboard,
  MonitorSmartphone,
  Radar,
  ShieldCheck,
  Usb,
  Users,
  Wrench,
} from "lucide-react";
import { AppShell, type AppShellNavItem } from "@/components/system/AppShell";
import { FullscreenSpinner } from "@/components/ui/spinner";
import {
  AdminDashboardProvider,
  useAdminDashboard,
  viewKeyToHref,
  type ViewKey,
} from "./_providers/AdminDashboardProvider";
import { formatTime } from "@/components/dashboard/types";

function resolveViewKey(pathname: string | null): ViewKey {
  const sanitized = pathname?.replace(/^\/+|\/+$/g, "") ?? "";
  const segments = sanitized.split("/");
  const section = segments[1];
  switch (section) {
    case undefined:
      return "overview";
    case "events":
      return "events";
    case "computers":
      return "computers";
    case "users":
      return "users";
    case "whitelist":
      return "whitelist";
    case "network":
      return "network";
    case "settings":
      return "settings";
    default:
      return "overview";
  }
}

function AdminLayoutContent({
  children,
  pathname,
}: {
  children: ReactNode;
  pathname: string | null;
}) {
  const {
    activeKey,
    events = [],
    computers = [],
    whitelist = [],
    usersCount,
    user,
    refreshing,
    checkingRole,
    errorMsg,
    lastUpdate,
    handleRefreshAll,
  } = useAdminDashboard();

  const navItems = useMemo<AppShellNavItem[]>(() => {
    const activeComputers = computers.filter(
      (computer) => computer.isActive
    ).length;
    return [
      {
        key: "overview",
        label: "Resumen",
        description: "Estado general y métricas en vivo",
        icon: LayoutDashboard,
        href: viewKeyToHref.overview,
      },
      {
        key: "events",
        label: "Eventos USB",
        description: "Historial detallado de autorizaciones y bloqueos",
        icon: Usb,
        badge: events.length || undefined,
        href: viewKeyToHref.events,
      },
      {
        key: "computers",
        label: "Equipos",
        description: "Inventario y estado de los agentes desplegados",
        icon: MonitorSmartphone,
        badge: computers.length
          ? `${activeComputers}/${computers.length}`
          : undefined,
        href: viewKeyToHref.computers,
      },
      {
        key: "users",
        label: "Usuarios",
        description: "Gestiona cuentas y permisos del panel",
        icon: Users,
        badge: usersCount ?? undefined,
        href: viewKeyToHref.users,
      },
      {
        key: "whitelist",
        label: "Whitelist",
        description: "Gestiona los dispositivos autorizados",
        icon: ShieldCheck,
        badge: whitelist.length || undefined,
        href: viewKeyToHref.whitelist,
      },
      {
        key: "network",
        label: "Escáner de red",
        description: "Descubre hosts activos y servicios del agente",
        icon: Radar,
        href: viewKeyToHref.network,
      },
      {
        key: "settings",
        label: "Ajustes",
        description: "Políticas operativas y automatización",
        icon: Wrench,
        href: viewKeyToHref.settings,
      },
    ];
  }, [computers, events.length, usersCount, whitelist.length]);

  const activeItem = useMemo(
    () => navItems.find((item) => item.key === activeKey) ?? navItems[0],
    [activeKey, navItems]
  );

  const lastUpdateLabel = lastUpdate ? formatTime(lastUpdate) : "Sin datos";

  if (checkingRole) {
    return <FullscreenSpinner label="Verificando permisos" />;
  }

  return (
    <AppShell
      navItems={navItems}
      activeKey={activeKey}
      onRefresh={() => {
        void handleRefreshAll();
      }}
      refreshing={refreshing}
      lastUpdateLabel={lastUpdateLabel}
      subtitle={activeItem.description}
      title={activeItem.label}
      user={user}
    >
      {/* Animación suave entre subrutas usando la key del pathname actual */}
      <AnimatePresence mode="wait">
        <motion.div
          key={pathname ?? "admin-root"}
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -16 }}
          transition={{ duration: 0.22, ease: "easeOut" }}
          className="space-y-6"
        >
          {errorMsg && (
            <div className="flex items-start gap-3 rounded-2xl border border-rose-200/70 bg-rose-50 px-4 py-3 text-sm text-rose-700 shadow-sm dark:border-rose-500/30 dark:bg-rose-500/10 dark:text-rose-100">
              {errorMsg}
            </div>
          )}
          {children}
        </motion.div>
      </AnimatePresence>
    </AppShell>
  );
}

export default function AdminLayout({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const activeKey = resolveViewKey(pathname);

  return (
    <AdminDashboardProvider activeKey={activeKey}>
      {/* Provider comparte estado/data entre subrutas sin volver a cargar la página */}
      <AdminLayoutContent pathname={pathname}>{children}</AdminLayoutContent>
    </AdminDashboardProvider>
  );
}
