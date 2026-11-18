"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { ListTodo } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { emitNotification } from "@/lib/notificationBus";
import { fetchJson, HttpError } from "@/lib/http";
import * as equiposApi from "@/lib/api/equipos";
import * as eventosApi from "@/lib/api/eventos";
import * as listaBlancaApi from "@/lib/api/listaBlanca";
import {
  type Computer,
  type USBEvent,
  type WhitelistEntry,
  formatTime,
} from "@/components/dashboard/types";
import { useLiveSyncStore } from "@/store/useLiveSyncStore";

export type ViewKey =
  | "overview"
  | "events"
  | "computers"
  | "users"
  | "whitelist"
  | "unlocks"
  | "tasks"
  | "network"
  | "settings";

// Mapeo centralizado para traducir cada pestaña del dashboard al href de Next.js.
export const viewKeyToHref: Record<ViewKey, string> = {
  overview: "/admin",
  events: "/admin/events",
  computers: "/admin/computers",
  users: "/admin/users",
  whitelist: "/admin/whitelist",
  unlocks: "/admin/unlocks",
  tasks: "/admin/tasks",
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

/** Resumen de una tarea de instalación: lo justo para el
 *  distintivo de la pestaña y el aviso cuando termina. */
interface TareaResumen {
  id: string;
  status: string;
  targets?: { status: string }[];
}

interface AdminDashboardContextValue {
  activeKey: ViewKey;
  events: USBEvent[];
  computers: Computer[];
  whitelist: WhitelistEntry[];
  usersCount: number | null;
  tareasActivas: number;
  /** Dispositivos bloqueados ahora mismo (medalla de Desbloqueos). */
  bloqueadosAhora: number;
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
  handleBulkDeleteWhitelist: (ids: string[]) => Promise<void>;
  handleBulkDeleteComputers: (ids: string[]) => Promise<void>;
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
  const { isLiveSyncEnabled } = useLiveSyncStore();

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

  // Las cuatro consultas se piden al abrir el panel, en paralelo,
  // aunque su pestaña no esté activa: son peticiones baratas en red
  // local y así cambiar de pestaña no espera datos la primera vez.
  // El refresco periódico sí sigue limitado a la pestaña activa
  // (refetchInterval con «needs»), y «loading» también: la precarga
  // en segundo plano no bloquea la pestaña que se está viendo.
  const eventsQuery = useQuery<USBEvent[]>({
    queryKey: ["events"],
    queryFn: () => fetchJson<USBEvent[]>("/api/usb-event"),
    enabled: !checkingRole,
    staleTime: 30_000,
    refetchInterval: needs.events && isLiveSyncEnabled ? 60_000 : false,
  });

  const computersQuery = useQuery<Computer[]>({
    queryKey: ["computers"],
    queryFn: () => fetchJson<Computer[]>("/api/computers"),
    enabled: !checkingRole,
    staleTime: 30_000,
    refetchInterval: needs.computers && isLiveSyncEnabled ? 60_000 : false,
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
    enabled: !checkingRole,
    staleTime: 30_000,
    refetchInterval: needs.whitelist && isLiveSyncEnabled ? 120_000 : false,
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
    enabled: !checkingRole,
    staleTime: 60_000,
    refetchInterval: needs.users && isLiveSyncEnabled ? 120_000 : false,
  });

  // Tareas de instalación (las últimas 20): de aquí salen el
  // distintivo de la pestaña de Tareas — cuántas están EN
  // CURSO, como el de Equipos o el de Lista blanca con los
  // suyos — y el aviso cuando una tarea termina y no se está
  // mirando esa pestaña. Mientras alguna corre, el sondeo va
  // a 10 s para que el aviso llegue pronto; en reposo, a 60 s.
  const tareasQuery = useQuery<TareaResumen[]>({
    queryKey: ["install-tasks", "resumen"],
    queryFn: async () => {
      const datos = await fetchJson<{ tareas?: TareaResumen[] }>(
        "/api/install-tasks",
      );
      return datos?.tareas ?? [];
    },
    enabled: !checkingRole,
    staleTime: 10_000,
    refetchInterval: (query) => {
      if (!isLiveSyncEnabled) return false;
      const tareas = query.state.data ?? [];
      return tareas.some((tarea) => tarea.status === "EN_CURSO")
        ? 10_000
        : 60_000;
    },
  });
  const tareas = tareasQuery.data ?? [];
  const tareasActivas = tareas.filter(
    (tarea) => tarea.status === "EN_CURSO",
  ).length;

  // Bloqueados ahora mismo: solo el conteo, para la medalla
  // de la pestaña «Desbloqueos» — saber que hay dispositivos
  // esperando contraseña sin entrar a la vista. Sondeo al
  // minuto, como el resto de distintivos.
  const bloqueadosQuery = useQuery<number>({
    queryKey: ["unlocks", "conteo"],
    queryFn: async () => {
      const datos = await fetchJson<{ bloqueados?: number }>(
        "/api/admin/unlocks/conteo",
      );
      return datos?.bloqueados ?? 0;
    },
    enabled: !checkingRole,
    staleTime: 30_000,
    refetchInterval: isLiveSyncEnabled ? 60_000 : false,
  });
  const bloqueadosAhora = bloqueadosQuery.data ?? 0;

  // Aviso al terminar una tarea: se vigilan las transiciones
  // de EN CURSO a COMPLETADA o CON_ERRORES. La primera carga
  // solo siembra el mapa (las tareas viejas no avisan), y si
  // la pestaña de Tareas es la que se está viendo no hace
  // falta avisar: ya se está mirando. El aviso sale en una
  // tarjeta y queda también en la campana de notificaciones.
  const estadosTareasRef = useRef<Map<string, string> | null>(null);
  const activeKeyRef = useRef(activeKey);
  useEffect(() => {
    activeKeyRef.current = activeKey;
  }, [activeKey]);
  useEffect(() => {
    const previos = estadosTareasRef.current;
    estadosTareasRef.current = new Map(
      tareas.map((tarea) => [tarea.id, tarea.status]),
    );
    if (!previos || activeKeyRef.current === "tasks") return;
    for (const tarea of tareas) {
      if (previos.get(tarea.id) !== "EN_CURSO") continue;
      const destinos = tarea.targets ?? [];
      if (tarea.status === "COMPLETADA") {
        const bien = destinos.filter(
          (d) => d.status === "INSTALADO" || d.status === "OMITIDO",
        ).length;
        const descripcion = destinos.length
          ? `${bien} de ${destinos.length} equipos quedaron instalados.`
          : undefined;
        toast({
          title: "Tarea de instalación completada",
          description: descripcion,
        });
        emitNotification({
          title: "Tarea de instalación completada",
          description: descripcion,
          icon: ListTodo,
          tone: "success",
        });
      } else if (tarea.status === "CON_ERRORES") {
        const mal = destinos.filter((d) => d.status === "ERROR").length;
        const descripcion = destinos.length
          ? `${mal} de ${destinos.length} equipos fallaron.`
          : undefined;
        toast({
          title: "Tarea de instalación con errores",
          description: descripcion,
          variant: "destructive",
        });
        emitNotification({
          title: "Tarea de instalación con errores",
          description: descripcion,
          icon: ListTodo,
          tone: "danger",
        });
      }
    }
  }, [tareas, toast]);

  // El conteo vive en un estado porque además de la query lo
  // escribe handleUsersSummaryChange; la query lo sincroniza con
  // un ajuste durante el render cuando llega un dato nuevo.
  const [usersCount, setUsersCount] = useState<number | null>(null);
  const [prevUsersData, setPrevUsersData] = useState(usersSummaryQuery.data);
  if (usersSummaryQuery.data !== prevUsersData) {
    setPrevUsersData(usersSummaryQuery.data);
    if (typeof usersSummaryQuery.data === "number") {
      setUsersCount(usersSummaryQuery.data);
    }
  }

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
    usersSummaryQuery.isRefetching ||
    tareasQuery.isRefetching;

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
        queryClient.invalidateQueries({
          queryKey: ["install-tasks", "resumen"],
        }),
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
      // La petición la hace el servicio; aquí solo se
      // traduce su error al aviso de esta acción, como antes.
      const data = await listaBlancaApi.agregar(payload).catch((error) => {
        const message =
          error instanceof Error ? error.message : "Error inesperado";
        toast({
          title: "No se pudo agregar el serial",
          description: message,
          variant: "destructive",
        });
        throw new Error(message);
      });

      const itemCreado = data?.item;
      if (itemCreado) {
        queryClient.setQueryData<WhitelistEntry[] | undefined>(
          ["whitelist"],
          (prev = []) => {
            const filtered = prev.filter((entry) => entry.id !== itemCreado.id);
            return [itemCreado as WhitelistEntry, ...filtered];
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
      // La petición la hace el servicio; aquí solo se
      // traduce su error al aviso de esta acción, como antes.
      const data = await listaBlancaApi.eliminar(id).catch((error) => {
        const message =
          error instanceof Error ? error.message : "Error inesperado";
        toast({
          title: "No se pudo eliminar el serial",
          description: message,
          variant: "destructive",
        });
        throw new Error(message);
      });

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
      // La petición la hace el servicio; aquí solo se
      // traduce su error al aviso de esta acción, como antes.
      const data = await equiposApi.eliminar(id).catch((error) => {
        const message =
          error instanceof Error ? error.message : "Error inesperado";
        toast({
          title: "No se pudo eliminar el equipo",
          description: message,
          variant: "destructive",
        });
        throw new Error(message);
      });

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

  const handleBulkDeleteComputers = useCallback(
    async (ids: string[]) => {
      if (!ids.length) return;
      // La petición la hace el servicio; aquí solo se
      // traduce su error al aviso de esta acción, como antes.
      const data = await equiposApi.eliminarVarios(ids).catch((error) => {
        const message =
          error instanceof Error ? error.message : "Error inesperado";
        toast({
          title: "No se pudieron eliminar los equipos",
          description: message,
          variant: "destructive",
        });
        throw new Error(message);
      });
      const quitados = new Set(ids);
      queryClient.setQueryData<Computer[] | undefined>(
        ["computers"],
        (prev = []) => prev.filter((computer) => !quitados.has(computer.id))
      );
      void queryClient.invalidateQueries({ queryKey: ["computers"] });
      toast({
        title: "Equipos eliminados",
        description: `Se eliminaron ${data.deleted} equipo(s) del inventario.`,
      });
    },
    [queryClient, toast]
  );

  const handleBulkDeleteWhitelist = useCallback(
    async (ids: string[]) => {
      if (!ids.length) return;
      // La petición la hace el servicio; aquí solo se
      // traduce su error al aviso de esta acción, como antes.
      const data = await listaBlancaApi.eliminarVarias(ids).catch((error) => {
        const message =
          error instanceof Error ? error.message : "Error inesperado";
        toast({
          title: "No se pudieron eliminar los seriales",
          description: message,
          variant: "destructive",
        });
        throw new Error(message);
      });
      const quitados = new Set(ids);
      queryClient.setQueryData<WhitelistEntry[] | undefined>(
        ["whitelist"],
        (prev = []) => prev.filter((entry) => !quitados.has(entry.id))
      );
      void queryClient.invalidateQueries({ queryKey: ["whitelist"] });
      toast({
        title: "Seriales removidos",
        description: `Se eliminaron ${data.deleted} dispositivo(s) de la whitelist.`,
      });
    },
    [queryClient, toast]
  );

  const handleClearEvents = useCallback(async () => {
    if (clearingEvents) return;
    setClearingEvents(true);
    try {
      const data = await eventosApi.limpiarHistorial();

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
      tareasActivas,
      bloqueadosAhora,
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
      handleBulkDeleteWhitelist,
      handleBulkDeleteComputers,
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
      handleBulkDeleteComputers,
      handleBulkDeleteWhitelist,
      handleRefreshAll,
      handleUsersSummaryChange,
      lastUpdate,
      loading,
      navigateTo,
      refreshComputers,
      refreshing,
      tareasActivas,
      bloqueadosAhora,
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
