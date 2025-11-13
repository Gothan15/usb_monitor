"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { FullscreenSpinner } from "@/components/ui/spinner";
import { useToast } from "@/hooks/use-toast";
import { Activity, Key, ShieldCheck, User as UserIcon } from "lucide-react";
import { DeviceList } from "./components/DeviceList/DeviceList";
import { EventHistory } from "./components/EventHistory/EventHistory";
import { ApiKeyDisplay } from "./components/ApiKeyDisplay/ApiKeyDisplay";

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

export default function BasicUserPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { toast } = useToast();
  const [user, setUser] = useState<SessionUser | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchSession = useCallback(async () => {
    try {
      setError(null);
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

      if (data.user.role === "admin") {
        router.push("/");
        return;
      }

      // Rol 'agent' eliminado: solo 'admin' y 'user'.

      setUser(data.user);
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
    fetchSession();
  }, [fetchSession]);

  const activeView = useMemo(() => {
    const view = searchParams?.get("view");
    return view === "devices" || view === "history" || view === "apikey"
      ? view
      : "devices";
  }, [searchParams]);

  if (loading) {
    return <FullscreenSpinner label="Preparando panel" />;
  }

  if (!user) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <Alert className="max-w-md border-red-200 bg-red-50 text-red-900 dark:border-red-700 dark:bg-red-950/20 dark:text-red-100">
          <AlertDescription>
            {error || "No se pudo cargar la información del usuario."}
          </AlertDescription>
        </Alert>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <section>
        <Card className="border-slate-200/80 bg-gradient-to-br from-white via-white to-slate-50 shadow-sm dark:border-slate-800/80 dark:from-slate-950 dark:via-slate-900 dark:to-slate-950">
          <CardHeader className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <CardTitle className="flex items-center gap-3 text-lg text-slate-800 dark:text-slate-100">
              <div className="flex h-11 w-11 items-center justify-center rounded-full bg-slate-900 text-white shadow-md dark:bg-slate-700">
                <UserIcon className="h-5 w-5" />
              </div>
              <div>
                <p className="text-sm text-slate-500 dark:text-slate-300">
                  Bienvenido
                </p>
                <p className="text-xl font-semibold text-slate-900 dark:text-slate-100">
                  {user.username}
                </p>
              </div>
            </CardTitle>
            <div className="flex flex-wrap items-center gap-2">
              <Badge
                variant="outline"
                className="border-green-500/50 text-green-700 dark:border-green-500/70 dark:text-green-300"
              >
                Usuario básico
              </Badge>
            </div>
          </CardHeader>
          <CardContent className="grid gap-4 text-sm text-slate-600 dark:text-slate-300 md:grid-cols-3">
            <div className="flex items-center gap-2 rounded-lg border border-slate-100 bg-slate-50 p-3 dark:border-slate-800 dark:bg-slate-900/60">
              <ShieldCheck className="h-4 w-4 text-slate-500 dark:text-slate-300" />
              <span>Acceso restringido a su equipo asignado.</span>
            </div>
            <div className="flex items-center gap-2 rounded-lg border border-slate-100 bg-slate-50 p-3 dark:border-slate-800 dark:bg-slate-900/60">
              <Activity className="h-4 w-4 text-slate-500 dark:text-slate-300" />
              <span>Las conexiones USB se actualizan automáticamente.</span>
            </div>
            <div className="flex items-center gap-2 rounded-lg border border-slate-100 bg-slate-50 p-3 dark:border-slate-800 dark:bg-slate-900/60">
              <Key className="h-4 w-4 text-slate-500 dark:text-slate-300" />
              <span>
                Proteja su API key y úsela solo en clientes oficiales.
              </span>
            </div>
          </CardContent>
        </Card>
      </section>
      {activeView === "devices" && (
        <section className="space-y-4">
          <DeviceList userId={user.id} />
        </section>
      )}

      {activeView === "history" && (
        <section className="space-y-4">
          <EventHistory userId={user.id} />
        </section>
      )}

      {activeView === "apikey" && (
        <section className="space-y-4">
          <ApiKeyDisplay userId={user.id} />
        </section>
      )}
    </div>
  );
}
