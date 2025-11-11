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
  Key,
  Copy,
  Clock,
  Calendar,
  Activity,
  Trash2,
} from "lucide-react";
import { FullscreenSpinner } from "@/components/ui/spinner";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { useToast } from "@/hooks/use-toast";
import { ThemeToggle } from "@/components/system/ThemeToggle";
import { formatDateTime, getCurrentDate } from "@/lib/time";

interface USBHistoryItem {
  id: string;
  pcName: string;
  driveLetter: string;
  volumeName: string;
  serialNumber: string;
  model: string;
  size: number;
  connectedAt: string;
  disconnectedAt: string | null;
  lastSeen: string;
  isConnected: boolean;
}

interface Computer {
  id: string;
  name: string;
  ipAddress: string;
  isActive: boolean;
  serviceRunning: boolean;
  lastSeen: string | null;
}

interface UserData {
  username: string;
  apiKey: string;
}

type AlertType = "success" | "error" | "warning" | "info";

type AlertMessage = {
  type: AlertType;
  text: string;
};

type DataSnapshot = {
  usbHistory: USBHistoryItem[];
  connectedUSBs: USBHistoryItem[];
  computer: Computer | null;
  apiKey: string;
};

// Normaliza la respuesta del backend y rellena valores faltantes.
const normalizeHistoryItem = (item: any): USBHistoryItem => {
  const fallbackId = `${item?.pcName ?? "pc"}-${item?.driveLetter ?? "drive"}-${
    item?.connectedAt ?? Date.now()
  }`;
  const idRaw = item?.id;
  const id =
    typeof idRaw === "string"
      ? idRaw
      : typeof idRaw === "number"
      ? idRaw.toString()
      : fallbackId;

  const ensureIso = (value: unknown, fallbackDate: Date) => {
    if (typeof value === "string" && value.trim()) {
      const parsed = new Date(value);
      return Number.isNaN(parsed.getTime())
        ? fallbackDate.toISOString()
        : parsed.toISOString();
    }
    if (value instanceof Date) {
      return Number.isNaN(value.getTime())
        ? fallbackDate.toISOString()
        : value.toISOString();
    }
    if (typeof value === "number" && Number.isFinite(value)) {
      const parsed = new Date(value);
      return Number.isNaN(parsed.getTime())
        ? fallbackDate.toISOString()
        : parsed.toISOString();
    }
    return fallbackDate.toISOString();
  };

  const connectedDate = ensureIso(item?.connectedAt, new Date());
  const lastSeenDate = ensureIso(
    item?.lastSeen ?? connectedDate,
    new Date(connectedDate)
  );

  return {
    id,
    pcName: typeof item?.pcName === "string" ? item.pcName : "—",
    driveLetter:
      typeof item?.driveLetter === "string" && item.driveLetter
        ? item.driveLetter
        : "—",
    volumeName:
      typeof item?.volumeName === "string" && item.volumeName
        ? item.volumeName
        : "Sin nombre",
    serialNumber:
      typeof item?.serialNumber === "string" && item.serialNumber
        ? item.serialNumber
        : "—",
    model:
      typeof item?.model === "string" && item.model
        ? item.model
        : "Desconocido",
    size:
      typeof item?.size === "number" ? item.size : Number(item?.size ?? 0) || 0,
    connectedAt: connectedDate,
    disconnectedAt:
      typeof item?.disconnectedAt === "string" && item.disconnectedAt
        ? item.disconnectedAt
        : null,
    lastSeen: lastSeenDate,
    isConnected: Boolean(item?.isConnected),
  };
};

const mergeConnectionHistory = (
  history: USBHistoryItem[],
  activeConnections: USBHistoryItem[]
) => {
  const byId = new Map<string, USBHistoryItem>();
  history.forEach((item) => byId.set(item.id, item));

  activeConnections.forEach((active) => {
    const existing = byId.get(active.id);
    byId.set(active.id, {
      ...existing,
      ...active,
      isConnected: true,
      disconnectedAt: null,
    });
  });

  return Array.from(byId.values()).sort((a, b) => {
    const aDate = new Date(a.connectedAt).getTime();
    const bDate = new Date(b.connectedAt).getTime();
    return bDate - aDate;
  });
};

