"use client";

import dynamic from "next/dynamic";
import { useUserDashboard } from "./_providers/UserDashboardProvider";

// Carga diferida para mantener el bundle ligero en vistas básicas.
const DeviceList = dynamic(
  () =>
    import("./components/DeviceList/DeviceList").then((mod) => mod.DeviceList),
  {
    loading: () => (
      <div className="rounded-xl border border-border/40 bg-card/80 p-8 text-center text-sm text-muted-foreground shadow-sm">
        Preparando lista de dispositivos autorizados…
      </div>
    ),
  }
);

export default function UserDevicesPage() {
  const { user } = useUserDashboard();

  if (!user) return null;

  return (
    <section className="space-y-4">
      <DeviceList userId={user.id} />
    </section>
  );
}
