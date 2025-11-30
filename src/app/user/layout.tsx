"use client";

import { useMemo, type ReactNode } from "react";
import { usePathname } from "next/navigation";
import { AnimatePresence, motion } from "framer-motion";
import { Clock, Key, Usb } from "lucide-react";
import { AppShell, type AppShellNavItem } from "@/components/system/AppShell";
import { FullscreenSpinner } from "@/components/ui/spinner";
import {
  UserDashboardProvider,
  useUserDashboard,
  userViewToHref,
  type UserViewKey,
} from "./_providers/UserDashboardProvider";

function resolveView(pathname: string | null): UserViewKey {
  const sanitized = pathname?.replace(/^\/+|\/+$/g, "") ?? "";
  const segments = sanitized.split("/");
  const section = segments[1];
  switch (section) {
    case undefined:
      return "devices";
    case "history":
      return "history";
    case "apikey":
      return "apikey";
    default:
      return "devices";
  }
}

function UserLayoutContent({
  children,
  pathname,
}: {
  children: ReactNode;
  pathname: string | null;
}) {
  const { user, loading, error, activeView } = useUserDashboard();

  const navItems = useMemo<AppShellNavItem[]>(
    () => [
      {
        key: "devices",
        label: "Dispositivos",
        description: "Estado de USB activos",
        icon: Usb,
        href: userViewToHref.devices,
      },
      {
        key: "history",
        label: "Historial",
        description: "Eventos recientes",
        icon: Clock,
        href: userViewToHref.history,
      },
      {
        key: "apikey",
        label: "API Key",
        description: "Credenciales seguras",
        icon: Key,
        href: userViewToHref.apikey,
      },
    ],
    []
  );

  const activeItem = useMemo(
    () => navItems.find((item) => item.key === activeView) ?? navItems[0],
    [activeView, navItems]
  );

  if (loading && !user) {
    return <FullscreenSpinner label="Preparando panel" />;
  }

  if (!user) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-100 dark:bg-slate-950">
        <div className="rounded-2xl border border-red-200/70 bg-red-50 px-6 py-4 text-sm text-red-700 shadow-sm dark:border-red-500/30 dark:bg-red-500/10 dark:text-red-100">
          {error || "No se pudo cargar la información del usuario."}
        </div>
      </div>
    );
  }

  return (
    <AppShell
      navItems={navItems}
      activeKey={activeView}
      subtitle={activeItem.description}
      title={activeItem.label}
      user={{
        name: user.username,
        role: "Usuario básico",
      }}
    >
      <AnimatePresence mode="wait">
        <motion.div
          key={pathname ?? "user-root"}
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -16 }}
          transition={{ duration: 0.22, ease: "easeOut" }}
          className="space-y-6"
        >
          {children}
        </motion.div>
      </AnimatePresence>
    </AppShell>
  );
}

export default function UserLayout({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const activeView = resolveView(pathname);

  return (
    <UserDashboardProvider activeView={activeView}>
      {/* Provider comparte sesión con todas las subrutas del dashboard */}
      <UserLayoutContent pathname={pathname}>{children}</UserLayoutContent>
    </UserDashboardProvider>
  );
}
