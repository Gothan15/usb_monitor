"use client";

import dynamic from "next/dynamic";
import { DashboardFallback } from "../_components/DashboardFallback";

const SettingsTab = dynamic(
  () =>
    import("@/components/dashboard/SettingsTab").then((mod) => mod.SettingsTab),
  {
    loading: () => <DashboardFallback label="Cargando ajustes avanzados" />,
  }
);

export default function AdminSettingsPage() {
  return <SettingsTab />;
}
