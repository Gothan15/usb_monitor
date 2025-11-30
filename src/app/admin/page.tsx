"use client";

import dynamic from "next/dynamic";
import { DashboardFallback } from "./_components/DashboardFallback";
import { useAdminDashboard } from "./_providers/AdminDashboardProvider";

// Cargamos el bloque principal bajo demanda para reducir el bundle inicial del dashboard.
const OverviewTab = dynamic(
  () =>
    import("@/components/dashboard/OverviewTab").then((mod) => mod.OverviewTab),
  {
    loading: () => <DashboardFallback label="Cargando resumen general" />,
  }
);

export default function AdminOverviewPage() {
  const { events, computers, whitelist, loading } = useAdminDashboard();

  return (
    <OverviewTab
      events={events}
      computers={computers}
      whitelist={whitelist}
      loading={loading}
    />
  );
}
