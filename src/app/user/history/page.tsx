"use client";

import dynamic from "next/dynamic";
import { useUserDashboard } from "../_providers/UserDashboardProvider";

// Se utiliza carga diferida para mostrar el historial solo cuando se visita la vista.
const EventHistory = dynamic(
  () =>
    import("../components/EventHistory/EventHistory").then(
      (mod) => mod.EventHistory
    ),
  {
    loading: () => (
      <div className="border-t border-border pt-6 text-sm text-muted-foreground">
        Cargando historial de eventos…
      </div>
    ),
  }
);

export default function UserHistoryPage() {
  const { user } = useUserDashboard();

  if (!user) return null;

  return (
    <>
      <section className="flex flex-1 flex-col">
        <EventHistory userId={user.id} />
      </section>
    </>
  );
}
