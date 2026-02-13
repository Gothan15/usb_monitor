"use client";

import dynamic from "next/dynamic";
import { DashboardFallback } from "./_components/DashboardFallback";

// Cargamos el bloque principal bajo demanda para reducir el bundle inicial del dashboard.
const OverviewTab = dynamic(
  () =>
    import("@/components/dashboard/OverviewTab").then((mod) => mod.OverviewTab),
  {
    loading: () => <DashboardFallback label="Cargando resumen general" />,
  }
);

export default function AdminOverviewPage() {
  return <OverviewTab />;
}
