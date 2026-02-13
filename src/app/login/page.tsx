"use client";
import { useMemo, useState } from "react";
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
import { Eye, EyeOff, Usb, CheckCircle2 } from "lucide-react";
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
    <div className="min-h-screen relative overflow-hidden bg-gradient-to-br from-background via-muted/30 to-background flex items-center justify-center p-4">
      {/* Animated background pattern */}
      <div className="absolute inset-0 -z-10 opacity-[0.08] [mask-image:radial-gradient(circle_at_center,black,transparent)]">
        <svg className="w-full h-full" preserveAspectRatio="none">
          <defs>
            <linearGradient id="g" x1="0" x2="1" y1="0" y2="1">
              <stop offset="0%" stopColor="hsl(var(--primary))" />
              <stop offset="50%" stopColor="hsl(var(--accent))" />
              <stop offset="100%" stopColor="hsl(var(--muted-foreground))" />
            </linearGradient>
          </defs>
          {Array.from({ length: 32 }).map((_, i) => (
            <circle
              key={i}
              cx={Math.random() * 100 + "%"}
              cy={Math.random() * 100 + "%"}
              r={Math.random() * 2.5 + 0.5}
              fill="url(#g)"
              opacity={Math.random() * 0.5 + 0.3}
            />
          ))}
        </svg>
      </div>
      
      {/* Subtle gradient orbs for depth */}
      <div className="absolute top-1/4 -left-48 w-96 h-96 bg-primary/5 rounded-full blur-3xl animate-pulse" 
        style={{ animationDuration: "4s" }} 
      />
      <div className="absolute bottom-1/4 -right-48 w-96 h-96 bg-accent/5 rounded-full blur-3xl animate-pulse" 
        style={{ animationDuration: "6s" }} 
      />
      
      <motion.div
        initial={{ opacity: 0, y: 20, scale: 0.95 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ 
          duration: 0.6,
          ease: [0.4, 0, 0.2, 1]
        }}
        className="w-full max-w-sm relative z-10"
      >
        {false ? (
          <Card className="backdrop-blur-xl supports-[backdrop-filter]:bg-background/80 border-border/50 shadow-2xl">
            <CardHeader className="space-y-1">
              <motion.div 
                className="flex items-center gap-2"
                initial={{ opacity: 0, x: -20 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: 0.2 }}
              >
                <div className="h-10 w-10 rounded-lg bg-green-500/10 flex items-center justify-center text-green-500 shadow-sm">
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
              </motion.div>
            </CardHeader>
            <CardContent>
              <motion.div
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.3 }}
              >
                <Alert className="border-green-500/50 bg-green-500/10">
                  <CheckCircle2 className="h-4 w-4 text-green-500" />
                  <AlertDescription className="text-green-700 dark:text-green-300">
                    Tu memoria USB ha sido desbloqueada exitosamente. Ahora puedes
                    leer y escribir archivos en ella.
                  </AlertDescription>
                </Alert>
              </motion.div>
              <motion.div 
                className="mt-4 text-center"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ delay: 0.4 }}
              >
                <p className="text-sm text-muted-foreground">
                  Puedes cerrar esta ventana.
                </p>
              </motion.div>
            </CardContent>
          </Card>
        ) : (
          <Card className="backdrop-blur-xl supports-[backdrop-filter]:bg-background/80 border-border/50 shadow-2xl overflow-hidden">
            <CardHeader className="space-y-1">
              <motion.div 
                className="flex items-center gap-2"
                initial={{ opacity: 0, x: -20 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: 0.2 }}
              >
                <div className="h-10 w-10 rounded-lg bg-gradient-to-br from-primary/20 to-accent/20 flex items-center justify-center text-primary shadow-sm">
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
              </motion.div>
            </CardHeader>
            <CardContent>
              {error && (
                <motion.div
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: "auto" }}
                  className="mb-4"
                >
                  <Alert variant="destructive">
                    <AlertDescription>{error}</AlertDescription>
                  </Alert>
                </motion.div>
              )}
              <form onSubmit={handleSubmit} className="space-y-5">
                <motion.div 
                  className="space-y-2"
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.3 }}
                >
                  <label className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                    Usuario
                  </label>
                  <input
                    className="w-full rounded-md bg-background/50 border border-border/70 px-3 py-2 text-sm 
                      transition-all duration-200
                      focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 
                      focus-visible:border-primary/50 focus-visible:bg-background
                      hover:border-border"
                    value={username}
                    onChange={(e) => setUsername(e.target.value)}
                    placeholder="admin"
                    required
                    autoComplete="username"
                  />
                </motion.div>
                <motion.div 
                  className="space-y-2"
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.4 }}
                >
                  <label className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                    Contraseña
                  </label>
                  <div className="relative">
                    <input
                      type={showPassword ? "text" : "password"}
                      className="w-full rounded-md bg-background/50 border border-border/70 px-3 py-2 text-sm pr-10 
                        transition-all duration-200
                        focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 
                        focus-visible:border-primary/50 focus-visible:bg-background
                        hover:border-border"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      required
                      autoComplete="current-password"
                      placeholder="••••••••"
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword((s) => !s)}
                      className="absolute inset-y-0 right-2 flex items-center justify-center rounded-full p-2 
                        text-muted-foreground transition-all duration-200 
                        hover:text-primary hover:bg-primary/10
                        focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/20"
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
                </motion.div>
                <motion.div
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.5 }}
                >
                  <Button
                    type="submit"
                    className="w-full font-medium shadow-lg hover:shadow-xl transition-shadow"
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
                </motion.div>
              </form>
            </CardContent>
          </Card>
        )}
      </motion.div>
    </div>
  );
}
