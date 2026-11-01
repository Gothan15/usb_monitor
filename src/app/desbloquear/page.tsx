"use client";
import { Suspense, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { motion } from "framer-motion";
import { Eye, EyeOff, Usb, CheckCircle2, HardDrive } from "lucide-react";
import { useSearchParams } from "next/navigation";
import { Spinner } from "@/components/ui/spinner";

/**
 * Página de respaldo para desbloquear un USB con la contraseña del dueño
 * de la PC (o del admin). La vía principal es el proceso compañero
 * (USBMonitorPrompt); esta página se abre desde la señal del navegador
 * que deja el agente cuando no hay compañero disponible.
 */
function DesbloquearForm() {
  const searchParams = useSearchParams();
  const pcName = useMemo(() => searchParams?.get("pc") ?? "", [searchParams]);
  const driveLetter = useMemo(
    () => searchParams?.get("drive") ?? "",
    [searchParams]
  );
  const serialNumber = useMemo(
    () => searchParams?.get("serial") ?? "",
    [searchParams]
  );

  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const res = await fetch("/api/usb-auth", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          username,
          password,
          pcName,
          driveLetter: driveLetter || undefined,
          serialNumber: serialNumber || undefined,
        }),
      });
      const data = await res.json();
      if (!data.authorized) {
        setError(data.message || "No autorizado.");
        setLoading(false);
        return;
      }
      setDone(true);
    } catch {
      setError("Error de conexión con el servidor.");
      setLoading(false);
    }
  };

  return (
    <div className="aurora-scene relative flex min-h-screen items-center justify-center bg-background p-4">
      <div
        aria-hidden
        className="dot-grid absolute inset-x-0 top-0 h-56 text-foreground opacity-40"
      />
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5 }}
        className="animate-view-in relative w-full max-w-sm"
      >
        <div className="mb-8 flex items-center gap-3">
          <div className="bg-aurora flex size-11 items-center justify-center rounded-sm text-[#E9EDF3] shadow-sm">
            <Usb className="size-5" />
          </div>
          <span className="font-display text-base font-bold tracking-tight">
            USB Monitor
          </span>
        </div>

        {done ? (
          <div className="frame-double bg-card p-8 text-center">
            <CheckCircle2 className="mx-auto size-10 text-success" />
            <h1 className="font-display mt-3 text-xl font-bold tracking-tight">
              Dispositivo desbloqueado
            </h1>
            <p className="mt-2 text-sm text-muted-foreground">
              Ya puedes usar el dispositivo en esta PC. El permiso termina
              cuando lo extraigas.
            </p>
          </div>
        ) : (
          <>
            <p className="smallcaps text-[var(--acero)]">
              Dispositivo bloqueado
            </p>
            <h1 className="font-display mt-2 text-[1.7rem] font-bold tracking-tight">
              Introduce tu contraseña
            </h1>
            <p className="mt-2 flex items-center gap-2 text-sm text-muted-foreground">
              <HardDrive className="size-4 shrink-0" />
              {pcName ? `PC: ${pcName}` : "Esta PC"}
              {driveLetter ? ` · Unidad ${driveLetter}` : ""}
            </p>
            <p className="mt-1 text-sm text-muted-foreground">
              Solo la contraseña del dueño de esta PC, o la del
              administrador, puede desbloquear el dispositivo.
            </p>

            <div className="mt-8">
              {error && (
                <Alert variant="destructive" className="mb-4">
                  <AlertDescription>{error}</AlertDescription>
                </Alert>
              )}
              <form onSubmit={handleSubmit} className="space-y-5">
                <div className="space-y-2">
                  <label className="smallcaps text-muted-foreground">
                    Usuario
                  </label>
                  <input
                    className="w-full rounded border border-input bg-background px-3.5 py-2.5 text-sm transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--acero)]/50"
                    value={username}
                    onChange={(e) => setUsername(e.target.value)}
                    required
                    autoComplete="username"
                  />
                </div>
                <div className="space-y-2">
                  <label className="smallcaps text-muted-foreground">
                    Contraseña
                  </label>
                  <div className="relative">
                    <input
                      type={showPassword ? "text" : "password"}
                      className="w-full rounded border border-input bg-background px-3.5 py-2.5 pr-10 text-sm transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--acero)]/50"
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
                  className="w-full"
                  disabled={loading || !pcName}
                >
                  {loading ? (
                    <span className="inline-flex items-center gap-2">
                      <Spinner size={16} /> Verificando…
                    </span>
                  ) : (
                    "Desbloquear dispositivo"
                  )}
                </Button>
                {!pcName && (
                  <p className="text-center text-xs text-muted-foreground">
                    Esta página debe abrirse desde el aviso del agente en la
                    PC del dispositivo bloqueado.
                  </p>
                )}
              </form>
            </div>
          </>
        )}
      </motion.div>
    </div>
  );
}

export default function DesbloquearPage() {
  return (
    <Suspense>
      <DesbloquearForm />
    </Suspense>
  );
}
