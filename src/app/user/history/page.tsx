"use client";

import dynamic from "next/dynamic";
import { UserWelcomeCard } from "../_components/UserWelcomeCard";
import { useUserDashboard } from "../_providers/UserDashboardProvider";

// Se utiliza carga diferida para mostrar el historial solo cuando se visita la vista.
const EventHistory = dynamic(
  () =>
    import("../components/EventHistory/EventHistory").then(
      (mod) => mod.EventHistory
    ),
  {
    loading: () => (
      <div className="rounded-xl border border-border/40 bg-card/80 p-8 text-center text-sm text-muted-foreground shadow-sm">
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
      <UserWelcomeCard username={user.username} />
      <section className="space-y-4">
        <EventHistory userId={user.id} />
      </section>
    </>
  );
}
