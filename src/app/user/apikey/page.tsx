"use client";

import dynamic from "next/dynamic";
import { UserWelcomeCard } from "../_components/UserWelcomeCard";
import { useUserDashboard } from "../_providers/UserDashboardProvider";

// Diferimos la carga del visor de clave API hasta que el usuario lo solicita.
const ApiKeyDisplay = dynamic(
  () =>
    import("../components/ApiKeyDisplay/ApiKeyDisplay").then(
      (mod) => mod.ApiKeyDisplay,
    ),
  {
    loading: () => (
      <div className="rounded-xl border border-border/40 bg-card/80 p-8 text-center text-sm text-muted-foreground shadow-sm">
        Preparando clave API asignada...
      </div>
    ),
  },
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
