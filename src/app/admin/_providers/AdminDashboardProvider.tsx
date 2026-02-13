"use client";

import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { useRouter } from "next/navigation";

export type ViewKey =
  | "overview"
  | "events"
  | "computers"
  | "users"
  | "whitelist"
  | "network"
  | "settings";

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
  user: {
    name?: string | null;
    role?: string | null;
  } | null;
  loading: boolean;
  checkingRole: boolean;
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
  const [checkingRole, setCheckingRole] = useState(true);
  const [user, setUser] = useState<{
    name?: string | null;
    role?: string | null;
  } | null>(null);

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

  const navigateTo = (key: ViewKey) => {
    const href = viewKeyToHref[key];
    if (!href) return;
    router.push(href);
  };

  const value = useMemo<AdminDashboardContextValue>(
    () => ({
      activeKey,
      user,
      loading: checkingRole,
      checkingRole,
      navigateTo,
    }),
    [activeKey, checkingRole, user]
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
