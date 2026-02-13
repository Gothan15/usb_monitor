"use client";

import dynamic from "next/dynamic";
import { DashboardFallback } from "../_components/DashboardFallback";

const ComputersTab = dynamic(
  () =>
    import("@/components/dashboard/ComputersTab").then(
      (mod) => mod.ComputersTab
    ),
  {
    loading: () => (
      <DashboardFallback label="Sincronizando inventario de equipos" />
    ),
  }
);

export default function AdminComputersPage() {
  return <ComputersTab />;
}
