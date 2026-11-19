"use client";

import dynamic from "next/dynamic";
import { useUserDashboard } from "./_providers/UserDashboardProvider";

// Carga diferida para mantener el bundle ligero en vistas básicas.
const DeviceList = dynamic(
  () =>
    import("./components/DeviceList/DeviceList").then((mod) => mod.DeviceList),
  {
    loading: () => (
      <div className="border-t border-border pt-6 text-sm text-muted-foreground">
        Preparando lista de dispositivos autorizados…
      </div>
    ),
  }
);

export default function UserDevicesPage() {
  const { user } = useUserDashboard();

  if (!user) return null;

  return (
    <section className="flex flex-1 flex-col">
      <DeviceList userId={user.id} />
    </section>
  );
}
