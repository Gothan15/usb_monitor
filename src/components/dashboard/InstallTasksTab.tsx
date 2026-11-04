"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Spinner } from "@/components/ui/spinner";
import { getCsrfTokenFromDocument } from "@/lib/utils";
import { useLiveData } from "@/components/providers/LiveDataProvider";
import {
  EmpujeChecklist,
  type RequisitoEmpujeVista,
} from "@/components/dashboard/EmpujeChecklist";
import { ETIQUETA_ESTADO_DESTINO } from "@/lib/installTasks";
import { formatDateTime } from "@/components/dashboard/types";
import {
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  ListTodo,
  RotateCcw,
} from "lucide-react";

interface DestinoTareaVista {
  id: string;
  pcName: string;
  ipAddress: string;
  method: string | null;
  status: string;
  message: string | null;
  attempts: number;
  checks: RequisitoEmpujeVista[] | null;
  startedAt: string | null;
  finishedAt: string | null;
}

interface TareaVista {
  id: string;
  status: string;
  username: string;
  omitIfInstalled: boolean;
  maxAttempts: number;
  createdBy: string | null;
  createdAt: string;
  finishedAt: string | null;
  targets: DestinoTareaVista[];
}

const TONO_ESTADO: Record<string, string> = {
  INSTALADO: "text-emerald-600",
  OMITIDO: "text-muted-foreground",
  ERROR: "text-rose-600",
  INTERRUMPIDO: "text-amber-600",
  ESPERANDO_SENAL: "text-[var(--acero)]",
  COPIANDO: "text-[var(--acero)]",
  INSTALANDO: "text-[var(--acero)]",
  COMPROBANDO: "text-[var(--acero)]",
};

const EN_CURSO = new Set([
  "EN_COLA",
  "COMPROBANDO",
  "COPIANDO",
  "INSTALANDO",
  "ESPERANDO_SENAL",
]);

