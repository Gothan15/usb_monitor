"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { useToast } from "@/hooks/use-toast";
import { fetchJson, HttpError } from "@/lib/http";
import { getCsrfTokenFromDocument } from "@/lib/utils";
import {
  type Computer,
  type USBEvent,
  type WhitelistEntry,
  formatTime,
} from "@/components/dashboard/types";

export type ViewKey =
  | "overview"
  | "events"
  | "computers"
  | "users"
  | "whitelist"
  | "network"
  | "settings";

// Mapeo centralizado para traducir cada pestaña del dashboard al href de Next.js.
export const viewKeyToHref: Record<ViewKey, string> = {
  overview: "/admin",
  events: "/admin/events",
  computers: "/admin/computers",
  users: "/admin/users",
  whitelist: "/admin/whitelist",
  network: "/admin/network",
  settings: "/admin/settings",
};

interface SessionResponse {
  ok: boolean;
  user?: {
    name?: string | null;
    username?: string | null;
    role?: string | null;
  };
}

interface AdminDashboardContextValue {
  activeKey: ViewKey;
  events: USBEvent[];
  computers: Computer[];
  whitelist: WhitelistEntry[];
  usersCount: number | null;
  user: {
    name?: string | null;
    role?: string | null;
  } | null;
  loading: boolean;
  refreshing: boolean;
  checkingRole: boolean;
  errorMsg: string | null;
  lastUpdate: Date | null;
  clearingEvents: boolean;
  handleRefreshAll: () => Promise<void>;
  handleClearEvents: () => Promise<void>;
  handleCreateWhitelist: (payload: {
    serialNumber: string;
    label?: string;
    notes?: string;
  }) => Promise<void>;
  handleDeleteWhitelist: (id: string) => Promise<void>;
  handleDeleteComputer: (id: string) => Promise<void>;
  handleUsersSummaryChange: (payload: { total: number }) => void;
  refreshComputers: () => Promise<void>;
  navigateTo: (key: ViewKey) => void;
}

const AdminDashboardContext = createContext<AdminDashboardContextValue | null>(
  null
);

