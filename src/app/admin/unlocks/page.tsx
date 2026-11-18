"use client";

import { Suspense } from "react";
import { useSearchParams } from "next/navigation";
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

// El filtro por equipo puede venir puesto en la dirección
// (?pc=…), desde los enlaces de la pestaña de Eventos: la
// vista de desbloqueos abre ya filtrada por ese equipo.
function ContenidoDesbloqueos() {
  const params = useSearchParams();
  return <UnlocksTab pcInicial={params.get("pc") ?? ""} />;
}

export default function AdminUnlocksPage() {
  return (
    <Suspense
      fallback={
        <DashboardFallback
          label="Cargando auditoría de desbloqueos"
          variant="table"
        />
      }
    >
      <ContenidoDesbloqueos />
    </Suspense>
  );
}
