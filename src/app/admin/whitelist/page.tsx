"use client";

import dynamic from "next/dynamic";
import { DashboardFallback } from "../_components/DashboardFallback";

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
  return <WhitelistTab />;
}
