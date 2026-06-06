"use client";

import { useMemo, type ReactNode } from "react";
import { usePathname } from "next/navigation";
import { Clock, Key, Usb } from "lucide-react";
import { AppShell, type AppShellNavItem } from "@/components/shell/AppShell";
import { CommandPalette } from "@/components/shell/CommandPalette";
import { PageTransition } from "@/components/shell/PageTransition";
import { LiveDataProvider } from "@/components/providers/LiveDataProvider";
import { TourEngine } from "@/components/onboarding/TourEngine";
import { ErrorBoundary } from "@/components/shared/ErrorBoundary";
import { userTour } from "@/lib/tours";
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
}: Readonly<{
  children: ReactNode;
  pathname: string | null;
}>) {
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
        label: "Clave API",
        description: "Credenciales seguras",
        icon: Key,
        href: userViewToHref.apikey,
      },
    ],
    [],
  );

  const activeItem = useMemo(
    () => navItems.find((item) => item.key === activeView) ?? navItems[0],
    [activeView, navItems],
  );

  if (loading && !user) {
    return <FullscreenSpinner label="Preparando panel" />;
  }

  if (!user) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
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
      <CommandPalette role="USER" />
      <TourEngine tour={userTour} />
      <PageTransition
        transitionKey={pathname ?? "user-root"}
        className="space-y-6"
      >
        <ErrorBoundary>{children}</ErrorBoundary>
      </PageTransition>
    </AppShell>
  );
}

export default function UserLayout({
  children,
}: Readonly<{ children: ReactNode }>) {
  const pathname = usePathname();
  const activeView = resolveView(pathname);

  return (
    <UserDashboardProvider activeView={activeView}>
      <LiveDataProvider>
        <UserLayoutContent pathname={pathname}>{children}</UserLayoutContent>
      </LiveDataProvider>
    </UserDashboardProvider>
  );
}
