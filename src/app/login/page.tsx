"use client";
import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { motion } from "framer-motion";
import {
  Eye,
  EyeOff,
  Usb,
  ScanSearch,
  ListChecks,
  LockKeyhole,
} from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import { Spinner } from "@/components/ui/spinner";

export default function LoginPage() {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  // Flujo legacy de desbloqueo eliminado; se utiliza únicamente whitelist.
  const router = useRouter();
  const searchParams = useSearchParams();
  const pcName = useMemo(
    () => searchParams?.get("pcName") ?? null,
    [searchParams]
  );

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      // Intentar obtener el hostname desde diferentes fuentes
      let clientHostname = "";

      // 1. Desde el parámetro pcName de la URL (si viene del servicio USB)
      if (pcName) {
        clientHostname = pcName;
      }
      // 2. Intentar obtener del localStorage (si se guardó previamente)
      else if (typeof window !== "undefined") {
        clientHostname = localStorage.getItem("clientHostname") || "";
      }

      const headers: HeadersInit = {
        "Content-Type": "application/json",
      };

      // Agregar hostname a los headers si está disponible
      if (clientHostname) {
        headers["x-client-hostname"] = clientHostname;
      }

      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers,
        body: JSON.stringify({ username, password }),
        credentials: "include",
      });
      const data = await res.json();
      if (!data.ok) {
        // Mostrar mensaje específico si intenta ingresar desde computadora incorrecta
        if (data.error?.code === "WRONG_COMPUTER") {
          setError(
            `No puedes iniciar sesión desde esta computadora. Solo puedes acceder desde: ${
              data.error?.details?.assignedComputer || "tu computadora asignada"
            }`
          );
        } else {
          setError(data.error?.message || "Error desconocido");
        }
        setLoading(false);
        return;
      }

      // Rol 'agent' eliminado: solo 'admin' y 'user'.

      // Nota: se elimina el intento de desbloqueo via /api/usb-unlock (método legacy)

      // Login normal sin desbloqueo de USB - redirigir según el rol
      try {
        const ch = new BroadcastChannel("auth-state");
        ch.postMessage({ type: "login" });
        ch.close();
      } catch {}

      const role = data.user?.role?.toLowerCase?.() ?? null;

      if (role === "user") {
        router.push("/user");
      } else {
        router.push("/admin");
      }
    } catch (e: any) {
      setError(e.message || "Error de conexión");
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-background lg:grid lg:grid-cols-[1.1fr_1fr]">
      {/* Panel de marca — matriz de puntos, lenguaje técnico (INSPIRACION.md) */}
      <div className="relative hidden overflow-hidden bg-sidebar text-sidebar-foreground lg:flex lg:flex-col lg:justify-between lg:p-12">
        <div
          aria-hidden
          className="dot-grid-dense absolute inset-0 text-sidebar-primary opacity-60 [mask-image:radial-gradient(ellipse_at_top_left,black,transparent_65%)]"
        />
        <div className="relative flex items-center gap-3">
          <div className="flex size-11 items-center justify-center rounded-lg bg-sidebar-primary text-sidebar-primary-foreground">
            <Usb className="size-6" />
          </div>
          <div className="flex flex-col">
            <span className="text-sm font-bold uppercase tracking-[0.22em]">
              USB Monitor
            </span>
            <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-sidebar-foreground/60">
              Centro de control
            </span>
          </div>
          <span className="ml-auto inline-flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.18em] text-sidebar-foreground/70">
            <span className="size-1.5 rounded-full bg-sidebar-primary dot-pulse" />
            Sistema activo
          </span>
        </div>

        <div className="relative max-w-md">
          <p className="font-mono text-[11px] uppercase tracking-[0.24em] text-sidebar-primary">
            Vigilancia de dispositivos
          </p>
          <h1 className="mt-4 text-4xl font-bold leading-[1.08] tracking-tight text-sidebar-accent-foreground">
            Cada USB que se conecta, queda registrado.
          </h1>
          <ul className="mt-8 space-y-4 text-sm text-sidebar-foreground/85">
            <li className="flex items-start gap-3">
              <ScanSearch className="mt-0.5 size-4 shrink-0 text-sidebar-primary" />
              Detección y registro de eventos en tiempo real
            </li>
            <li className="flex items-start gap-3">
              <ListChecks className="mt-0.5 size-4 shrink-0 text-sidebar-primary" />
              Lista blanca de dispositivos autorizados por número de serie
            </li>
            <li className="flex items-start gap-3">
              <LockKeyhole className="mt-0.5 size-4 shrink-0 text-sidebar-primary" />
              Bloqueo de sesión y unidades en solo lectura ante intrusos
            </li>
          </ul>
        </div>

        <p className="relative font-mono text-[10px] uppercase tracking-[0.18em] text-sidebar-foreground/45">
          Panel central · Agentes Windows · SSE en vivo
        </p>
      </div>

      {/* Formulario */}
      <div className="relative flex min-h-screen items-center justify-center p-4 lg:min-h-0">
        <div
          aria-hidden
          className="dot-grid absolute inset-x-0 top-0 h-56 text-foreground opacity-40 [mask-image:linear-gradient(to_bottom,black,transparent)] lg:hidden"
        />
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5 }}
          className="relative w-full max-w-sm"
        >
          <div className="mb-8 flex items-center gap-3 lg:hidden">
            <div className="flex size-10 items-center justify-center rounded-lg bg-primary text-primary-foreground">
              <Usb className="size-5" />
            </div>
            <span className="text-sm font-bold uppercase tracking-[0.22em]">
              USB Monitor
            </span>
          </div>

          <p className="font-mono text-[11px] uppercase tracking-[0.24em] text-primary">
            {pcName ? "Desbloquear dispositivo USB" : "Acceso seguro al panel"}
          </p>
          <h2 className="mt-2 text-2xl font-bold tracking-tight">
            Monitoreo USB
          </h2>

          <div className="mt-8">
            {error && (
              <Alert variant="destructive" className="mb-4">
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            )}
            <form onSubmit={handleSubmit} className="space-y-5">
              <div className="space-y-2">
                <label className="font-mono text-[11px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
                  Usuario
                </label>
                <input
                  className="w-full rounded-md bg-card border border-input px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  placeholder="admin"
                  required
                  autoComplete="username"
                />
              </div>
              <div className="space-y-2">
                <label className="font-mono text-[11px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
                  Contraseña
                </label>
                <div className="relative">
                  <input
                    type={showPassword ? "text" : "password"}
                    className="w-full rounded-md bg-card border border-input px-3 py-2 text-sm pr-10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    required
                    autoComplete="current-password"
                    placeholder="••••••••"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword((s) => !s)}
                    className="absolute inset-y-0 right-2 flex items-center justify-center rounded-full p-2 text-muted-foreground transition-colors hover:text-primary focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/20"
                  >
                    {showPassword ? (
                      <EyeOff className="h-4 w-4" />
                    ) : (
                      <Eye className="h-4 w-4" />
                    )}
                    <span className="sr-only">
                      {showPassword
                        ? "Ocultar contraseña"
                        : "Mostrar contraseña"}
                    </span>
                  </button>
                </div>
              </div>
              <Button
                type="submit"
                className="w-full font-medium"
                disabled={loading}
              >
                {loading ? (
                  <span className="inline-flex items-center gap-2">
                    <Spinner size={16} /> Verificando…
                  </span>
                ) : pcName ? (
                  "Desbloquear USB"
                ) : (
                  "Entrar"
                )}
              </Button>
            </form>
          </div>
        </motion.div>
      </div>
    </div>
  );
}
