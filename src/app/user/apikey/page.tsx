"use client";

import dynamic from "next/dynamic";
import { UserWelcomeCard } from "../_components/UserWelcomeCard";
import { useUserDashboard } from "../_providers/UserDashboardProvider";

// Diferimos la carga del visor de API key hasta que el usuario lo solicita.
const ApiKeyDisplay = dynamic(
  () =>
    import("../components/ApiKeyDisplay/ApiKeyDisplay").then(
      (mod) => mod.ApiKeyDisplay
    ),
  {
    loading: () => (
      <div className="rounded-2xl border border-slate-200/60 bg-white/60 p-8 text-center text-sm text-slate-500 shadow-sm dark:border-slate-800/60 dark:bg-slate-900/60 dark:text-slate-300">
        Preparando API key asignada…
      </div>
    ),
  }
);

export default function UserApiKeyPage() {
  const { user } = useUserDashboard();

  if (!user) return null;

  return (
    <>
      <UserWelcomeCard username={user.username} />
      <section className="space-y-4">
        <ApiKeyDisplay userId={user.id} />
      </section>
    </>
  );
}