const filterByAssignedComputer = (
  items: USBHistoryItem[],
  computerName: string | null | undefined
) => {
  if (!computerName) return items;
  const normalized = computerName.trim().toLowerCase();
  if (!normalized) return items;
  return items.filter((item) => {
    const itemName = item.pcName.trim().toLowerCase();
    if (!itemName || itemName === "—".toLowerCase()) {
      return true;
    }
    return itemName === normalized;
  });
};

export default function UnlockedPage() {
  const router = useRouter();
  const [username, setUsername] = useState("");
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [usbHistory, setUsbHistory] = useState<USBHistoryItem[]>([]);
  const [computer, setComputer] = useState<Computer | null>(null);
  const [apiKey, setApiKey] = useState("");
  const [activeTab, setActiveTab] = useState<"history" | "apikey">("history");
  const [credentialDialog, setCredentialDialog] = useState<null | {
    message: string;
  }>(null);
  const [reauthUsername, setReauthUsername] = useState("");
  const [reauthPassword, setReauthPassword] = useState("");
  const [reauthError, setReauthError] = useState<string | null>(null);
  const [reauthLoading, setReauthLoading] = useState(false);
  const [copiedApiKey, setCopiedApiKey] = useState(false);
  const [clearingHistory, setClearingHistory] = useState(false);
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

    const prevHistoryIds = new Set(previous.usbHistory.map((item) => item.id));
    const newHistoryItems = next.usbHistory.filter(
      (item) => !prevHistoryIds.has(item.id)
    );

    if (newHistoryItems.length) {
      return {
        type: "info",
        text:
          newHistoryItems.length === 1
            ? "Se registró un nuevo evento USB."
            : `Se registraron ${newHistoryItems.length} nuevos eventos USB.`,
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
        const rawHistory: USBHistoryItem[] = Array.isArray(data.usbHistory)
          ? data.usbHistory.map(normalizeHistoryItem)
          : [];
        const activeConnections: USBHistoryItem[] = Array.isArray(
          data.connectedUSBs
        )
          ? data.connectedUSBs.map(normalizeHistoryItem)
          : [];
        const mergedHistory = mergeConnectionHistory(
          rawHistory,
          activeConnections
        );
        const assignedPcName = data?.computer?.name ?? null;
        const filteredHistory = filterByAssignedComputer(
          mergedHistory,
          assignedPcName
        );
        const filteredActiveConnections = filterByAssignedComputer(
          activeConnections,
          assignedPcName
        );

        const nextSnapshot: DataSnapshot = {
          usbHistory: filteredHistory,
          connectedUSBs: filteredActiveConnections,
          computer: data.computer || null,
          apiKey: data.apiKey || "",
        };

        setUsbHistory(nextSnapshot.usbHistory);
        setComputer(nextSnapshot.computer);
        setApiKey(nextSnapshot.apiKey);

        snapshotRef.current = nextSnapshot;
        fetchErrorRef.current = null;

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

  const handleCopyApiKey = async () => {
    if (!apiKey) {
      showToast({
        type: "error",
        text: "La API Key aún no está disponible.",
      });
      return;
    }

    try {
      if (navigator?.clipboard?.writeText) {
        await navigator.clipboard.writeText(apiKey);
      } else {
        const textArea = document.createElement("textarea");
        textArea.value = apiKey;
        textArea.style.position = "fixed";
        textArea.style.opacity = "0";
        document.body.appendChild(textArea);
        textArea.focus();
        textArea.select();
        const successful = document.execCommand("copy");
        document.body.removeChild(textArea);

        if (!successful) {
          throw new Error("Fallback copy command failed");
        }
      }

      setCopiedApiKey(true);
      showToast({
        type: "success",
        text: "API Key copiada al portapapeles",
      });
      setTimeout(() => setCopiedApiKey(false), 2000);
    } catch (error) {
      console.error("Error copiando API Key:", error);
      showToast({
        type: "error",
        text: "No se pudo copiar la API Key.",
      });
    }
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
    const end = disconnectedAt ? new Date(disconnectedAt) : getCurrentDate();
    const diff = end.getTime() - start.getTime();

    const hours = Math.floor(diff / (1000 * 60 * 60));
    const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
    const seconds = Math.floor((diff % (1000 * 60)) / 1000);

    if (hours > 0) return `${hours}h ${minutes}m`;
    if (minutes > 0) return `${minutes}m ${seconds}s`;
    return `${seconds}s`;
  };

  const handleClearHistory = useCallback(async () => {
    if (clearingHistory) return;
    setClearingHistory(true);
    try {
      const response = await fetch("/api/usb-event/user-devices", {
        method: "DELETE",
        credentials: "include",
      });
      const data = await response.json().catch(() => null);
      if (!response.ok || data?.ok !== true) {
        const message = data?.error || `Error HTTP ${response.status}`;
        showToast({ type: "error", text: message });
        return;
      }

      setUsbHistory([]);
      snapshotRef.current = {
        usbHistory: [],
        connectedUSBs: [],
        computer,
        apiKey,
      };

      const eventsDeleted = data?.deletedEvents ?? 0;
      const connectionsDeleted = data?.deletedConnections ?? 0;
      const description =
        eventsDeleted || connectionsDeleted
          ? `Se eliminaron ${eventsDeleted} evento(s) y ${connectionsDeleted} registro(s).`
          : "No había eventos para eliminar.";

      showToast({
        type: "success",
        text: description,
      });
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : "No se pudo limpiar el historial.";
      showToast({ type: "error", text: message });
    } finally {
      setClearingHistory(false);
    }
  }, [clearingHistory, showToast, computer, apiKey]);

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
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-slate-100 to-slate-50 dark:from-slate-950 dark:via-slate-900 dark:to-slate-950 p-4 md:p-8">
      <div className="max-w-7xl mx-auto space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold tracking-tight bg-gradient-to-r from-slate-700 to-slate-900 dark:from-slate-100 dark:to-slate-300 bg-clip-text text-transparent">
              Panel de Control USB
            </h1>
            <p className="text-slate-600 dark:text-slate-300 mt-1 flex items-center gap-2">
              <Shield className="inline w-4 h-4" />
              Usuario:{" "}
              <span className="font-medium text-slate-800 dark:text-slate-100">
                {username}
              </span>
            </p>
          </div>
          <div className="flex gap-2">
            <Button
              onClick={() => fetchData(true)}
              variant="outline"
              size="sm"
              disabled={refreshing}
              className="border-slate-300 dark:border-slate-600 hover:bg-slate-100 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200"
            >
              <RefreshCw
                className={`mr-2 h-4 w-4 ${refreshing ? "animate-spin" : ""}`}
              />
              {refreshing ? "Actualizando..." : "Actualizar"}
            </Button>
            <ThemeToggle />
            <Button
              onClick={handleLogout}
              variant="outline"
              size="sm"
              className="border-slate-300 dark:border-slate-600 hover:bg-slate-100 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200"
            >
              <LogOut className="w-4 h-4 mr-2" />
              Cerrar Sesión
            </Button>
          </div>
        </div>

        {/* Información de la computadora */}
        {computer ? (
          <Card className="border-slate-200 dark:border-slate-700 shadow-sm hover:shadow-md transition-shadow bg-white dark:bg-slate-900">
            <CardHeader className="bg-gradient-to-r from-slate-50 to-white dark:from-slate-800 dark:to-slate-900 border-b border-slate-100 dark:border-slate-700">
              <CardTitle className="flex items-center gap-2 text-slate-800 dark:text-slate-100">
                <HardDrive className="w-5 h-5 text-slate-600 dark:text-slate-300" />
                Mi Computadora
              </CardTitle>
              <CardDescription className="text-slate-600 dark:text-slate-300">
                Información de la computadora asignada
              </CardDescription>
            </CardHeader>
            <CardContent className="pt-6">
              <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
                <div className="space-y-1">
                  <p className="text-sm font-medium text-slate-500 dark:text-slate-400 flex items-center gap-1">
                    <HardDrive className="w-3.5 h-3.5" />
                    Nombre
                  </p>
                  <p className="font-semibold text-slate-900 dark:text-slate-100">
                    {computer.name}
                  </p>
                </div>
                <div className="space-y-1">
                  <p className="text-sm font-medium text-slate-500 dark:text-slate-400 flex items-center gap-1">
                    <Activity className="w-3.5 h-3.5" />
                    Dirección IP
                  </p>
                  <p className="font-mono font-medium text-slate-900 dark:text-slate-100">
                    {computer.ipAddress}
                  </p>
                </div>
                <div className="space-y-1">
                  <p className="text-sm font-medium text-slate-500 dark:text-slate-400">
                    Estado
                  </p>
                  <div className="flex items-center gap-2">
                    <div
                      className={`w-2.5 h-2.5 rounded-full ${
                        computer.isActive
                          ? "bg-green-500 shadow-[0_0_8px_rgba(34,197,94,0.5)]"
                          : "bg-red-500 shadow-[0_0_8px_rgba(239,68,68,0.5)]"
                      }`}
                    />
                    <span className="font-semibold text-slate-900 dark:text-slate-100">
                      {computer.isActive ? "Activa" : "Inactiva"}
                    </span>
                  </div>
                </div>
                <div className="space-y-1">
                  <p className="text-sm font-medium text-slate-500 dark:text-slate-400">
                    Servicio
                  </p>
                  <div className="flex items-center gap-2">
                    <div
                      className={`w-2.5 h-2.5 rounded-full ${
                        computer.serviceRunning
                          ? "bg-green-500 shadow-[0_0_8px_rgba(34,197,94,0.5)]"
                          : "bg-red-500 shadow-[0_0_8px_rgba(239,68,68,0.5)]"
                      }`}
                    />
                    <span className="font-semibold text-slate-900 dark:text-slate-100">
                      {computer.serviceRunning ? "Ejecutándose" : "Detenido"}
                    </span>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>
        ) : (
          <Alert className="border-amber-300 dark:border-amber-600 bg-amber-50 dark:bg-amber-950/30">
            <AlertCircle className="h-5 w-5 text-amber-600 dark:text-amber-400" />
            <AlertDescription className="text-amber-800 dark:text-amber-200 font-medium">
              No tiene una computadora asignada. Por favor, contacte al
              administrador del sistema.
            </AlertDescription>
          </Alert>
        )}

        {/* Historial y API Key */}
        <Card className="border-slate-200 dark:border-slate-700 shadow-sm hover:shadow-md transition-shadow bg-white dark:bg-slate-900">
          <CardHeader className="bg-gradient-to-r from-slate-50 to-white dark:from-slate-800 dark:to-slate-900 border-b border-slate-100 dark:border-slate-700">
            <CardTitle className="flex items-center gap-2 text-slate-800 dark:text-slate-100">
              <Usb className="w-5 h-5 text-slate-600 dark:text-slate-300" />
              Información del Usuario
            </CardTitle>
            <CardDescription className="text-slate-600 dark:text-slate-300">
              Historial de dispositivos USB y credenciales de acceso
            </CardDescription>
          </CardHeader>
          <CardContent className="pt-6">
            {/* Tabs */}
            <div className="flex gap-1 mb-6 border-b border-slate-200 dark:border-slate-700">
              <button
                onClick={() => setActiveTab("history")}
                className={`px-5 py-2.5 font-semibold transition-all relative ${
                  activeTab === "history"
                    ? "text-slate-900 dark:text-slate-100"
                    : "text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200"
                }`}
              >
                <span className="flex items-center gap-2">
                  <Clock className="w-4 h-4" />
                  Historial ({usbHistory.length})
                </span>
                {activeTab === "history" && (
                  <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-slate-700 dark:bg-slate-300" />
                )}
              </button>
              <button
                onClick={() => setActiveTab("apikey")}
                className={`px-5 py-2.5 font-semibold transition-all relative ${
                  activeTab === "apikey"
                    ? "text-slate-900 dark:text-slate-100"
                    : "text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200"
                }`}
              >
                <span className="flex items-center gap-2">
                  <Key className="w-4 h-4" />
                  API Key
                </span>
                {activeTab === "apikey" && (
                  <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-slate-700 dark:bg-slate-300" />
                )}
              </button>
            </div>

            {/* Tab: Historial */}
            {activeTab === "history" && (
              <div className="space-y-3">
                <div className="flex justify-end">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="flex items-center gap-2"
                    onClick={handleClearHistory}
                    disabled={clearingHistory || usbHistory.length === 0}
                  >
                    {clearingHistory ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <Trash2 className="h-4 w-4" />
                    )}
                    {clearingHistory ? "Limpiando..." : "Limpiar historial"}
                  </Button>
                </div>
                {usbHistory.length === 0 ? (
                  <div className="flex flex-col items-center justify-center py-16 text-center">
                    <Usb className="w-16 h-16 text-slate-300 dark:text-slate-600 mb-4" />
                    <p className="text-slate-500 dark:text-slate-300 font-medium">
                      No hay historial de dispositivos USB
                    </p>
                    <p className="text-sm text-slate-400 dark:text-slate-400 mt-1">
                      Los dispositivos conectados aparecerán aquí
                    </p>
                  </div>
                ) : (
                  <div className="max-h-[600px] overflow-y-auto space-y-3 pr-2">
                    {usbHistory.map((usb) => (
                      <div
                        key={usb.id}
                        className={`group p-4 rounded-xl border transition-all hover:shadow-md ${
                          usb.isConnected
                            ? "bg-green-50 dark:bg-green-950/20 border-green-200 dark:border-green-800"
                            : "bg-white dark:bg-slate-800 border-slate-200 dark:border-slate-600"
                        }`}
                      >
                        <div className="flex items-start gap-4">
                          <div
                            className={`p-3 rounded-lg ${
                              usb.isConnected
                                ? "bg-green-100 dark:bg-green-900/30"
                                : "bg-slate-100 dark:bg-slate-700"
                            }`}
                          >
                            <Usb
                              className={`w-6 h-6 ${
                                usb.isConnected
                                  ? "text-green-600 dark:text-green-400"
                                  : "text-slate-400 dark:text-slate-400"
                              }`}
                            />
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 mb-2">
                              <p className="font-bold text-lg text-slate-900 dark:text-slate-100 truncate">
                                {usb.volumeName || "Sin nombre"}
                              </p>
                              <Badge
                                variant={
                                  usb.isConnected ? "default" : "outline"
                                }
                                className={`${
                                  usb.isConnected
                                    ? "bg-green-600 hover:bg-green-700 border-green-600"
                                    : "border-slate-300 dark:border-slate-600 text-slate-700 dark:text-slate-200"
                                }`}
                              >
                                {usb.isConnected ? "Conectada" : "Desconectada"}
                              </Badge>
                            </div>
                            <div className="space-y-2">
                              <div className="flex flex-wrap gap-3 text-sm text-slate-600 dark:text-slate-300">
                                <span className="flex items-center gap-1">
                                  <HardDrive className="w-3.5 h-3.5" />
                                  <span className="font-medium">
                                    {usb.driveLetter}
                                  </span>
                                </span>
                                <span>•</span>
                                <span>{usb.model}</span>
                                <span>•</span>
                                <span className="font-medium">
                                  {formatBytes(usb.size)}
                                </span>
                              </div>
                              <div className="text-xs text-slate-600 dark:text-slate-300 space-y-1 bg-slate-50 dark:bg-slate-700/50 p-3 rounded-lg">
                                <p className="flex items-center gap-2">
                                  <Calendar className="w-3.5 h-3.5" />
                                  <span className="font-medium">
                                    Conectada:
                                  </span>
                                  <span>{formatDateTime(usb.connectedAt)}</span>
                                </p>
                                {usb.disconnectedAt && (
                                  <p className="flex items-center gap-2">
                                    <Calendar className="w-3.5 h-3.5" />
                                    <span className="font-medium">
                                      Desconectada:
                                    </span>
                                    <span>
                                      {formatDateTime(usb.disconnectedAt)}
                                    </span>
                                  </p>
                                )}
                                <p className="flex items-center gap-2">
                                  <Clock className="w-3.5 h-3.5" />
                                  <span className="font-medium">Duración:</span>
                                  <span className="font-mono">
                                    {calculateConnectionDuration(
                                      usb.connectedAt,
                                      usb.disconnectedAt
                                    )}
                                  </span>
                                </p>
                                <p className="flex items-center gap-2">
                                  <Shield className="w-3.5 h-3.5" />
                                  <span className="font-medium">Serial:</span>
                                  <span className="font-mono text-xs">
                                    {usb.serialNumber}
                                  </span>
                                </p>
                              </div>
                            </div>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* Tab: API Key */}
            {activeTab === "apikey" && (
              <div className="space-y-4">
                <Alert className="border-blue-300 dark:border-blue-700 bg-blue-50 dark:bg-blue-950/30">
                  <Info className="h-4 w-4 text-blue-600 dark:text-blue-400" />
                  <AlertDescription className="text-blue-900 dark:text-blue-200 text-sm font-medium">
                    Esta es su clave de API personal. Utilícela para autenticar
                    las solicitudes al sistema. No comparta esta clave con
                    nadie.
                  </AlertDescription>
                </Alert>

                <div className="space-y-3">
                  <Label
                    htmlFor="apikey"
                    className="text-base font-semibold text-slate-900 dark:text-slate-100"
                  >
                    API Key Personal
                  </Label>
                  <div className="flex gap-2">
                    <div className="relative flex-1">
                      <Input
                        id="apikey"
                        value={apiKey || "Cargando..."}
                        readOnly
                        className="font-mono text-sm bg-slate-100 dark:bg-slate-800 border-slate-300 dark:border-slate-600 pr-10 text-slate-900 dark:text-slate-100"
                      />
                      <Key className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500 dark:text-slate-400" />
                    </div>
                    <Button
                      onClick={handleCopyApiKey}
                      disabled={!apiKey}
                      variant={copiedApiKey ? "default" : "outline"}
                      className={`${
                        copiedApiKey
                          ? "bg-green-600 hover:bg-green-700 text-white border-green-600"
                          : "border-slate-300 dark:border-slate-600 hover:bg-slate-100 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200"
                      }`}
                    >
                      {copiedApiKey ? (
                        <>
                          <CheckCircle className="w-4 h-4 mr-2" />
                          Copiada
                        </>
                      ) : (
                        <>
                          <Copy className="w-4 h-4 mr-2" />
                          Copiar
                        </>
                      )}
                    </Button>
                  </div>
                  <p className="text-xs text-slate-600 dark:text-slate-300 flex items-start gap-2">
                    <Shield className="w-3.5 h-3.5 mt-0.5 flex-shrink-0 text-slate-500 dark:text-slate-400" />
                    <span>
                      Mantenga esta clave segura. Si cree que ha sido
                      comprometida, contacte al administrador para solicitar una
                      nueva.
                    </span>
                  </p>
                </div>
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
        <AlertDialogContent className="sm:max-w-md border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900">
          <form onSubmit={handleCredentialSubmit} className="space-y-4">
            <AlertDialogHeader>
              <AlertDialogTitle className="text-slate-900 dark:text-slate-100">
                Validación requerida
              </AlertDialogTitle>
              <AlertDialogDescription className="text-slate-600 dark:text-slate-300">
                {credentialDialog?.message ||
                  "Por favor, ingrese sus credenciales para continuar."}
              </AlertDialogDescription>
            </AlertDialogHeader>

            <div className="space-y-3">
              <div className="space-y-1.5">
                <Label
                  htmlFor="reauth-username"
                  className="text-slate-700 dark:text-slate-200"
                >
                  Usuario
                </Label>
                <Input
                  id="reauth-username"
                  value={reauthUsername}
                  onChange={(event) => setReauthUsername(event.target.value)}
                  placeholder="usuario"
                  autoComplete="username"
                  disabled={reauthLoading}
                  autoFocus
                  className="border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100"
                />
              </div>
              <div className="space-y-1.5">
                <Label
                  htmlFor="reauth-password"
                  className="text-slate-700 dark:text-slate-200"
                >
                  Contraseña
                </Label>
                <Input
                  id="reauth-password"
                  type="password"
                  value={reauthPassword}
                  onChange={(event) => setReauthPassword(event.target.value)}
                  placeholder="••••••••"
                  autoComplete="current-password"
                  disabled={reauthLoading}
                  className="border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100"
                />
              </div>
              {reauthError && (
                <Alert className="border-red-200 dark:border-red-700 bg-red-50 dark:bg-red-950/30">
                  <AlertCircle className="h-4 w-4 text-red-600 dark:text-red-400" />
                  <AlertDescription className="text-red-800 dark:text-red-200 text-sm font-medium">
                    {reauthError}
                  </AlertDescription>
                </Alert>
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
              <Button
                type="submit"
                disabled={reauthLoading}
                className="bg-slate-700 hover:bg-slate-800 dark:bg-slate-600 dark:hover:bg-slate-500 text-white"
              >
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
