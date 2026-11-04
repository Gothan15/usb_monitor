"use client";

import dynamic from "next/dynamic";
import { DashboardFallback } from "../_components/DashboardFallback";

const InstallTasksTab = dynamic(
  () =>
    import("@/components/dashboard/InstallTasksTab").then(
      (mod) => mod.InstallTasksTab,
    ),
  {
    loading: () => (
      <DashboardFallback label="Cargando tareas de instalación" variant="table" />
    ),
  },
);

export default function AdminTasksPage() {
  return <InstallTasksTab />;
}
