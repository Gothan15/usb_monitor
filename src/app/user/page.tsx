"use client";

import dynamic from "next/dynamic";
import { useUserDashboard } from "./_providers/UserDashboardProvider";

// Carga diferida para mantener el bundle ligero en vistas básicas.
const DeviceList = dynamic(
  () =>
    import("./components/DeviceList/DeviceList").then((mod) => mod.DeviceList),
  {
    loading: () => (
      <div className="rounded-2xl border border-slate-200/60 bg-white/60 p-8 text-center text-sm text-slate-500 shadow-sm dark:border-slate-800/60 dark:bg-slate-900/60 dark:text-slate-300">
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
