"use client";
import { FormEvent, useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { LucideIcon } from "lucide-react";
import {
  LogOut,
  Shield,
  Usb,
  HardDrive,
  RefreshCw,
  CheckCircle,
  AlertCircle,
  AlertTriangle,
  Info,
  Loader2,
} from "lucide-react";
import { FullscreenSpinner } from "@/components/ui/spinner";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { useToast } from "@/hooks/use-toast";

interface USBDevice {
  id: string;
  pcName: string;
  pcIp: string;
  pcUser: string;
  event: string;
  timestamp: string;
  createdAt: string;
}

interface ConnectedUSB {
  id: string;
  pcName: string;
  driveLetter: string;
  volumeName: string;
  serialNumber: string;
  model: string;
  size: bigint;
  connectedAt: string;
  lastSeen: string;
  isConnected: boolean;
}

interface USBHistoryItem {
  id: string;
  pcName: string;
  driveLetter: string;
  volumeName: string;
  serialNumber: string;
  model: string;
  size: bigint;
  connectedAt: string;
  disconnectedAt: string | null;
  lastSeen: string;
  isConnected: boolean;
}

interface PendingUnlock {
  id: string;
  pcName: string;
  driveLetter: string;
  createdAt: string;
  expiresAt: string;
  unlocked: boolean;
}

interface Computer {
  id: string;
  name: string;
  ipAddress: string;
  isActive: boolean;
  serviceRunning: boolean;
  lastSeen: string | null;
}

type AlertType = "success" | "error" | "warning" | "info";

type AlertMessage = {
  type: AlertType;
  text: string;
};

type DataSnapshot = {
  devices: USBDevice[];
  connectedUSBs: ConnectedUSB[];
  usbHistory: USBHistoryItem[];
  pendingUnlocks: PendingUnlock[];
};

const formatDriveList = (items: (string | null | undefined)[]) => {
  const unique = Array.from(
    new Set(
      items
        .map((drive) =>
          (drive || "")
            .toUpperCase()
            .replace(/[^A-Z0-9:]/g, "")
            .trim()
        )
        .filter(Boolean)
    )
  );

  if (!unique.length) {
    return "";
  }

  if (unique.length <= 3) {
    return unique.join(", ");
  }

  const shown = unique.slice(0, 3).join(", ");
  const remaining = unique.length - 3;
  return `${shown} y ${remaining} más`;
};

export default function UnlockedPage() {
  const router = useRouter();
  const [username, setUsername] = useState("");
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [devices, setDevices] = useState<USBDevice[]>([]);
  const [connectedUSBs, setConnectedUSBs] = useState<ConnectedUSB[]>([]);
  const [usbHistory, setUsbHistory] = useState<USBHistoryItem[]>([]);
  const [pendingUnlocks, setPendingUnlocks] = useState<PendingUnlock[]>([]);
  const [computer, setComputer] = useState<Computer | null>(null);
  const [activeTab, setActiveTab] = useState<"connected" | "history">(
    "connected"
  );
  const [credentialDialog, setCredentialDialog] = useState<null | {
    drives: string;
  }>(null);
  const [reauthUsername, setReauthUsername] = useState("");
  const [reauthPassword, setReauthPassword] = useState("");
  const [reauthError, setReauthError] = useState<string | null>(null);
  const [reauthLoading, setReauthLoading] = useState(false);
  const snapshotRef = useRef<DataSnapshot | null>(null);
  const fetchErrorRef = useRef<string | null>(null);
  const { toast } = useToast();

  const showToast = useCallback(
    ({ type, text }: AlertMessage) => {
      const config: Record<
        AlertType,
        {
          title: string;
          icon: LucideIcon;
          className?: string;
          variant: "default" | "destructive";
        }
      > = {
        success: {
          title: "Operación exitosa",
          icon: CheckCircle,
          className:
            "border border-green-200 bg-green-50 text-green-800 dark:border-green-900/60 dark:bg-green-950/40 dark:text-green-200",
          variant: "default",
        },
        error: {
          title: "Ocurrió un error",
          icon: AlertCircle,
          variant: "destructive",
        },
        warning: {
          title: "Atención requerida",
          icon: AlertTriangle,
          className:
            "border border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-900/60 dark:bg-amber-950/40 dark:text-amber-200",
          variant: "default",
        },
        info: {
          title: "Información",
          icon: Info,
          className:
            "border border-blue-200 bg-blue-50 text-blue-800 dark:border-blue-900/60 dark:bg-blue-950/40 dark:text-blue-200",
          variant: "default",
        },
      };

      const { title, icon: Icon, className, variant } = config[type];

      toast({
        title,
        description: (
          <span className="flex items-center gap-2">
            <Icon className="h-4 w-4" />
            <span>{text}</span>
          </span>
        ),
        variant,
        className,
      });
    },
    [toast]
  );

  const summarizeRefreshDelta = (
    previous: DataSnapshot | null,
    next: DataSnapshot
  ): AlertMessage => {
    if (!previous) {
      return {
        type: "success",
        text: "Datos sincronizados correctamente.",
      };
    }

    const prevPendingIds = new Set(
      previous.pendingUnlocks.map((item) => item.id)
    );
    const nextPendingIds = new Set(next.pendingUnlocks.map((item) => item.id));

    const newPending = next.pendingUnlocks.filter(
      (item) => !prevPendingIds.has(item.id)
    );
    if (newPending.length) {
      const drives = formatDriveList(
        newPending.map((item) => item.driveLetter)
      );
      return {
        type: "warning",
        text:
          newPending.length === 1
            ? `Se detectó una nueva memoria pendiente${
                drives ? ` (${drives})` : ""
              }.`
            : `Se detectaron ${newPending.length} memorias pendientes${
                drives ? ` (${drives})` : ""
              }.`,
      };
    }

    const resolvedPending = previous.pendingUnlocks.filter(
      (item) => !next.pendingUnlocks.some((nextItem) => nextItem.id === item.id)
    );
    if (resolvedPending.length) {
      const drives = formatDriveList(
        resolvedPending.map((item) => item.driveLetter)
      );
      return {
        type: "success",
        text:
          resolvedPending.length === 1
            ? `La memoria ${drives || "pendiente"} ya fue autorizada.`
            : `${resolvedPending.length} memorias fueron autorizadas${
                drives ? ` (${drives})` : ""
              }.`,
      };
    }

    const prevConnectedIds = new Set(
      previous.connectedUSBs.map((item) => item.id)
    );
    const nextConnectedIds = new Set(next.connectedUSBs.map((item) => item.id));

    const newConnections = next.connectedUSBs.filter(
      (item) => !prevConnectedIds.has(item.id)
    );
    if (newConnections.length) {
      const drives = formatDriveList(
        newConnections.map((item) => item.driveLetter)
      );
      return {
        type: "info",
        text:
          newConnections.length === 1
            ? `Se conectó una nueva memoria${drives ? ` (${drives})` : ""}.`
            : `Se conectaron ${newConnections.length} memorias nuevas${
                drives ? ` (${drives})` : ""
              }.`,
      };
    }

    const disconnected = previous.connectedUSBs.filter(
      (item) => !nextConnectedIds.has(item.id)
    );
    if (disconnected.length) {
      const drives = formatDriveList(
        disconnected.map((item) => item.driveLetter)
      );
      return {
        type: "info",
        text:
          disconnected.length === 1
            ? `La memoria ${drives || "USB"} se desconectó.`
            : `Se desconectaron ${disconnected.length} memorias${
                drives ? ` (${drives})` : ""
              }.`,
      };
    }

    const prevDeviceIds = new Set(previous.devices.map((item) => item.id));
    const newEvents = next.devices.filter(
      (item) => !prevDeviceIds.has(item.id)
    );
    if (newEvents.length) {
      return {
        type: "info",
        text:
          newEvents.length === 1
            ? "Se registró un nuevo evento USB."
            : `Se registraron ${newEvents.length} nuevos eventos USB.`,
      };
    }

    return {
      type: "info",
      text: "Los datos ya estaban actualizados.",
    };
  };

  const fetchData = async (manual = false) => {
    const previousSnapshot = snapshotRef.current;

    try {
      if (manual) {
        setRefreshing(true);
      } else if (!snapshotRef.current) {
        setLoading(true);
      }

      const res = await fetch("/api/usb-event/user-devices", {
        credentials: "include",
        cache: "no-store",
      });

      if (!res.ok) {
        throw new Error("Error al cargar datos");
      }

      const data = await res.json();

      if (data.ok) {
        const nextSnapshot: DataSnapshot = {
          devices: data.events || [],
          connectedUSBs: data.connectedUSBs || [],
          usbHistory: data.usbHistory || [],
          pendingUnlocks: data.pendingUnlocks || [],
        };

        setDevices(nextSnapshot.devices);
        setPendingUnlocks(nextSnapshot.pendingUnlocks);
        setComputer(data.computer);
        setConnectedUSBs(nextSnapshot.connectedUSBs);
        setUsbHistory(nextSnapshot.usbHistory);

        snapshotRef.current = nextSnapshot;
        fetchErrorRef.current = null;

        if (previousSnapshot) {
          const prevConnectedIds = new Set(
            previousSnapshot.connectedUSBs.map((item) => item.id)
          );
          const newConnections = nextSnapshot.connectedUSBs.filter(
            (item) => !prevConnectedIds.has(item.id)
          );

          if (newConnections.length) {
            const drives = formatDriveList(
              newConnections.map((item) => item.driveLetter)
            );
            setCredentialDialog({ drives: drives || "USB" });
            setReauthError(null);
            setReauthPassword("");
            setReauthUsername((current) => current || username);
          }
        }

        if (manual) {
          showToast(summarizeRefreshDelta(previousSnapshot, nextSnapshot));
        }
      } else {
        const errorMessage = "El servidor no devolvió datos válidos.";
        if (manual) {
          showToast({ type: "error", text: errorMessage });
        } else if (fetchErrorRef.current !== errorMessage) {
          showToast({ type: "error", text: errorMessage });
          fetchErrorRef.current = errorMessage;
        }
      }
    } catch (error) {
      console.error("Error al cargar datos:", error);
      const message =
        error instanceof Error
          ? error.message || "Error al cargar datos del dispositivo"
          : "Error al cargar datos del dispositivo";
      if (manual) {
        showToast({ type: "error", text: message });
      } else if (fetchErrorRef.current !== message) {
        showToast({ type: "error", text: message });
        fetchErrorRef.current = message;
      }
    } finally {
      setLoading(false);
      if (manual) {
        setRefreshing(false);
      }
    }
  };

  useEffect(() => {
    const checkSession = async () => {
      try {
        const res = await fetch("/api/auth/session", {
          credentials: "include",
        });
        const data = await res.json();

        if (data.ok && data.user) {
          setUsername(data.user.username);

          // Si es admin, redirigir al panel principal
          if (data.user.role === "admin") {
            router.push("/");
            return;
          }

          // Cargar datos del usuario
          await fetchData();
        } else {
          router.push("/login");
        }
      } catch (error) {
        console.error("Error verificando sesión:", error);
        router.push("/login");
      }
    };

    checkSession();

    // Auto-refresh cada 10 segundos
    const interval = setInterval(() => fetchData(), 10000);
    return () => clearInterval(interval);
  }, [router]);
  useEffect(() => {
    if (credentialDialog) {
      setReauthError(null);
      setReauthPassword("");
      setReauthUsername(username);
    }
  }, [credentialDialog, username]);

  const handleLogout = async () => {
    try {
      await fetch("/api/auth/logout", { method: "POST" });
      try {
        const ch = new BroadcastChannel("auth-state");
        ch.postMessage({ type: "logout" });
        ch.close();
      } catch {}
      window.location.href = "/login";
    } catch {}
  };

  const handleAuthorize = async (driveLetter: string) => {
    try {
      const res = await fetch("/api/usb-event/authorize", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ driveLetter }),
      });

      const data = await res.json();

      if (data.ok) {
        showToast({
          type: "success",
          text: `Memoria ${driveLetter} autorizada. Se desbloqueará en unos segundos.`,
        });

        // Actualizar datos después de 2 segundos
        setTimeout(() => fetchData(), 2000);
      } else {
        showToast({
          type: "error",
          text: data.error || "Error al autorizar la memoria",
        });
      }
    } catch (error) {
      console.error("Error al autorizar:", error);
      showToast({
        type: "error",
        text: "Error de conexión al autorizar la memoria",
      });
    }
  };

  const formatDateTime = (dateString: string) => {
    const date = new Date(dateString);
    return date.toLocaleString("es-ES", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
  };

  const formatBytes = (bytes: bigint | number) => {
    const size = typeof bytes === "bigint" ? Number(bytes) : bytes;
    if (size === 0) return "0 B";
    const k = 1024;
    const sizes = ["B", "KB", "MB", "GB", "TB"];
    const i = Math.floor(Math.log(size) / Math.log(k));
    return Math.round((size / Math.pow(k, i)) * 100) / 100 + " " + sizes[i];
  };

  const calculateConnectionDuration = (
    connectedAt: string,
    disconnectedAt: string | null
  ) => {
    const start = new Date(connectedAt);
    const end = disconnectedAt ? new Date(disconnectedAt) : new Date();
    const diff = end.getTime() - start.getTime();

    const hours = Math.floor(diff / (1000 * 60 * 60));
    const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
    const seconds = Math.floor((diff % (1000 * 60)) / 1000);

    if (hours > 0) return `${hours}h ${minutes}m`;
    if (minutes > 0) return `${minutes}m ${seconds}s`;
    return `${seconds}s`;
  };

  const isPendingUnlock = (driveLetter: string): PendingUnlock | null => {
    return (
      pendingUnlocks.find(
        (unlock) => unlock.driveLetter === driveLetter && !unlock.unlocked
      ) || null
    );
  };

  const getEventBadge = (event: string) => {
    if (event.toLowerCase().includes("conectado")) {
      return <Badge className="bg-green-500">Conectado</Badge>;
    }
    if (event.toLowerCase().includes("bloqueado")) {
      return <Badge className="bg-yellow-500">Bloqueado</Badge>;
    }
    return <Badge variant="outline">{event}</Badge>;
  };

  const handleCredentialSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!credentialDialog) {
      return;
    }

    const trimmedUsername = reauthUsername.trim();
    const trimmedPassword = reauthPassword.trim();

    if (!trimmedUsername || !trimmedPassword) {
      setReauthError("Debes ingresar usuario y contraseña.");
      return;
    }

    if (trimmedUsername.toLowerCase() !== username.trim().toLowerCase()) {
      setReauthError("El usuario ingresado no coincide con la sesión activa.");
      return;
    }

    setReauthLoading(true);
    setReauthError(null);

    try {
      const response = await fetch("/api/usb-auth", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          username: trimmedUsername,
          password: trimmedPassword,
        }),
      });

      const data = await response.json();

      if (!response.ok || !data.authorized) {
        setReauthError(data?.message || "Credenciales incorrectas.");
        return;
      }

      showToast({
        type: "success",
        text: `Credenciales validadas. Puede continuar.`,
      });
      setCredentialDialog(null);
      setReauthPassword("");
    } catch (error) {
      console.error("Error validando credenciales:", error);
      setReauthError("No se pudo validar. Intenta nuevamente.");
    } finally {
      setReauthLoading(false);
    }
  };

  if (loading) {
    return <FullscreenSpinner label="Cargando dispositivos" />;
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-blue-50 dark:from-slate-950 dark:to-blue-950 p-4 md:p-8">
      <div className="max-w-7xl mx-auto space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold tracking-tight text-gray-900 dark:text-gray-100">
              Panel de Control USB
            </h1>
            <p className="text-muted-foreground mt-1">
              <Shield className="inline w-4 h-4 mr-1" />
              Usuario: <span className="font-medium">{username}</span>
            </p>
          </div>
          <div className="flex gap-2">
            <Button
              onClick={() => fetchData(true)}
              variant="outline"
              size="sm"
              disabled={refreshing}
            >
              <RefreshCw
                className={`mr-2 h-4 w-4 ${refreshing ? "animate-spin" : ""}`}
              />
              {refreshing ? "Actualizando..." : "Actualizar"}
            </Button>
            <Button onClick={handleLogout} variant="outline" size="sm">
              <LogOut className="w-4 h-4 mr-2" />
              Cerrar Sesión
            </Button>
          </div>
        </div>

        {/* Información de la computadora */}
        {computer ? (
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <HardDrive className="w-5 h-5" />
                Mi Computadora
              </CardTitle>
              <CardDescription>
                Información de la computadora asignada
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div>
                  <p className="text-sm text-muted-foreground">Nombre</p>
                  <p className="font-medium">{computer.name}</p>
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">Dirección IP</p>
                  <p className="font-medium">{computer.ipAddress}</p>
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">Estado</p>
                  <div className="flex items-center gap-2">
                    <div
                      className={`w-2 h-2 rounded-full ${
                        computer.isActive ? "bg-green-500" : "bg-red-500"
                      }`}
                    />
                    <span className="font-medium">
                      {computer.isActive ? "Activa" : "Inactiva"}
                    </span>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>
        ) : (
          <Alert>
            <AlertCircle className="h-4 w-4" />
            <AlertDescription>
              No tiene una computadora asignada. Contacte al administrador.
            </AlertDescription>
          </Alert>
        )}

        {/* Memorias pendientes de autorización */}
        {pendingUnlocks.length > 0 && (
          <Card className="border-yellow-500 dark:border-yellow-700 bg-gradient-to-r from-yellow-50 to-amber-50 dark:from-yellow-950/20 dark:to-amber-950/20">
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle className="flex items-center gap-2 text-yellow-700 dark:text-yellow-500">
                    <Shield className="w-5 h-5" />
                    Memorias Bloqueadas
                  </CardTitle>
                  <CardDescription className="mt-1">
                    {pendingUnlocks.length}{" "}
                    {pendingUnlocks.length === 1
                      ? "memoria USB bloqueada requiere"
                      : "memorias USB bloqueadas requieren"}{" "}
                    autorización
                  </CardDescription>
                </div>
                <div className="flex items-center gap-2 px-3 py-1 bg-yellow-100 dark:bg-yellow-900/30 rounded-full">
                  <AlertCircle className="w-4 h-4 text-yellow-700 dark:text-yellow-500" />
                  <span className="text-sm font-semibold text-yellow-700 dark:text-yellow-500">
                    {pendingUnlocks.length}
                  </span>
                </div>
              </div>
            </CardHeader>
            <CardContent className="pt-0">
              <div className="space-y-2">
                {pendingUnlocks.map((unlock) => (
                  <div
                    key={unlock.id}
                    className="flex items-center justify-between p-3 bg-white dark:bg-slate-900 rounded-lg border border-yellow-200 dark:border-yellow-800 shadow-sm hover:shadow-md transition-shadow"
                  >
                    <div className="flex items-center gap-3">
                      <div className="p-2 bg-yellow-100 dark:bg-yellow-900/30 rounded-lg">
                        <Usb className="w-5 h-5 text-yellow-600" />
                      </div>
                      <div>
                        <div className="flex items-center gap-2">
                          <p className="font-semibold">
                            Unidad {unlock.driveLetter}
                          </p>
                          <Badge variant="outline" className="text-xs">
                            Solo Lectura
                          </Badge>
                        </div>
                        <p className="text-xs text-muted-foreground">
                          Detectada: {formatDateTime(unlock.createdAt)}
                        </p>
                      </div>
                    </div>
                    <Button
                      onClick={() => handleAuthorize(unlock.driveLetter)}
                      size="sm"
                      className="bg-green-600 hover:bg-green-700"
                    >
                      <CheckCircle className="w-4 h-4 mr-2" />
                      Autorizar
                    </Button>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        )}

        {/* Historial de dispositivos USB */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Usb className="w-5 h-5" />
              Dispositivos USB
            </CardTitle>
            <CardDescription>
              Gestione las memorias USB de su computadora
            </CardDescription>
          </CardHeader>
          <CardContent>
            {/* Tabs */}
            <div className="flex gap-2 mb-4 border-b">
              <button
                onClick={() => setActiveTab("connected")}
                className={`px-4 py-2 font-medium transition-colors relative ${
                  activeTab === "connected"
                    ? "border-b-2 border-blue-600 text-blue-600"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                <span>Conectadas Ahora ({connectedUSBs.length})</span>
                {pendingUnlocks.length > 0 && (
                  <span className="ml-2 px-2 py-0.5 text-xs bg-yellow-500 text-white rounded-full font-bold">
                    {pendingUnlocks.length} bloqueada
                    {pendingUnlocks.length !== 1 ? "s" : ""}
                  </span>
                )}
              </button>
              <button
                onClick={() => setActiveTab("history")}
                className={`px-4 py-2 font-medium transition-colors ${
                  activeTab === "history"
                    ? "border-b-2 border-blue-600 text-blue-600"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                Historial ({usbHistory.length})
              </button>
            </div>

            {/* Tab: Conectadas Ahora */}
            {activeTab === "connected" && (
              <div className="space-y-3">
                {connectedUSBs.length === 0 ? (
                  <p className="text-center text-muted-foreground py-8">
                    No hay dispositivos USB conectados actualmente
                  </p>
                ) : (
                  connectedUSBs.map((usb) => {
                    const pending = isPendingUnlock(usb.driveLetter);
                    const isBlocked = pending !== null;

                    return (
                      <div
                        key={usb.id}
                        className={`flex items-center justify-between p-4 rounded-lg border ${
                          isBlocked
                            ? "bg-yellow-50 dark:bg-yellow-950/20 border-yellow-200 dark:border-yellow-800"
                            : "bg-green-50 dark:bg-green-950/20 border-green-200 dark:border-green-800"
                        }`}
                      >
                        <div className="flex items-center gap-4 flex-1">
                          <Usb
                            className={`w-8 h-8 ${
                              isBlocked ? "text-yellow-600" : "text-green-600"
                            }`}
                          />
                          <div className="flex-1">
                            <div className="flex items-center gap-2 flex-wrap">
                              <p className="font-bold text-lg">
                                {usb.volumeName || "Sin nombre"}
                              </p>
                              {isBlocked ? (
                                <>
                                  <Badge className="bg-yellow-600">
                                    <Shield className="w-3 h-3 mr-1" />
                                    Bloqueada
                                  </Badge>
                                  <Badge variant="outline" className="text-xs">
                                    Solo Lectura
                                  </Badge>
                                </>
                              ) : (
                                <Badge className="bg-green-600">
                                  <CheckCircle className="w-3 h-3 mr-1" />
                                  Desbloqueada
                                </Badge>
                              )}
                            </div>
                            <p className="text-sm text-muted-foreground mt-1">
                              Unidad:{" "}
                              <span className="font-medium">
                                {usb.driveLetter}
                              </span>{" "}
                              • Modelo: {usb.model} • Tamaño:{" "}
                              {formatBytes(usb.size)}
                            </p>
                            <p className="text-xs text-muted-foreground mt-1">
                              Conectada desde: {formatDateTime(usb.connectedAt)}
                              (
                              {calculateConnectionDuration(
                                usb.connectedAt,
                                null
                              )}
                              )
                            </p>
                            {isBlocked && (
                              <p className="text-xs text-yellow-700 dark:text-yellow-500 mt-1 font-medium">
                                ⚠️ Esta memoria está bloqueada en modo solo
                                lectura. Autorícela para poder escribir.
                              </p>
                            )}
                          </div>
                        </div>
                        <div className="flex flex-col items-end gap-2">
                          {isBlocked ? (
                            <Button
                              onClick={() => handleAuthorize(usb.driveLetter)}
                              size="sm"
                              className="bg-green-600 hover:bg-green-700"
                            >
                              <CheckCircle className="w-4 h-4 mr-2" />
                              Autorizar
                            </Button>
                          ) : (
                            <div className="flex items-center gap-1 text-xs text-green-600 font-medium">
                              <CheckCircle className="w-4 h-4" />
                              <span>Autorizada</span>
                            </div>
                          )}
                          <div className="text-right text-xs text-muted-foreground">
                            <p>Serial: {usb.serialNumber}</p>
                          </div>
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
            )}

            {/* Tab: Historial */}
            {activeTab === "history" && (
              <div className="space-y-3">
                {usbHistory.length === 0 ? (
                  <p className="text-center text-muted-foreground py-8">
                    No hay historial de dispositivos USB
                  </p>
                ) : (
                  <div className="max-h-[500px] overflow-y-auto space-y-2">
                    {usbHistory.map((usb) => (
                      <div
                        key={usb.id}
                        className={`flex items-center justify-between p-4 rounded-lg border ${
                          usb.isConnected
                            ? "bg-green-50 dark:bg-green-950/20 border-green-200 dark:border-green-800"
                            : "bg-slate-50 dark:bg-slate-900 border-slate-200 dark:border-slate-800"
                        }`}
                      >
                        <div className="flex items-center gap-4 flex-1">
                          <Usb
                            className={`w-6 h-6 ${
                              usb.isConnected
                                ? "text-green-600"
                                : "text-slate-400"
                            }`}
                          />
                          <div className="flex-1">
                            <div className="flex items-center gap-2">
                              <p className="font-semibold">
                                {usb.volumeName || "Sin nombre"}
                              </p>
                              <Badge
                                variant={
                                  usb.isConnected ? "default" : "outline"
                                }
                                className={
                                  usb.isConnected ? "bg-green-600" : ""
                                }
                              >
                                {usb.isConnected ? "Conectada" : "Desconectada"}
                              </Badge>
                            </div>
                            <p className="text-sm text-muted-foreground">
                              Unidad: {usb.driveLetter} • Modelo: {usb.model} •
                              Tamaño: {formatBytes(usb.size)}
                            </p>
                            <div className="text-xs text-muted-foreground mt-1 space-y-0.5">
                              <p>
                                📅 Conectada: {formatDateTime(usb.connectedAt)}
                              </p>
                              {usb.disconnectedAt && (
                                <p>
                                  📅 Desconectada:{" "}
                                  {formatDateTime(usb.disconnectedAt)}
                                </p>
                              )}
                              <p>
                                ⏱️ Duración:{" "}
                                {calculateConnectionDuration(
                                  usb.connectedAt,
                                  usb.disconnectedAt
                                )}
                              </p>
                            </div>
                          </div>
                        </div>
                        <div className="text-right text-xs text-muted-foreground">
                          <p>Serial:</p>
                          <p className="font-mono">{usb.serialNumber}</p>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      <AlertDialog
        open={!!credentialDialog}
        onOpenChange={(open) => {
          if (!open && !reauthLoading) {
            setCredentialDialog(null);
            handleLogout();
          }
        }}
      >
        <AlertDialogContent className="sm:max-w-md">
          <form onSubmit={handleCredentialSubmit} className="space-y-4">
            <AlertDialogHeader>
              <AlertDialogTitle>Validación requerida</AlertDialogTitle>
              <AlertDialogDescription>
                {credentialDialog?.drives
                  ? `Se detectó una nueva memoria (${credentialDialog.drives}). Ingresa nuevamente tus credenciales para confirmar.`
                  : "Se detectó una nueva memoria USB. Ingresa nuevamente tus credenciales para confirmar."}
              </AlertDialogDescription>
            </AlertDialogHeader>

            <div className="space-y-3">
              <div className="space-y-1.5">
                <Label htmlFor="reauth-username">Usuario</Label>
                <Input
                  id="reauth-username"
                  value={reauthUsername}
                  onChange={(event) => setReauthUsername(event.target.value)}
                  placeholder="usuario"
                  autoComplete="username"
                  disabled={reauthLoading}
                  autoFocus
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="reauth-password">Contraseña</Label>
                <Input
                  id="reauth-password"
                  type="password"
                  value={reauthPassword}
                  onChange={(event) => setReauthPassword(event.target.value)}
                  placeholder="••••••••"
                  autoComplete="current-password"
                  disabled={reauthLoading}
                />
              </div>
              {reauthError && (
                <p className="text-sm text-destructive font-medium">
                  {reauthError}
                </p>
              )}
            </div>

            <AlertDialogFooter>
              <Button
                type="button"
                variant="destructive"
                onClick={() => {
                  if (!reauthLoading) {
                    handleLogout();
                  }
                }}
                disabled={reauthLoading}
              >
                Cerrar sesión
              </Button>
              <Button type="submit" disabled={reauthLoading}>
                {reauthLoading && (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                )}
                Validar credenciales
              </Button>
            </AlertDialogFooter>
          </form>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
