"use client";

import { useCallback, useEffect, useState } from "react";
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

interface RequisitoWinRM {
  id: string;
  etiqueta: string;
  ok: boolean;
  detalle: string;
  consejo?: string;
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

  // Puerto por defecto según el protocolo elegido: al cambiar el
  // protocolo se restablece el suyo (ajuste durante el render).
  const [prevProtocol, setPrevProtocol] = useState(protocol);
  if (protocol !== prevProtocol) {
    setPrevProtocol(protocol);
    setPort(protocol === "winrm" ? 5985 : 22);
  }

  // Phase states
  const [copyStatus, setCopyStatus] = useState<PhaseStatus>("idle");
  const [installStatus, setInstallStatus] = useState<PhaseStatus>("idle");
  const [copyMessage, setCopyMessage] = useState("");
  const [installMessage, setInstallMessage] = useState("");
  const [errorDetail, setErrorDetail] = useState("");

  // Comprobación previa de requisitos WinRM
  const [checkRunning, setCheckRunning] = useState(false);
  const [checks, setChecks] = useState<RequisitoWinRM[] | null>(null);
  const [checkMessage, setCheckMessage] = useState("");

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
    setCheckRunning(false);
    setChecks(null);
    setCheckMessage("");
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
        stream: true,
      }),
    });

    // Si el servidor no respondió con SSE (error previo al stream:
    // auth, validación, rate limit…), el cuerpo es un JSON normal.
    const contentType = res.headers.get("content-type") || "";
    if (!contentType.includes("text/event-stream") || !res.body) {
      const data = await res.json().catch(() => ({
        success: false,
        message: `Error HTTP ${res.status}`,
      }));
      return data as PhaseResult;
    }

    // Leer el stream SSE: eventos `progress` en vivo y un `result` final.
    const setMessage = phase === "copy" ? setCopyMessage : setInstallMessage;
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffered = "";
    let finalResult: PhaseResult | null = null;

    const handleEventBlock = (block: string) => {
      let event = "message";
      const dataLines: string[] = [];
      for (const line of block.split("\n")) {
        if (line.startsWith("event:")) event = line.slice(6).trim();
        else if (line.startsWith("data:")) dataLines.push(line.slice(5).trim());
      }
      if (dataLines.length === 0) return;
      let data: any;
      try {
        data = JSON.parse(dataLines.join("\n"));
      } catch {
        return;
      }
      if (event === "progress") {
        if (data.detail) setMessage(data.detail);
        else if (data.stage) setMessage(data.stage);
      } else if (event === "result") {
        finalResult = data as PhaseResult;
      }
    };

    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffered += decoder.decode(value, { stream: true });
      let separatorIndex = buffered.indexOf("\n\n");
      while (separatorIndex >= 0) {
        handleEventBlock(buffered.slice(0, separatorIndex));
        buffered = buffered.slice(separatorIndex + 2);
        separatorIndex = buffered.indexOf("\n\n");
      }
    }
    if (buffered.trim()) handleEventBlock(buffered);

    return (
      finalResult ?? {
        success: false,
        message: "La conexión de progreso se cerró sin resultado",
      }
    );
  };

  const handleCheckRequirements = useCallback(async () => {
    setCheckRunning(true);
    setChecks(null);
    setCheckMessage("");
    try {
      const csrfToken = getCsrfTokenFromDocument();
      if (!csrfToken) {
        setCheckMessage(
          "Sesión sin token de seguridad. Inicia sesión nuevamente.",
        );
        return;
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
          phase: "check",
          port,
          protocol: "winrm",
          stream: false,
        }),
      });
      const data = await res.json().catch(() => null);
      if (data && Array.isArray(data.checks)) {
        setChecks(data.checks as RequisitoWinRM[]);
        setCheckMessage(data.message || "");
      } else {
        setCheckMessage(
          data?.error || data?.message || `Error HTTP ${res.status}`,
        );
      }
    } catch (err: any) {
      setCheckMessage(err?.message || "Error de conexión");
    } finally {
      setCheckRunning(false);
    }
  }, [targetIp, username, password, port]);

  const handleStartCopy = useCallback(async () => {
    setStep("copy");
    setCopyStatus("running");
    setCopyMessage("Conectando...");

    try {
      const result = await callApi("copy");

      if (result.success) {
        setCopyStatus("success");
        setCopyMessage("Archivos copiados exitosamente ✓");
      } else {
        setCopyStatus("error");
        setCopyMessage(result.message || "Error al copiar archivos");
        setErrorDetail(result.details || "");
      }
    } catch (err: any) {
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
                      <TooltipContent className="max-w-[340px] text-xs space-y-2">
                        <p>
                          En el equipo destino, una sola vez y como
                          administrador local (red sin dominio), ejecuta:
                        </p>
                        <p className="font-mono text-[11px] leading-relaxed">
                          Enable-PSRemoting -SkipNetworkProfileCheck -Force
                          <br />
                          winrm set winrm/config/service/Auth
                          &apos;@{"{"}Basic=&quot;true&quot;;Negotiate=&quot;true&quot;{"}"}&apos;
                          <br />
                          winrm set winrm/config/service
                          &apos;@{"{"}AllowUnencrypted=&quot;true&quot;{"}"}&apos;
                        </p>
                        <p>
                          La cuenta debe ser administradora local CON
                          contraseña. Usa «Comprobar requisitos» para
                          verificarlo todo antes de instalar.
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
                Puerto {protocol.toUpperCase()}
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

            {/* Comprobación previa (solo WinRM): la receta del
                destino se verifica en vivo antes de copiar nada. */}
            {protocol === "winrm" && (
              <div className="space-y-2 border-t border-border/60 pt-3">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={handleCheckRequirements}
                  disabled={!isCredentialsValid || checkRunning}
                  className="w-full"
                >
                  {checkRunning ? (
                    <Spinner size={14} />
                  ) : (
                    <CheckCircle2 className="mr-2 size-3.5" />
                  )}
                  {checkRunning
                    ? "Comprobando requisitos…"
                    : "Comprobar requisitos en el destino"}
                </Button>
                {checkMessage && (
                  <p className="text-xs text-muted-foreground">
                    {checkMessage}
                  </p>
                )}
                {checks && (
                  <ul className="space-y-1.5">
                    {checks.map((check) => (
                      <li key={check.id} className="text-xs">
                        <span className="flex items-start gap-1.5">
                          {check.ok ? (
                            <CheckCircle2 className="mt-0.5 size-3.5 shrink-0 text-emerald-600" />
                          ) : (
                            <AlertCircle className="mt-0.5 size-3.5 shrink-0 text-rose-600" />
                          )}
                          <span>
                            <span className="font-medium text-foreground">
                              {check.etiqueta}
                            </span>
                            <span className="block text-muted-foreground">
                              {check.detalle}
                            </span>
                            {!check.ok && check.consejo && (
                              <span className="mt-0.5 block font-mono text-[11px] text-muted-foreground">
                                {check.consejo}
                              </span>
                            )}
                          </span>
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}
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
