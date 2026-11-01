"use client";

import dynamic from "next/dynamic";
import { DashboardFallback } from "../_components/DashboardFallback";

const UnlocksTab = dynamic(
  () => import("@/components/dashboard/UnlocksTab").then((mod) => mod.UnlocksTab),
  {
    loading: () => (
      <DashboardFallback label="Cargando auditoría de desbloqueos" variant="table" />
    ),
  },
);

export default function AdminUnlocksPage() {
  return <UnlocksTab />;
}
