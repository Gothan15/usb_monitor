"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { RefreshCw, LogOut } from "lucide-react";
import { USBEvent, Computer } from "@/components/dashboard/types";
import { StatsCards } from "@/components/dashboard/StatsCards";
import { EventsTab } from "@/components/dashboard/EventsTab";
import { ComputersTab } from "@/components/dashboard/ComputersTab";
import { NetworkScannerTab } from "@/components/dashboard/NetworkScannerTab";

export default function Home() {
  const [events, setEvents] = useState<USBEvent[]>([]);
  const [computers, setComputers] = useState<Computer[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [lastUpdate, setLastUpdate] = useState<Date>(new Date());
  const logout = async () => {
    try {
      await fetch("/api/auth/logout", { method: "POST" });
      try {
        const ch = new BroadcastChannel("auth-state");
        ch.postMessage({ type: "logout" });
        ch.close();
      } catch {}
      window.location.href = "/login";
    } catch {}
  };

  // Lógica de network scanner se movió a componente NetworkScannerTab

  const fetchData = async (manual = false) => {
    try {
      if (manual) {
        setRefreshing(true);
      } else {
        setLoading(true);
      }
      setErrorMsg(null);
      const [eventsResponse, computersResponse] = await Promise.all([
        fetch("/api/usb-event", { cache: "no-store", credentials: "include" }),
        fetch("/api/computers", { cache: "no-store", credentials: "include" }),
      ]);
      // Ya no se redirige a login porque autenticación fue removida.
      if (!eventsResponse.ok || !computersResponse.ok) {
        setErrorMsg(
          "Error al obtener datos (" +
            eventsResponse.status +
            "/" +
            computersResponse.status +
            ")"
        );
      }
      if (eventsResponse.ok) {
        const eventsData = await eventsResponse.json();
        setEvents(eventsData);
      }
      if (computersResponse.ok) {
        const computersData = await computersResponse.json();
        setComputers(computersData);
      }
      setLastUpdate(new Date());
    } catch (error: any) {
      console.error("Error al cargar datos:", error);
      setErrorMsg(error.message || "Fallo de red");
    } finally {
      if (manual) {
        setRefreshing(false);
      } else {
        setLoading(false);
      }
    }
  };

  useEffect(() => {
    fetchData();

    // Auto-refresh cada 30 segundos
    const interval = setInterval(fetchData, 30000);

    return () => clearInterval(interval);
  }, []);

  // Helpers movidos a modules (formatDateTime y badges dentro de components)

  const activeComputers = computers.filter((c) => c.isActive).length;
  const totalEvents = events.length;
  const recentEvents = events.filter((e) => {
    const eventDate = new Date(e.createdAt);
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
    return eventDate > oneHourAgo;
  }).length;

  return (
    <div className="container mx-auto p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">
            Panel de Monitoreo USB
          </h1>
          <p className="text-muted-foreground">
            Monitoreo de eventos USB en tiempo real
          </p>
        </div>
        <div className="flex gap-2">
          <Button
            onClick={() => fetchData(true)}
            variant="outline"
            size="sm"
            disabled={refreshing}
          >
            <RefreshCw
              className={`mr-2 h-4 w-4 ${refreshing ? "animate-spin" : ""}`}
            />{" "}
            {refreshing ? "Actualizando..." : "Actualizar"}
          </Button>
          <Button onClick={logout} variant="outline" size="sm">
            <LogOut className="h-4 w-4 mr-1" /> Salir
          </Button>
        </div>
      </div>

      {errorMsg && (
        <div className="text-sm text-red-500 border border-red-300 rounded p-2 bg-red-50">
          {errorMsg}
        </div>
      )}

      <StatsCards
        activeComputers={activeComputers}
        totalComputers={computers.length}
        totalEvents={totalEvents}
        recentEvents={recentEvents}
        lastUpdate={lastUpdate}
      />

      <Tabs defaultValue="events" className="space-y-4">
        <TabsList>
          <TabsTrigger value="events">Eventos USB</TabsTrigger>
          <TabsTrigger value="computers">Computadoras</TabsTrigger>
          <TabsTrigger value="network">Escáner de Red</TabsTrigger>
        </TabsList>

        <TabsContent value="events" className="space-y-4">
          <EventsTab events={events} loading={loading} />
        </TabsContent>

        <TabsContent value="computers" className="space-y-4">
          <ComputersTab computers={computers} loading={loading} />
        </TabsContent>

        <TabsContent value="network" className="space-y-4">
          <NetworkScannerTab onRefreshComputers={fetchData} />
        </TabsContent>
      </Tabs>
    </div>
  );
}
