"use client";

import dynamic from "next/dynamic";
import { DashboardFallback } from "../_components/DashboardFallback";
import { useAdminDashboard } from "../_providers/AdminDashboardProvider";

const ComputersTab = dynamic(
  () =>
    import("@/components/dashboard/ComputersTab").then(
      (mod) => mod.ComputersTab,
    ),
  {
    loading: () => (
      <DashboardFallback
        label="Sincronizando inventario de equipos"
        variant="table"
      />
    ),
  },
);

export default function AdminComputersPage() {
  const { computers, loading, handleDeleteComputer } = useAdminDashboard();

  return (
    <ComputersTab
      computers={computers}
      loading={loading}
      onDelete={handleDeleteComputer}
    />
  );
}
