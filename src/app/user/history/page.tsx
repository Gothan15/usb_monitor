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
      <div className="rounded-2xl border border-slate-200/60 bg-white/60 p-8 text-center text-sm text-slate-500 shadow-sm dark:border-slate-800/60 dark:bg-slate-900/60 dark:text-slate-300">
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
