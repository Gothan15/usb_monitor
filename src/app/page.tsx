"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { AnimatePresence, motion } from "framer-motion";
import {
  AlertCircle,
  LayoutDashboard,
  MonitorSmartphone,
  Radar,
  ShieldCheck,
  Usb,
  Users,
  Wrench,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { FullscreenSpinner } from "@/components/ui/spinner";
import { AppShell, type AppShellNavItem } from "@/components/system/AppShell";
import { OverviewTab } from "@/components/dashboard/OverviewTab";
import { EventsTab } from "@/components/dashboard/EventsTab";
import { ComputersTab } from "@/components/dashboard/ComputersTab";
import { WhitelistTab } from "@/components/dashboard/WhitelistTab";
import { NetworkScannerTab } from "@/components/dashboard/NetworkScannerTab";
import { SettingsTab } from "@/components/dashboard/SettingsTab";
import { UsersTab } from "@/components/dashboard/UsersTab";
import {
  type USBEvent,
  type Computer,
  type WhitelistEntry,
  formatTime,
} from "@/components/dashboard/types";
import { getCurrentDate } from "@/lib/time";
import { getCsrfTokenFromDocument } from "@/lib/utils";

type ViewKey =
  | "overview"
  | "events"
  | "computers"
  | "users"
  | "whitelist"
  | "network"
  | "settings";

interface SessionResponse {
  ok: boolean;
  user?: {
    name?: string | null;
    username?: string | null;
    role?: string | null;
  };
}

export default function Home() {
  const router = useRouter();
  const { toast } = useToast();

  const [events, setEvents] = useState<USBEvent[]>([]);
  const [computers, setComputers] = useState<Computer[]>([]);
  const [whitelist, setWhitelist] = useState<WhitelistEntry[]>([]);
  const [usersCount, setUsersCount] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [lastUpdate, setLastUpdate] = useState<Date | null>(null);
  const [checkingRole, setCheckingRole] = useState(true);
  const [activeKey, setActiveKey] = useState<ViewKey>("overview");
  const [user, setUser] = useState<{
    name?: string | null;
    role?: string | null;
  } | null>(null);
  const [clearingEvents, setClearingEvents] = useState(false);

  const handleUsersSummaryChange = useCallback(
    ({ total }: { total: number }) => {
      setUsersCount(total);
    },
    []
  );

  useEffect(() => {
    const checkRole = async () => {
      try {
        const res = await fetch("/api/auth/session", {
          credentials: "include",
        });
        const data = (await res.json()) as SessionResponse;

        if (data?.ok && data.user) {
          const role = data.user.role ?? null;
          if (role === "user") {
            router.push("/basic-user");
            return;
          }
          setUser({
            name: data.user.name ?? data.user.username ?? null,
            role,
          });
        }
      } catch (error) {
        console.error("Error verificando rol:", error);
      } finally {
        setCheckingRole(false);
      }
    };

    checkRole();
  }, [router]);

  const fetchData = useCallback(
    async (manual = false) => {
      try {
        if (manual) {
          setRefreshing(true);
        } else {
          setLoading(true);
        }
        setErrorMsg(null);

        const [
          eventsResponse,
          computersResponse,
          whitelistResponse,
          usersResponse,
        ] = await Promise.all([
          fetch("/api/usb-event", {
            cache: "no-store",
            credentials: "include",
          }),
          fetch("/api/computers", {
            cache: "no-store",
            credentials: "include",
          }),
          fetch("/api/whitelist", {
            cache: "no-store",
            credentials: "include",
          }),
          fetch("/api/users?page=1&pageSize=1", {
            cache: "no-store",
            credentials: "include",
          }),
        ]);

        const allOk =
          eventsResponse.ok &&
          computersResponse.ok &&
          whitelistResponse.ok &&
          usersResponse.ok;

        if (eventsResponse.ok) {
          const eventsData = await eventsResponse.json();
          setEvents(eventsData);
        }

        if (computersResponse.ok) {
          const computersData = await computersResponse.json();
          setComputers(computersData);
        }

        if (whitelistResponse.ok) {
          const whitelistData = await whitelistResponse.json();
          setWhitelist(whitelistData?.items ?? whitelistData ?? []);
        }

        if (usersResponse.ok) {
          const usersData = await usersResponse.json();
          setUsersCount(usersData?.total ?? usersData?.items?.length ?? 0);
        }

        if (!allOk) {
          const errorSummary = `Eventos ${eventsResponse.status} / PCs ${computersResponse.status} / Whitelist ${whitelistResponse.status} / Usuarios ${usersResponse.status}`;
          setErrorMsg(`Error al obtener datos (${errorSummary})`);
          if (manual) {
            toast({
              title: "Error al actualizar",
              description: errorSummary,
              variant: "destructive",
            });
          }
        } else {
          const now = getCurrentDate();
          setLastUpdate(now);
          if (manual) {
            toast({
              title: "Datos sincronizados",
              description: `Actualizado a las ${formatTime(now)}`,
            });
          }
        }
      } catch (error) {
        console.error("Error al cargar datos:", error);
        const message =
          error instanceof Error ? error.message : "Fallo de red inesperado";
        setErrorMsg(message);
        if (manual) {
          toast({
            title: "Fallo al actualizar",
            description: message,
            variant: "destructive",
          });
        }
      } finally {
        if (manual) {
          setRefreshing(false);
        } else {
          setLoading(false);
        }
      }
    },
    [toast]
  );

  useEffect(() => {
    fetchData();
    const interval = setInterval(() => fetchData(), 30000);
    return () => clearInterval(interval);
  }, [fetchData]);

  const handleCreateWhitelist = useCallback(
    async (payload: {
      serialNumber: string;
      label?: string;
      notes?: string;
    }) => {
      const csrfToken = getCsrfTokenFromDocument();
      if (!csrfToken) {
        throw new Error(
          "Sesión sin token de seguridad. Vuelve a iniciar sesión e inténtalo otra vez."
        );
      }
      const response = await fetch("/api/whitelist", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-csrf-token": csrfToken,
        },
        body: JSON.stringify(payload),
        credentials: "include",
      });

      const data = await response.json().catch(() => null);
      const ok = response.ok && data?.ok;

      if (!ok) {
        const message = data?.error || `Error HTTP ${response.status}`;
        toast({
          title: "No se pudo agregar el serial",
          description: message,
          variant: "destructive",
        });
        throw new Error(message);
      }

      setWhitelist((prev) => [data.item, ...prev]);
      toast({
        title: "Serial autorizado",
        description: `El dispositivo ${
          data?.item?.serialNumber ?? payload.serialNumber
        } fue agregado.`,
      });
    },
    [toast]
  );

  const handleDeleteWhitelist = useCallback(
    async (id: string) => {
      const csrfToken = getCsrfTokenFromDocument();
      if (!csrfToken) {
        throw new Error(
          "Sesión sin token de seguridad. Vuelve a iniciar sesión e inténtalo otra vez."
        );
      }
      const response = await fetch(`/api/whitelist/${id}`, {
        method: "DELETE",
        headers: {
          "x-csrf-token": csrfToken,
        },
        credentials: "include",
      });

      const data = await response.json().catch(() => null);
      const ok = response.ok && data?.ok;

      if (!ok) {
        const message = data?.error || `Error HTTP ${response.status}`;
        toast({
          title: "No se pudo eliminar el serial",
          description: message,
          variant: "destructive",
        });
        throw new Error(message);
      }

      setWhitelist((prev) => prev.filter((entry) => entry.id !== id));
      toast({
        title: "Serial removido",
        description: `Se eliminó ${
          data?.item?.serialNumber ?? "el dispositivo"
        } de la whitelist.`,
      });
    },
    [toast]
  );

  const handleDeleteComputer = useCallback(
    async (id: string) => {
      const csrfToken = getCsrfTokenFromDocument();
      if (!csrfToken) {
        throw new Error(
          "Sesión sin token de seguridad. Vuelve a iniciar sesión e inténtalo otra vez."
        );
      }
      const response = await fetch(`/api/computers/${id}`, {
        method: "DELETE",
        headers: {
          "x-csrf-token": csrfToken,
        },
        credentials: "include",
      });

      const data = await response.json().catch(() => null);
      const ok = response.ok && data?.ok;

      if (!ok) {
        const message = data?.error || `Error HTTP ${response.status}`;
        toast({
          title: "No se pudo eliminar el equipo",
          description: message,
          variant: "destructive",
        });
        throw new Error(message);
      }

      setComputers((prev) => prev.filter((computer) => computer.id !== id));
      toast({
        title: "Equipo eliminado",
        description: `Se eliminó ${
          data?.item?.name ?? "el equipo"
        } del inventario.`,
      });
    },
    [toast]
  );

  const handleClearEvents = useCallback(async () => {
    if (clearingEvents) return;
    setClearingEvents(true);
    try {
      const csrfToken = getCsrfTokenFromDocument();
      if (!csrfToken) {
        throw new Error(
          "Sesión sin token de seguridad. Vuelve a iniciar sesión e inténtalo otra vez."
        );
      }
      const response = await fetch("/api/usb-event", {
        method: "DELETE",
        headers: {
          "x-csrf-token": csrfToken,
        },
        credentials: "include",
      });
      const data = await response.json().catch(() => null);
      if (!response.ok || data?.ok !== true) {
        const message = data?.error || `Error HTTP ${response.status}`;
        toast({
          title: "No se pudo limpiar el historial",
          description: message,
          variant: "destructive",
        });
        return;
      }

      setEvents([]);
      setLastUpdate(getCurrentDate());
      toast({
        title: "Historial limpiado",
        description:
          typeof data?.deletedEvents === "number"
            ? `Se eliminaron ${data.deletedEvents} eventos.`
            : "Los eventos se limpiaron correctamente.",
      });
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : "Error inesperado al limpiar el historial.";
      toast({
        title: "No se pudo limpiar el historial",
        description: message,
        variant: "destructive",
      });
    } finally {
      setClearingEvents(false);
    }
  }, [clearingEvents, toast]);

  const navItems = useMemo<AppShellNavItem[]>(() => {
    const activeComputers = computers.filter(
      (computer) => computer.isActive
    ).length;
    return [
      {
        key: "overview",
        label: "Resumen",
        description: "Estado general y métricas en vivo",
        icon: LayoutDashboard,
      },
      {
        key: "events",
        label: "Eventos USB",
        description: "Historial detallado de autorizaciones y bloqueos",
        icon: Usb,
        badge: events.length || undefined,
      },
      {
        key: "computers",
        label: "Equipos",
        description: "Inventario y estado de los agentes desplegados",
        icon: MonitorSmartphone,
        badge: computers.length
          ? `${activeComputers}/${computers.length}`
          : undefined,
      },
      {
        key: "users",
        label: "Usuarios",
        description: "Gestiona cuentas y permisos del panel",
        icon: Users,
        badge: usersCount ?? undefined,
      },
      {
        key: "whitelist",
        label: "Whitelist",
        description: "Gestiona los dispositivos autorizados",
        icon: ShieldCheck,
        badge: whitelist.length || undefined,
      },
      {
        key: "network",
        label: "Escáner de red",
        description: "Descubre hosts activos y servicios del agente",
        icon: Radar,
      },
      {
        key: "settings",
        label: "Ajustes",
        description: "Políticas operativas y automatización",
        icon: Wrench,
      },
    ];
  }, [computers, events, whitelist, usersCount]);

  const activeItem =
    navItems.find((item) => item.key === activeKey) ?? navItems[0];

  const lastUpdateLabel = lastUpdate ? formatTime(lastUpdate) : "Sin datos";

  const renderContent = () => {
    switch (activeKey) {
      case "overview":
        return (
          <OverviewTab
            events={events}
            computers={computers}
            whitelist={whitelist}
            loading={loading}
          />
        );
      case "events":
        return (
          <EventsTab
            events={events}
            loading={loading}
            onClear={handleClearEvents}
            clearing={clearingEvents}
          />
        );
      case "computers":
        return (
          <ComputersTab
            computers={computers}
            loading={loading}
            onDelete={handleDeleteComputer}
          />
        );
      case "users":
        return (
          <UsersTab
            onSummaryChange={handleUsersSummaryChange}
            computers={computers}
          />
        );
      case "whitelist":
        return (
          <WhitelistTab
            entries={whitelist}
            loading={loading && whitelist.length === 0}
            onCreate={handleCreateWhitelist}
            onDelete={handleDeleteWhitelist}
          />
        );
      case "network":
        return (
          <NetworkScannerTab
            onRefreshComputers={() => {
              void fetchData(true);
            }}
          />
        );
      case "settings":
        return <SettingsTab />;
      default:
        return null;
    }
  };

  if (checkingRole) {
    return <FullscreenSpinner label="Verificando permisos" />;
  }

  return (
    <AppShell
      navItems={navItems}
      activeKey={activeKey}
      onNavigate={(key) => setActiveKey(key as ViewKey)}
      onRefresh={() => {
        void fetchData(true);
      }}
      refreshing={refreshing}
      lastUpdateLabel={lastUpdateLabel}
      subtitle={activeItem.description}
      title={activeItem.label}
      user={user}
    >
      <AnimatePresence mode="wait">
        <motion.div
          key={activeKey}
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -16 }}
          transition={{ duration: 0.2, ease: "easeOut" }}
          className="space-y-6"
        >
          {errorMsg && (
            <div className="flex items-start gap-3 rounded-2xl border border-rose-200/70 bg-rose-50 px-4 py-3 text-sm text-rose-700 shadow-sm dark:border-rose-500/30 dark:bg-rose-500/10 dark:text-rose-100">
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
              <span>{errorMsg}</span>
            </div>
          )}
          {renderContent()}
        </motion.div>
      </AnimatePresence>
    </AppShell>
  );
}
