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
import { useRouter } from "next/navigation";
import { useToast } from "@/hooks/use-toast";

interface SessionUser {
  id: string;
  username: string;
  role: string | null;
}

interface SessionResponse {
  ok: boolean;
  user?: SessionUser;
  error?: { code?: string; message?: string } | string;
}

export type UserViewKey = "devices" | "history" | "apikey";

// Mapa centralizado para traducir la vista activa en la ruta de Next.js.
export const userViewToHref: Record<UserViewKey, string> = {
  devices: "/user",
  history: "/user/history",
  apikey: "/user/apikey",
};

interface UserDashboardContextValue {
  user: SessionUser | null;
  loading: boolean;
  error: string | null;
  activeView: UserViewKey;
  navigateTo: (view: UserViewKey) => void;
  refreshSession: () => Promise<void>;
}

const UserDashboardContext = createContext<UserDashboardContextValue | null>(
  null
);

export function UserDashboardProvider({
  activeView,
  children,
}: {
  activeView: UserViewKey;
  children: ReactNode;
}) {
  const router = useRouter();
  const { toast } = useToast();
  const [user, setUser] = useState<SessionUser | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchSession = useCallback(async () => {
    try {
      setError(null);
      setLoading(true);
      const response = await fetch("/api/auth/session", {
        credentials: "include",
      });
      const data = (await response.json()) as SessionResponse;

      if (!response.ok || !data?.ok || !data.user) {
        const message =
          typeof data?.error === "string"
            ? data.error
            : data?.error?.message || "Sesión no válida.";
        throw new Error(message);
      }

      const role = data.user.role?.toLowerCase?.() ?? null;
      if (role === "admin") {
        router.push("/admin");
        return;
      }

      setUser({ ...data.user, role });
    } catch (sessionError) {
      const message =
        sessionError instanceof Error
          ? sessionError.message
          : "No se pudo validar la sesión.";
      setError(message);
      toast({
        title: "Error de sesión",
        description: message,
        variant: "destructive",
      });
      setTimeout(() => router.push("/login"), 2000);
    } finally {
      setLoading(false);
    }
  }, [router, toast]);

  useEffect(() => {
    void fetchSession();
  }, [fetchSession]);

  const navigateTo = useCallback(
    (view: UserViewKey) => {
      router.push(userViewToHref[view]);
    },
    [router]
  );

  const value = useMemo<UserDashboardContextValue>(
    () => ({
      user,
      loading,
      error,
      activeView,
      navigateTo,
      refreshSession: fetchSession,
    }),
    [activeView, error, fetchSession, loading, navigateTo, user]
  );

  return (
    <UserDashboardContext.Provider value={value}>
      {children}
    </UserDashboardContext.Provider>
  );
}

export function useUserDashboard() {
  const context = useContext(UserDashboardContext);
  if (!context) {
    throw new Error(
      "useUserDashboard debe usarse dentro de UserDashboardProvider"
    );
  }
  return context;
}
