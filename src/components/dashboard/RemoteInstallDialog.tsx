"use client";

import { useCallback, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Spinner } from "@/components/ui/spinner";
import { getCsrfTokenFromDocument } from "@/lib/utils";
import {
  CheckCircle2,
  AlertCircle,
  Upload,
  Settings,
  User,
  Lock,
  Monitor,
  RefreshCw,
  Info,
} from "lucide-react";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";

type Step = "credentials" | "copy" | "install";
type PhaseStatus = "idle" | "running" | "success" | "error";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  targetIp: string;
  targetHostname?: string;
  onInstallComplete?: () => void;
}

interface PhaseResult {
  success: boolean;
  message: string;
  details?: string;
  phase?: string;
}

export function RemoteInstallDialog({
  open,
  onOpenChange,
  targetIp,
  targetHostname,
  onInstallComplete,
}: Props) {
  const [step, setStep] = useState<Step>("credentials");
  const [protocol, setProtocol] = useState<"ssh" | "winrm">("ssh");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [port, setPort] = useState(22);

  // Phase states
  const [copyStatus, setCopyStatus] = useState<PhaseStatus>("idle");
  const [installStatus, setInstallStatus] = useState<PhaseStatus>("idle");
  const [copyMessage, setCopyMessage] = useState("");
  const [installMessage, setInstallMessage] = useState("");
  const [errorDetail, setErrorDetail] = useState("");

  const resetState = useCallback(() => {
    setStep("credentials");
    setUsername("");
    setPassword("");
    setPort(22);
    setCopyStatus("idle");
    setInstallStatus("idle");
    setCopyMessage("");
    setInstallMessage("");
    setErrorDetail("");
  }, []);

  const handleOpenChange = useCallback(
    (isOpen: boolean) => {
      if (!isOpen) {
        // Si hay una operación en curso, permitir cerrar sin resetear
        if (copyStatus !== "running" && installStatus !== "running") {
          resetState();
        }
      }
      onOpenChange(isOpen);
    },
    [onOpenChange, copyStatus, installStatus, resetState],
  );

  const callApi = async (phase: "copy" | "install"): Promise<PhaseResult> => {
    const csrfToken = getCsrfTokenFromDocument();
    if (!csrfToken) {
      return {
        success: false,
        message: "Sesión sin token de seguridad. Inicia sesión nuevamente.",
      };
    }

    const res = await fetch("/api/remote-install", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-csrf-token": csrfToken,
      },
      credentials: "include",
      body: JSON.stringify({
        ip: targetIp,
        username: username.trim(),
        password,
        phase,
        port,
        protocol,
      }),
    });

    const data = await res.json().catch(() => ({
      success: false,
      message: `Error HTTP ${res.status}`,
    }));

    return data as PhaseResult;
  };

  const handleStartCopy = useCallback(async () => {
    setStep("copy");
    setCopyStatus("running");
    setCopyMessage("Entering the system...");
    const timer = setTimeout(() => setCopyMessage("Copying binary..."), 1500);

    try {
      const result = await callApi("copy");
      clearTimeout(timer);

      if (result.success) {
        setCopyStatus("success");
        setCopyMessage("Archivos copiados exitosamente ✓");
      } else {
        setCopyStatus("error");
        setCopyMessage(result.message || "Error al copiar archivos");
        setErrorDetail(result.details || "");
      }
    } catch (err: any) {
      clearTimeout(timer);
      setCopyStatus("error");
      setCopyMessage(err?.message || "Error de conexión");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [targetIp, username, password, port, protocol]);

  const handleStartInstall = useCallback(async () => {
    setStep("install");
    setInstallStatus("running");
    setInstallMessage("Installing service...");

    try {
      const result = await callApi("install");
      if (result.success) {
        setInstallStatus("success");
        setInstallMessage("Servicio USBMonitor instalado y ejecutándose ✓");
        onInstallComplete?.();
      } else {
        setInstallStatus("error");
        setInstallMessage(result.message || "Error al instalar el servicio");
        setErrorDetail(result.details || "");
      }
    } catch (err: any) {
      setInstallStatus("error");
      setInstallMessage(err?.message || "Error de conexión");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [targetIp, username, password, port, protocol, onInstallComplete]);

  const handleRetryCopy = useCallback(() => {
    setCopyStatus("idle");
    setCopyMessage("");
    setErrorDetail("");
    setStep("credentials");
  }, []);

  const handleRetryInstall = useCallback(() => {
    setInstallStatus("idle");
    setInstallMessage("");
    setErrorDetail("");
  }, []);

  const isCredentialsValid = username.trim().length > 0;

  const displayTarget = targetHostname
    ? `${targetHostname} (${targetIp})`
    : targetIp;

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-foreground">
            <Monitor className="size-5" />
            Instalar Servicio USBMonitor
          </DialogTitle>
          <DialogDescription>
            Instalación remota en{" "}
            <span className="font-semibold text-foreground">
              {displayTarget}
            </span>
          </DialogDescription>
        </DialogHeader>

        {/* ── Step indicator ── */}
        <div className="flex items-center gap-2 py-2">
          {(["credentials", "copy", "install"] as Step[]).map((s, i) => {
            const isActive = step === s;
            const isPast =
              (s === "credentials" && step !== "credentials") ||
              (s === "copy" && step === "install");
            const icons = [User, Upload, Settings];
            const Icon = icons[i];
            return (
              <div key={s} className="flex items-center gap-2">
                {i > 0 && (
                  <div
                    className={`h-px w-6 transition-colors ${
                      isPast ? "bg-emerald-500" : "bg-border/50"
                    }`}
                  />
                )}
                <div
                  className={`flex size-8 items-center justify-center rounded-full border text-xs font-semibold transition-colors ${
                    isActive
                      ? "border-primary bg-primary/10 text-primary"
                      : isPast
                        ? "border-emerald-500 bg-emerald-500/10 text-emerald-500"
                        : "border-border/50 bg-muted/30 text-muted-foreground"
                  }`}
                >
                  <Icon className="size-3.5" />
                </div>
              </div>
            );
          })}
        </div>

        {/* ── Step 1: Credentials ── */}
        {step === "credentials" && (
          <div className="flex flex-col gap-4">
            <div className="space-y-2">
              <Label
                htmlFor="ssh-host"
                className="text-xs text-muted-foreground"
              >
                Equipo destino
              </Label>
              <Input
                id="ssh-host"
                value={displayTarget}
                disabled
                className="bg-muted/30 text-muted-foreground"
              />
            </div>

            {/* Selector de Protocolo */}
            <div className="space-y-2">
              <div className="flex items-center gap-2 mb-1">
                <Label className="text-xs text-muted-foreground">
                  Protocolo
                </Label>
              </div>
              <div className="flex bg-muted/50 p-1 rounded-md border gap-1">
                <button
                  type="button"
                  onClick={() => setProtocol("ssh")}
                  className={`flex-1 text-xs py-1.5 rounded transition-colors ${protocol === "ssh" ? "bg-background text-foreground shadow-sm font-medium" : "text-muted-foreground hover:text-foreground"}`}
                >
                  SSH
                </button>
                <div className={`flex-1 flex items-center justify-center rounded transition-colors ${protocol === "winrm" ? "bg-background text-foreground shadow-sm font-medium" : "text-muted-foreground hover:text-foreground"}`}>
                  <button
                    type="button"
                    onClick={() => setProtocol("winrm")}
                    className="flex-1 text-xs py-1.5 h-full"
                  >
                    WinRM
                  </button>
                  <TooltipProvider delayDuration={200}>
                    <Tooltip>
                      <TooltipTrigger type="button" tabIndex={-1} className="pr-2">
                        <Info className="size-3.5 text-muted-foreground cursor-help" />
                      </TooltipTrigger>
                      <TooltipContent className="max-w-[320px] text-xs space-y-2">
                        <p>
                          For non-domain environments: Run &apos;Enable-PSRemoting -Force&apos; on the target as Administrator.
                        </p>
                        <p>
                          For corporate environments: Enable via GPO at Computer Configuration &gt; Policies &gt; Administrative Templates &gt; Windows Components &gt; Windows Remote Management (WinRM) &gt; WinRM Service &gt; Allow remote server management through WinRM.
                        </p>
                      </TooltipContent>
                    </Tooltip>
                  </TooltipProvider>
                </div>
              </div>
            </div>

            <div className="space-y-2">
              <Label
                htmlFor="ssh-user"
                className="text-xs text-muted-foreground"
              >
                <User className="mr-1 inline size-3" />
                Usuario {protocol.toUpperCase()}
              </Label>
              <Input
                id="ssh-user"
                placeholder="Ej: Administrador"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                autoComplete="off"
                autoFocus
              />
            </div>
            <div className="space-y-2">
              <Label
                htmlFor="ssh-pass"
                className="text-xs text-muted-foreground"
              >
                <Lock className="mr-1 inline size-3" />
                Contraseña{" "}
                <span className="font-normal opacity-60">(opcional)</span>
              </Label>
              <Input
                id="ssh-pass"
                type="password"
                placeholder="Dejar vacío si el usuario no tiene contraseña"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="off"
                onKeyDown={(e) => {
                  if (e.key === "Enter" && isCredentialsValid) {
                    handleStartCopy();
                  }
                }}
              />
            </div>
            <div className="space-y-2">
              <Label
                htmlFor="ssh-port"
                className="text-xs text-muted-foreground"
              >
                Puerto SSH
              </Label>
              <Input
                id="ssh-port"
                type="number"
                min={1}
                max={65535}
                value={port}
                onChange={(e) =>
                  setPort(
                    Math.max(1, Math.min(65535, Number(e.target.value) || 22)),
                  )
                }
                className="w-24"
              />
            </div>
          </div>
        )}

        {/* ── Step 2: Copy ── */}
        {step === "copy" && (
          <div className="flex flex-col gap-4">
            {copyStatus === "running" && (
              <>
                <div className="flex items-center gap-3 text-sm text-muted-foreground">
                  <Spinner size={16} />
                  <span>{copyMessage}</span>
                </div>
                <Progress className="h-2" />
              </>
            )}
            {copyStatus === "success" && (
              <Alert className="border-emerald-200/60 bg-emerald-50 text-emerald-700 dark:border-emerald-300/40 dark:bg-emerald-500/10 dark:text-emerald-100">
                <CheckCircle2 className="size-4" />
                <AlertDescription>{copyMessage}</AlertDescription>
              </Alert>
            )}
            {copyStatus === "error" && (
              <>
                <Alert className="border-rose-200/60 bg-rose-50 text-rose-700 dark:border-rose-300/40 dark:bg-rose-500/10 dark:text-rose-100">
                  <AlertCircle className="size-4" />
                  <AlertDescription>
                    {copyMessage}
                    {errorDetail && (
                      <span className="mt-1 block text-xs opacity-70">
                        {errorDetail}
                      </span>
                    )}
                  </AlertDescription>
                </Alert>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleRetryCopy}
                  className="self-start"
                >
                  <RefreshCw className="mr-2 size-3.5" />
                  Reintentar
                </Button>
              </>
            )}
          </div>
        )}

        {/* ── Step 3: Install ── */}
        {step === "install" && (
          <div className="flex flex-col gap-4">
            {/* Show copy success banner */}
            <Alert className="border-emerald-200/60 bg-emerald-50 text-emerald-700 dark:border-emerald-300/40 dark:bg-emerald-500/10 dark:text-emerald-100">
              <CheckCircle2 className="size-4" />
              <AlertDescription>
                Archivos copiados exitosamente ✓
              </AlertDescription>
            </Alert>

            {installStatus === "idle" && (
              <p className="text-sm text-muted-foreground">
                Los archivos fueron copiados. Haz clic en &quot;Instalar
                Servicio&quot; para completar la instalación.
              </p>
            )}
            {installStatus === "running" && (
              <>
                <div className="flex items-center gap-3 text-sm text-muted-foreground">
                  <Spinner size={16} />
                  <span>{installMessage}</span>
                </div>
                <Progress className="h-2" />
              </>
            )}
            {installStatus === "success" && (
              <Alert className="border-emerald-200/60 bg-emerald-50 text-emerald-700 dark:border-emerald-300/40 dark:bg-emerald-500/10 dark:text-emerald-100">
                <CheckCircle2 className="size-4" />
                <AlertDescription>{installMessage}</AlertDescription>
              </Alert>
            )}
            {installStatus === "error" && (
              <>
                <Alert className="border-rose-200/60 bg-rose-50 text-rose-700 dark:border-rose-300/40 dark:bg-rose-500/10 dark:text-rose-100">
                  <AlertCircle className="size-4" />
                  <AlertDescription>
                    {installMessage}
                    {errorDetail && (
                      <span className="mt-1 block text-xs opacity-70">
                        {errorDetail}
                      </span>
                    )}
                  </AlertDescription>
                </Alert>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleRetryInstall}
                  className="self-start"
                >
                  <RefreshCw className="mr-2 size-3.5" />
                  Reintentar
                </Button>
              </>
            )}
          </div>
        )}

        {/* ── Footer ── */}
        <DialogFooter>
          {step === "credentials" && (
            <Button
              onClick={handleStartCopy}
              disabled={!isCredentialsValid}
              className="w-full sm:w-auto"
            >
              <Upload className="mr-2 size-4" />
              Siguiente
            </Button>
          )}

          {step === "copy" && copyStatus === "success" && (
            <Button
              onClick={() => {
                setStep("install");
                setInstallStatus("idle");
              }}
              className="w-full sm:w-auto"
            >
              <Settings className="mr-2 size-4" />
              Instalar Servicio
            </Button>
          )}

          {step === "install" && installStatus === "idle" && (
            <Button onClick={handleStartInstall} className="w-full sm:w-auto">
              <Settings className="mr-2 size-4" />
              Instalar Servicio
            </Button>
          )}

          {step === "install" && installStatus === "success" && (
            <Button
              variant="outline"
              onClick={() => handleOpenChange(false)}
              className="w-full sm:w-auto"
            >
              Cerrar
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