export function InstallTasksTab() {
  const [tareas, setTareas] = useState<TareaVista[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [expandida, setExpandida] = useState<ReadonlySet<string>>(new Set());
  const [reintentando, setReintentando] = useState<string | null>(null);
  const [claveReintento, setClaveReintento] = useState("");
  const [enviando, setEnviando] = useState(false);
  const [avisoReintento, setAvisoReintento] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/install-tasks", {
        credentials: "include",
      });
      const datos = await res.json().catch(() => null);
      if (!res.ok || !datos?.ok) {
        setError(datos?.error || "No se pudieron cargar las tareas.");
        return;
      }
      setError(null);
      setTareas(datos.tareas as TareaVista[]);
    } catch {
      setError("No se pudo contactar con el panel.");
    }
  }, []);

  useEffect(() => {
    queueMicrotask(() => {
      void load();
    });
    // Red de seguridad: el mecanismo es el empuje por socket.
    const id = setInterval(load, 60_000);
    return () => clearInterval(id);
  }, [load]);

  const { installVersion, connectionStatus } = useLiveData();
  const versionRef = useRef(-1);
  useEffect(() => {
    const previa = versionRef.current;
    versionRef.current = installVersion;
    if (previa === -1 || previa === installVersion) return;
    const id = setTimeout(() => {
      void load();
    }, 600);
    return () => clearTimeout(id);
  }, [installVersion, load]);

  const conectadoRef = useRef(false);
  useEffect(() => {
    if (connectionStatus !== "connected") return;
    if (conectadoRef.current) {
      void load();
    }
    conectadoRef.current = true;
  }, [connectionStatus, load]);

  const alternarChecks = (id: string) => {
    setExpandida((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  const reintentar = async (tareaId: string) => {
    const csrfToken = getCsrfTokenFromDocument();
    if (!csrfToken) {
      setAvisoReintento("Sesión sin token de seguridad. Inicia sesión nuevamente.");
      return;
    }
    try {
      setEnviando(true);
      setAvisoReintento(null);
      const res = await fetch(`/api/install-tasks/${tareaId}/reintentar`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-csrf-token": csrfToken,
        },
        credentials: "include",
        body: JSON.stringify({ clave: claveReintento }),
      });
      const datos = await res.json().catch(() => null);
      if (!res.ok || !datos?.ok) {
        setAvisoReintento(datos?.error || "No se pudo reintentar la tarea.");
        return;
      }
      setClaveReintento("");
      setReintentando(null);
      void load();
    } catch {
      setAvisoReintento("No se pudo contactar con el panel.");
    } finally {
      setEnviando(false);
    }
  };

  return (
    <div className="animate-view-in space-y-10 p-6" data-tour="tasks-main">
      <div className="flex items-end justify-between gap-4">
        <div className="flex flex-1 flex-col">
          <p className="smallcaps text-acero">
            Instalación remota · Modelo Kaspersky
          </p>
          <h2 className="font-display mt-2 text-[1.7rem] font-bold leading-none text-foreground">
            Tareas de instalación
          </h2>
          <p className="mt-2 max-w-xl text-sm text-muted-foreground">
            Cada tarea instala el agente en varios equipos, dos a la
            vez: empuja por SMB a los equipos nuevos y actualiza
            por su canal a los que ya reportan. Un equipo solo se
            da por instalado cuando su agente da la primera señal.
          </p>
        </div>
        <Button variant="outline" onClick={() => void load()}>
          Actualizar
        </Button>
      </div>

      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {tareas === null && !error && (
        <div className="flex items-center gap-3 text-sm text-muted-foreground">
          <Spinner size={16} /> Cargando tareas…
        </div>
      )}

      {tareas !== null && tareas.length === 0 && (
        <div className="flex items-start gap-3 border-t border-border pt-6 text-sm text-muted-foreground">
          <ListTodo className="mt-0.5 size-4 shrink-0 text-[var(--acero)]" />
          <p>
            Todavía no hay tareas. Crea la primera desde el escáner
            de red (equipos descubiertos) o desde Equipos, con la
            selección por lotes.
          </p>
        </div>
      )}

      <div className="space-y-8">
        {(tareas ?? []).map((tarea) => {
          const reintentables = tarea.targets.filter(
            (t) => t.status === "ERROR" || t.status === "INTERRUMPIDO",
          ).length;
          const instalados = tarea.targets.filter(
            (t) => t.status === "INSTALADO",
          ).length;
          return (
            <section
              key={tarea.id}
              className="border border-border/60 bg-muted/10 px-4 py-4"
            >
              <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
                <p className="font-display text-lg font-bold text-foreground">
                  {formatDateTime(tarea.createdAt)}
                </p>
                <span
                  className={
                    tarea.status === "EN_CURSO"
                      ? "text-sm font-medium text-[var(--acero)]"
                      : tarea.status === "COMPLETADA"
                        ? "text-sm font-medium text-emerald-600"
                        : "text-sm font-medium text-rose-600"
                  }
                >
                  {tarea.status === "EN_CURSO"
                    ? "En curso"
                    : tarea.status === "COMPLETADA"
                      ? "Completada"
                      : "Con errores"}
                </span>
                <span className="text-xs text-muted-foreground">
                  {instalados}/{tarea.targets.length} instalados · cuenta{" "}
                  {tarea.username}
                  {tarea.createdBy ? ` · creada por ${tarea.createdBy}` : ""} ·
                  hasta {tarea.maxAttempts} intento
                  {tarea.maxAttempts === 1 ? "" : "s"} por equipo
                  {tarea.omitIfInstalled ? " · omite los instalados" : ""}
                </span>
                {reintentables > 0 && reintentando !== tarea.id && (
                  <Button
                    variant="outline"
                    size="sm"
                    className="ml-auto"
                    onClick={() => {
                      setReintentando(tarea.id);
                      setAvisoReintento(null);
                    }}
                  >
                    <RotateCcw className="mr-1.5 size-3.5" />
                    Reintentar ({reintentables})
                  </Button>
                )}
              </div>

              {reintentando === tarea.id && (
                <div className="mt-3 flex flex-wrap items-center gap-3 border border-border/60 bg-background px-3 py-3">
                  <p className="text-sm text-muted-foreground">
                    La clave no se guardó: vuelve a escribir la de la
                    cuenta {tarea.username}.
                  </p>
                  <Input
                    type="password"
                    value={claveReintento}
                    onChange={(e) => setClaveReintento(e.target.value)}
                    placeholder="Contraseña"
                    className="w-56"
                    autoComplete="off"
                  />
                  <Button
                    size="sm"
                    disabled={enviando || claveReintento.length === 0}
                    onClick={() => void reintentar(tarea.id)}
                  >
                    {enviando ? <Spinner size={14} /> : "Reintentar"}
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => {
                      setReintentando(null);
                      setClaveReintento("");
                    }}
                  >
                    Cancelar
                  </Button>
                  {avisoReintento && (
                    <p className="w-full text-xs text-rose-600">
                      {avisoReintento}
                    </p>
                  )}
                </div>
              )}

              <ul className="mt-3 divide-y divide-border/60 border-t border-border/60">
                {tarea.targets.map((destino) => (
                  <li key={destino.id} className="py-3">
                    <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
                      <span className="font-medium text-foreground">
                        {destino.pcName}
                      </span>
                      <span className="font-mono text-xs text-muted-foreground">
                        {destino.ipAddress}
                      </span>
                      <span
                        className={`inline-flex items-center gap-1.5 text-sm font-medium ${TONO_ESTADO[destino.status] ?? "text-muted-foreground"}`}
                      >
                        {EN_CURSO.has(destino.status) && (
                          <Spinner size={12} />
                        )}
                        {destino.status === "INSTALADO" && (
                          <CheckCircle2 className="size-3.5" />
                        )}
                        {destino.status === "ERROR" && (
                          <AlertTriangle className="size-3.5" />
                        )}
                        {ETIQUETA_ESTADO_DESTINO[destino.status] ??
                          destino.status}
                      </span>
                      <span className="text-xs text-muted-foreground">
                        {destino.method === "EMPUJE"
                          ? "Empujón SMB"
                          : destino.method === "AGENTE"
                            ? "Canal del agente"
                            : "Método por resolver"}
                        {destino.attempts > 0
                          ? ` · intento ${destino.attempts}`
                          : ""}
                      </span>
                      {destino.checks && destino.checks.length > 0 && (
                        <button
                          type="button"
                          onClick={() => alternarChecks(destino.id)}
                          className="smallcaps ml-auto inline-flex items-center gap-1 text-muted-foreground transition-colors hover:text-foreground"
                        >
                          {expandida.has(destino.id) ? (
                            <ChevronDown className="size-3.5" />
                          ) : (
                            <ChevronRight className="size-3.5" />
                          )}
                          Requisitos
                        </button>
                      )}
                    </div>
                    {destino.message && (
                      <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                        {destino.message}
                      </p>
                    )}
                    {destino.checks && expandida.has(destino.id) && (
                      <div className="mt-3 max-w-3xl">
                        <EmpujeChecklist
                          checks={destino.checks}
                          comprobando={destino.status === "COMPROBANDO"}
                        />
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            </section>
          );
        })}
      </div>
    </div>
  );
}
