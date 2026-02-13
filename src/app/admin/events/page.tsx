"use client";

import dynamic from "next/dynamic";
import { DashboardFallback } from "../_components/DashboardFallback";

// Se aplica carga diferida para la tabla de eventos por su tamaño y dependencias gráficas.
const EventsTab = dynamic(
  () => import("@/components/dashboard/EventsTab").then((mod) => mod.EventsTab),
  {
    loading: () => (
      <DashboardFallback label="Preparando historial de eventos" />
    ),
  }
);

export default function AdminEventsPage() {
  return <EventsTab />;
}
