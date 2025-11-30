"use client";

import dynamic from "next/dynamic";
import { DashboardFallback } from "../_components/DashboardFallback";
import { useAdminDashboard } from "../_providers/AdminDashboardProvider";

const NetworkScannerTab = dynamic(
  () =>
    import("@/components/dashboard/NetworkScannerTab").then(
      (mod) => mod.NetworkScannerTab
    ),
  {
    loading: () => <DashboardFallback label="Escaneando red corporativa" />,
  }
);

export default function AdminNetworkPage() {
  const { refreshComputers } = useAdminDashboard();

  return (
    <NetworkScannerTab
      onRefreshComputers={() => {
        void refreshComputers();
      }}
    />
  );
}
