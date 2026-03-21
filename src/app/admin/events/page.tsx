"use client";

import dynamic from "next/dynamic";
import { DashboardFallback } from "../_components/DashboardFallback";
import { useAdminDashboard } from "../_providers/AdminDashboardProvider";

// Se aplica carga diferida para la tabla de eventos por su tamaño y dependencias gráficas.
const EventsTab = dynamic(
  () => import("@/components/dashboard/EventsTab").then((mod) => mod.EventsTab),
  {
    loading: () => (
      <DashboardFallback
        label="Preparando historial de eventos"
        variant="table"
      />
    ),
  },
);

export default function AdminEventsPage() {
  const { events, loading, handleClearEvents, clearingEvents } =
    useAdminDashboard();

  return (
    <EventsTab
      events={events}
      loading={loading}
      onClear={handleClearEvents}
      clearing={clearingEvents}
    />
  );
}
