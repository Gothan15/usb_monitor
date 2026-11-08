"use client";
import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { motion } from "framer-motion";
import Image from "next/image";
import {
  Eye,
  EyeOff,
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
    <div className="min-h-screen bg-background lg:grid lg:grid-cols-[1.15fr_1fr]">
      {/* Panel de la casa — azul marino, serif editorial */}
      <div className="relative hidden overflow-hidden bg-[#17181A] text-[#F5F3EF] lg:flex lg:flex-col lg:justify-between lg:p-12">
        <div
          aria-hidden
          className="dot-grid absolute inset-0 text-[#F5F3EF] opacity-30"
        />
        <div className="relative flex items-center gap-3">
          <Image
            src="/brujula-claro.png"
            alt="USB Monitor"
            width={176}
            height={176}
            quality={100}
            className="size-11 shrink-0 rounded-sm"
          />
          <div className="flex flex-col">
            <span className="font-display text-lg font-bold leading-none tracking-tight">
              USB Monitor
            </span>
            <span className="smallcaps mt-1.5 text-[#F5F3EF]/50">
              Centro de control
            </span>
          </div>
          <span className="ml-auto inline-flex items-center gap-2 rounded-full border border-[#F5F3EF]/25 px-3 py-1.5 text-[11px] font-medium text-[#F5F3EF]/85">
            <span className="dot-pulse size-1.5 rounded-full bg-emerald-300" />
            Sistema activo
          </span>
        </div>

        <div className="relative max-w-md">
          <p className="smallcaps text-[#C09A3B]">
            Sistema interno
          </p>
          <h1 className="font-display mt-5 text-[2.75rem] font-bold leading-[1.08] tracking-tight">
            Monitoreo de dispositivos USB
          </h1>
          <p className="mt-8 border-t border-[#F5F3EF]/15 pt-6 text-sm leading-relaxed text-[#F5F3EF]/75">
            Panel central de los agentes instalados en los equipos.
            Acceso solo para el personal autorizado: las conexiones de
            dispositivos y los intentos de acceso quedan registrados.
          </p>
        </div>

        <p className="smallcaps relative text-[#F5F3EF]/40">
          Panel central · Agentes Windows · Tiempo real
        </p>
      </div>

      {/* Formulario — papel enmarcado */}
      <div className="relative flex min-h-screen items-center justify-center bg-[#F5F3EF] p-4 text-[#22252A] dark:bg-[#131211] dark:text-[#EFEDE6] lg:min-h-0">
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.55, ease: [0.22, 1, 0.36, 1] }}
          className="relative w-full max-w-sm rounded-md border border-[#D8D3C8] border-t-2 border-t-[#C09A3B] bg-[#FCFCFA] p-8 shadow-xl dark:border-[#3A372F] dark:border-t-[#C09A3B] dark:bg-[#1E1D1B]"
        >
          <div className="mb-7 flex items-center gap-3 lg:hidden">
            <Image
              src="/brujula-claro.png"
              alt="USB Monitor"
              width={160}
              height={160}
              quality={100}
              className="size-10 shrink-0 rounded-sm dark:hidden"
            />
            <Image
              src="/brujula-oscura.png"
              alt=""
              aria-hidden
              width={160}
              height={160}
              quality={100}
              className="hidden size-10 shrink-0 rounded-sm dark:block"
            />
            <span className="font-display text-lg font-bold tracking-tight">
              USB Monitor
            </span>
          </div>

          <p className="smallcaps text-[#A8822F] dark:text-[#C9A44A]">
            {pcName ? "Desbloquear dispositivo USB" : "Acceso seguro al panel"}
          </p>
          <h2 className="font-display mt-2 text-[1.8rem] font-bold tracking-tight">
            Monitoreo USB
          </h2>
          <div className="mt-4 h-[2px] w-16 bg-[#C09A3B]" />

          <div className="mt-7">
            {error && (
              <Alert variant="destructive" className="mb-4 rounded">
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            )}
            <form onSubmit={handleSubmit} className="space-y-5">
              <div className="space-y-2">
                <label className="smallcaps text-[#8A8F98]">
                  Usuario
                </label>
                <input
                  className="w-full rounded border border-[#D8D3C8] bg-white dark:border-[#3A372F] dark:bg-[#26241F] px-3.5 py-2.5 text-sm transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#C09A3B]/50"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  placeholder="admin"
                  required
                  autoComplete="username"
                />
              </div>
              <div className="space-y-2">
                <label className="smallcaps text-[#8A8F98]">
                  Contraseña
                </label>
                <div className="relative">
                  <input
                    type={showPassword ? "text" : "password"}
                    className="w-full rounded border border-[#D8D3C8] bg-white dark:border-[#3A372F] dark:bg-[#26241F] px-3.5 py-2.5 pr-10 text-sm transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#C09A3B]/50"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    required
                    autoComplete="current-password"
                    placeholder="••••••••"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword((s) => !s)}
                    className="absolute inset-y-0 right-2 flex items-center justify-center rounded-full p-2 text-muted-foreground transition-colors hover:text-[#A8822F] focus:outline-none"
                    aria-label={showPassword ? "Ocultar contraseña" : "Mostrar contraseña"}
                  >
                    {showPassword ? (
                      <EyeOff className="h-4 w-4" />
                    ) : (
                      <Eye className="h-4 w-4" />
                    )}
                  </button>
                </div>
              </div>
              <Button type="submit" className="w-full bg-[#26262B] text-[#F5F3EF] hover:bg-[#17181A]" disabled={loading}>
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
