"use client";

import dynamic from "next/dynamic";
import { DashboardFallback } from "../_components/DashboardFallback";
import { useAdminDashboard } from "../_providers/AdminDashboardProvider";

const UsersTab = dynamic(
  () => import("@/components/dashboard/UsersTab").then((mod) => mod.UsersTab),
  {
    loading: () => <DashboardFallback label="Cargando gestión de usuarios" />,
  }
);

export default function AdminUsersPage() {
  const { computers, handleUsersSummaryChange } = useAdminDashboard();

  return (
    <UsersTab
      onSummaryChange={handleUsersSummaryChange}
      computers={computers}
    />
  );
}
