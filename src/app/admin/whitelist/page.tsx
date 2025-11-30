"use client";

import dynamic from "next/dynamic";
import { DashboardFallback } from "../_components/DashboardFallback";
import { useAdminDashboard } from "../_providers/AdminDashboardProvider";

const WhitelistTab = dynamic(
  () =>
    import("@/components/dashboard/WhitelistTab").then(
      (mod) => mod.WhitelistTab
    ),
  {
    loading: () => <DashboardFallback label="Cargando whitelist corporativa" />,
  }
);

export default function AdminWhitelistPage() {
  const { whitelist, loading, handleCreateWhitelist, handleDeleteWhitelist } =
    useAdminDashboard();

  return (
    <WhitelistTab
      entries={whitelist}
      loading={loading && whitelist.length === 0}
      onCreate={handleCreateWhitelist}
      onDelete={handleDeleteWhitelist}
    />
  );
}
