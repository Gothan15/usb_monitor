"use client";
import { useState, useEffect } from "react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { motion } from "framer-motion";
import { Eye, EyeOff, Loader2, Usb, CheckCircle2 } from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import { getCsrfTokenFromDocument } from "@/lib/utils";

export default function LoginPage() {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [usbUnlocked, setUsbUnlocked] = useState(false);
  const router = useRouter();
  const searchParams = useSearchParams();
  const pcName = searchParams.get("pcName");

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

      // Si hay un pcName en la URL, intentar desbloquear el USB
      if (pcName) {
        try {
          const csrfTokenFromHeader = res.headers.get("X-CSRF-Token");
          const csrfToken = csrfTokenFromHeader || getCsrfTokenFromDocument();

          if (!csrfToken) {
            throw new Error(
              "No se detectó token CSRF tras iniciar sesión. Actualiza la página e inténtalo nuevamente."
            );
          }

          const unlockRes = await fetch("/api/usb-unlock", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "x-csrf-token": csrfToken,
            },
            credentials: "include",
            body: JSON.stringify({ pcName }),
          });

          if (unlockRes.ok) {
            const unlockData = await unlockRes.json();

            // Si es usuario normal, mostrar mensaje y no redirigir
            if (data.user?.role === "user") {
              setUsbUnlocked(true);
              setLoading(false);
              return;
            }

            // Si es admin, redirigir al dashboard
            if (data.user?.role === "admin") {
              try {
                const ch = new BroadcastChannel("auth-state");
                ch.postMessage({ type: "login" });
                ch.close();
              } catch {}
              router.push("/");
              return;
            }
          }
        } catch (unlockError) {
          console.error("Error al desbloquear USB:", unlockError);
        }
      }

      // Login normal sin desbloqueo de USB - redirigir según el rol
      try {
        const ch = new BroadcastChannel("auth-state");
        ch.postMessage({ type: "login" });
        ch.close();
      } catch {}

      if (data.user?.role === "user") {
        router.push("/basic-user");
      } else {
        router.push("/");
      }
    } catch (e: any) {
      setError(e.message || "Error de conexión");
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen relative overflow-hidden bg-gradient-to-br from-background via-muted/40 to-background flex items-center justify-center p-4">
      <div className="absolute inset-0 -z-10 opacity-[0.15] [mask-image:radial-gradient(circle_at_center,black,transparent)]">
        <svg className="w-full h-full" preserveAspectRatio="none">
          <defs>
            <linearGradient id="g" x1="0" x2="1" y1="0" y2="1">
              <stop offset="0%" stopColor="hsl(var(--primary))" />
              <stop offset="100%" stopColor="hsl(var(--muted-foreground))" />
            </linearGradient>
          </defs>
          {Array.from({ length: 28 }).map((_, i) => (
            <circle
              key={i}
              cx={Math.random() * 100 + "%"}
              cy={Math.random() * 100 + "%"}
              r={Math.random() * 2 + 0.4}
              fill="url(#g)"
            />
          ))}
        </svg>
      </div>
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5 }}
        className="w-full max-w-sm"
      >
        {usbUnlocked ? (
          <Card className="backdrop-blur supports-[backdrop-filter]:bg-background/70 border-border/60 shadow-lg">
            <CardHeader className="space-y-1">
              <div className="flex items-center gap-2">
                <div className="h-10 w-10 rounded-lg bg-green-500/10 flex items-center justify-center text-green-500">
                  <CheckCircle2 className="h-5 w-5" />
                </div>
                <div>
                  <CardTitle className="text-xl tracking-tight">
                    USB Desbloqueado
                  </CardTitle>
                  <CardDescription className="text-xs">
                    Acceso autorizado
                  </CardDescription>
                </div>
              </div>
            </CardHeader>
            <CardContent>
              <Alert className="border-green-500/50 bg-green-500/10">
                <CheckCircle2 className="h-4 w-4 text-green-500" />
                <AlertDescription className="text-green-700 dark:text-green-300">
                  Tu memoria USB ha sido desbloqueada exitosamente. Ahora puedes
                  leer y escribir archivos en ella.
                </AlertDescription>
              </Alert>
              <div className="mt-4 text-center">
                <p className="text-sm text-muted-foreground">
                  Puedes cerrar esta ventana.
                </p>
              </div>
            </CardContent>
          </Card>
        ) : (
          <Card className="backdrop-blur supports-[backdrop-filter]:bg-background/70 border-border/60 shadow-lg">
            <CardHeader className="space-y-1">
              <div className="flex items-center gap-2">
                <div className="h-10 w-10 rounded-lg bg-primary/10 flex items-center justify-center text-primary">
                  <Usb className="h-5 w-5" />
                </div>
                <div>
                  <CardTitle className="text-xl tracking-tight">
                    Monitoreo USB
                  </CardTitle>
                  <CardDescription className="text-xs">
                    {pcName
                      ? "Desbloquear dispositivo USB"
                      : "Acceso seguro al panel"}
                  </CardDescription>
                </div>
              </div>
            </CardHeader>
            <CardContent>
              {error && (
                <Alert variant="destructive" className="mb-4">
                  <AlertDescription>{error}</AlertDescription>
                </Alert>
              )}
              <form onSubmit={handleSubmit} className="space-y-5">
                <div className="space-y-2">
                  <label className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                    Usuario
                  </label>
                  <input
                    className="w-full rounded-md bg-background border border-border/70 px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30"
                    value={username}
                    onChange={(e) => setUsername(e.target.value)}
                    placeholder="admin"
                    required
                    autoComplete="username"
                  />
                </div>
                <div className="space-y-2">
                  <label className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                    Contraseña
                  </label>
                  <div className="relative">
                    <input
                      type={showPassword ? "text" : "password"}
                      className="w-full rounded-md bg-background border border-border/70 px-3 py-2 text-sm pr-10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30"
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
                      <Loader2 className="h-4 w-4 animate-spin" /> Verificando…
                    </span>
                  ) : pcName ? (
                    "Desbloquear USB"
                  ) : (
                    "Entrar"
                  )}
                </Button>
                {/* <p className="text-[11px] text-center text-muted-foreground leading-relaxed">
                  La creación de cuentas sólo está permitida mediante script CLI
                  autorizado.
                </p> */}
              </form>
            </CardContent>
          </Card>
        )}
      </motion.div>
    </div>
  );
}