export function AdminDashboardProvider({
  activeKey,
  children,
}: {
  activeKey: ViewKey;
  children: ReactNode;
}) {
  const router = useRouter();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const [usersCount, setUsersCount] = useState<number | null>(null);
  const [checkingRole, setCheckingRole] = useState(true);
  const [user, setUser] = useState<{
    name?: string | null;
    role?: string | null;
  } | null>(null);
  const [clearingEvents, setClearingEvents] = useState(false);

  const needs = useMemo(
    () => ({
      events: ["overview", "events"].includes(activeKey),
      computers: ["overview", "computers", "network", "users"].includes(
        activeKey
      ),
      whitelist: ["overview", "whitelist"].includes(activeKey),
      users: ["overview", "users", "settings"].includes(activeKey),
    }),
    [activeKey]
  );

  useEffect(() => {
    const checkRole = async () => {
      try {
        const res = await fetch("/api/auth/session", {
          credentials: "include",
        });
        const data = (await res.json()) as SessionResponse;
        if (data?.ok && data.user) {
          const role = data.user.role?.toLowerCase?.() ?? null;
          if (role === "user") {
            router.push("/user");
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

    void checkRole();
  }, [router]);

  const eventsQuery = useQuery<USBEvent[]>({
    queryKey: ["events"],
    queryFn: () => fetchJson<USBEvent[]>("/api/usb-event"),
    enabled: !checkingRole && needs.events,
    staleTime: 30_000,
    refetchInterval: needs.events ? 60_000 : false,
  });

  const computersQuery = useQuery<Computer[]>({
    queryKey: ["computers"],
    queryFn: () => fetchJson<Computer[]>("/api/computers"),
    enabled: !checkingRole && needs.computers,
    staleTime: 30_000,
    refetchInterval: needs.computers ? 60_000 : false,
  });

  const whitelistQuery = useQuery<WhitelistEntry[]>({
    queryKey: ["whitelist"],
    queryFn: async () => {
      const raw = await fetchJson<
        { items?: WhitelistEntry[] } | WhitelistEntry[]
      >("/api/whitelist");
      if (Array.isArray(raw)) {
        return raw;
      }
      if (raw && Array.isArray(raw.items)) {
        return raw.items;
      }
      return [];
    },
    enabled: !checkingRole && needs.whitelist,
    staleTime: 30_000,
    refetchInterval: needs.whitelist ? 120_000 : false,
  });

  const usersSummaryQuery = useQuery<number>({
    queryKey: ["users", "summary"],
    queryFn: async () => {
      const summary = await fetchJson<{
        total?: number;
        items?: unknown[];
      }>("/api/users?page=1&pageSize=1");
      if (typeof summary?.total === "number") {
        return summary.total;
      }
      if (Array.isArray(summary?.items)) {
        return summary.items.length;
      }
      return 0;
    },
    enabled: !checkingRole && needs.users,
    staleTime: 60_000,
    refetchInterval: needs.users ? 120_000 : false,
  });

  useEffect(() => {
    if (typeof usersSummaryQuery.data === "number") {
      setUsersCount(usersSummaryQuery.data);
    }
  }, [usersSummaryQuery.data]);

  const events = eventsQuery.data ?? [];
  const computers = computersQuery.data ?? [];
  const whitelist = whitelistQuery.data ?? [];

  const loading =
    checkingRole ||
    (needs.events && eventsQuery.isPending) ||
    (needs.computers && computersQuery.isPending) ||
    (needs.whitelist && whitelistQuery.isPending) ||
    (needs.users && usersSummaryQuery.isPending);

  const refreshing =
    eventsQuery.isRefetching ||
    computersQuery.isRefetching ||
    whitelistQuery.isRefetching ||
    usersSummaryQuery.isRefetching;

  const lastUpdate = useMemo(() => {
    const timestamps = [
      eventsQuery.dataUpdatedAt,
      computersQuery.dataUpdatedAt,
      whitelistQuery.dataUpdatedAt,
      usersSummaryQuery.dataUpdatedAt,
    ].filter(
      (value): value is number => typeof value === "number" && value > 0
    );
    if (!timestamps.length) return null;
    return new Date(Math.max(...timestamps));
  }, [
    eventsQuery.dataUpdatedAt,
    computersQuery.dataUpdatedAt,
    whitelistQuery.dataUpdatedAt,
    usersSummaryQuery.dataUpdatedAt,
  ]);

  const errorMsg = useMemo(() => {
    const error =
      eventsQuery.error ||
      computersQuery.error ||
      whitelistQuery.error ||
      usersSummaryQuery.error;
    if (!error) return null;
    if (error instanceof HttpError) return error.message;
    if (error instanceof Error) return error.message;
    return "Error desconocido al sincronizar datos";
  }, [
    eventsQuery.error,
    computersQuery.error,
    whitelistQuery.error,
    usersSummaryQuery.error,
  ]);

  const handleUsersSummaryChange = useCallback(
    ({ total }: { total: number }) => {
      setUsersCount(total);
    },
    []
  );

  const refreshComputers = useCallback(async () => {
    await queryClient.invalidateQueries({ queryKey: ["computers"] });
  }, [queryClient]);

  const handleRefreshAll = useCallback(async () => {
    try {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["events"] }),
        queryClient.invalidateQueries({ queryKey: ["computers"] }),
        queryClient.invalidateQueries({ queryKey: ["whitelist"] }),
        queryClient.invalidateQueries({ queryKey: ["users", "summary"] }),
      ]);
      const now = new Date();
      toast({
        title: "Datos sincronizados",
        description: `Actualizado a las ${formatTime(now)}`,
      });
    } catch (error) {
      const message =
        error instanceof HttpError
          ? error.message
          : error instanceof Error
          ? error.message
          : "Error al refrescar los datos";
      toast({
        title: "Error al actualizar",
        description: message,
        variant: "destructive",
      });
    }
  }, [queryClient, toast]);

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

      if (data?.item) {
        queryClient.setQueryData<WhitelistEntry[] | undefined>(
          ["whitelist"],
          (prev = []) => {
            const filtered = prev.filter((entry) => entry.id !== data.item.id);
            return [data.item as WhitelistEntry, ...filtered];
          }
        );
      } else {
        await queryClient.invalidateQueries({ queryKey: ["whitelist"] });
      }
      toast({
        title: "Serial autorizado",
        description: `El dispositivo ${
          data?.item?.serialNumber ?? payload.serialNumber
        } fue agregado.`,
      });

      void queryClient.invalidateQueries({ queryKey: ["whitelist"] });
    },
    [queryClient, toast]
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

      queryClient.setQueryData<WhitelistEntry[] | undefined>(
        ["whitelist"],
        (prev = []) => prev.filter((entry) => entry.id !== id)
      );
      void queryClient.invalidateQueries({ queryKey: ["whitelist"] });
      toast({
        title: "Serial removido",
        description: `Se eliminó ${
          data?.item?.serialNumber ?? "el dispositivo"
        } de la whitelist.`,
      });
    },
    [queryClient, toast]
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

      queryClient.setQueryData<Computer[] | undefined>(
        ["computers"],
        (prev = []) => prev.filter((computer) => computer.id !== id)
      );
      void queryClient.invalidateQueries({ queryKey: ["computers"] });
      toast({
        title: "Equipo eliminado",
        description: `Se eliminó ${
          data?.item?.name ?? "el equipo"
        } del inventario.`,
      });
    },
    [queryClient, toast]
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
        setClearingEvents(false);
        return;
      }

      await queryClient.invalidateQueries({ queryKey: ["events"] });
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
  }, [clearingEvents, queryClient, toast]);

  const navigateTo = useCallback(
    (key: ViewKey) => {
      const href = viewKeyToHref[key];
      if (!href) return;
      router.push(href);
    },
    [router]
  );

  const value = useMemo<AdminDashboardContextValue>(
    () => ({
      activeKey,
      events,
      computers,
      whitelist,
      usersCount,
      user,
      loading,
      refreshing,
      checkingRole,
      errorMsg,
      lastUpdate,
      clearingEvents,
      handleRefreshAll,
      handleClearEvents,
      handleCreateWhitelist,
      handleDeleteWhitelist,
      handleDeleteComputer,
      handleUsersSummaryChange,
      refreshComputers,
      navigateTo,
    }),
    [
      activeKey,
      clearingEvents,
      computers,
      errorMsg,
      events,
      handleClearEvents,
      handleCreateWhitelist,
      handleDeleteComputer,
      handleDeleteWhitelist,
      handleRefreshAll,
      handleUsersSummaryChange,
      lastUpdate,
      loading,
      navigateTo,
      refreshComputers,
      refreshing,
      user,
      usersCount,
      whitelist,
      checkingRole,
    ]
  );

  return (
    <AdminDashboardContext.Provider value={value}>
      {children}
    </AdminDashboardContext.Provider>
  );
}

export function useAdminDashboard() {
  const context = useContext(AdminDashboardContext);
  if (!context) {
    throw new Error(
      "useAdminDashboard debe usarse dentro de AdminDashboardProvider"
    );
  }
  return context;
}
