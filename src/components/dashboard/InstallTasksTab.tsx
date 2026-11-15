"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Spinner } from "@/components/ui/spinner";
import { getCsrfTokenFromDocument } from "@/lib/utils";
import { useLiveData } from "@/components/providers/LiveDataProvider";
import {
  EmpujeChecklist,
  type RequisitoEmpujeVista,
} from "@/components/dashboard/EmpujeChecklist";
import {
  ETIQUETA_ESTADO_DESTINO,
  credencialesCompletas,
} from "@/lib/installTasks";
import { formatDateTime } from "@/components/dashboard/types";
import {
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  ListTodo,
  OctagonX,
  RotateCcw,
  Trash2,
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

/** Una orden de actualización tal como la sirve la lista global. */
interface OrdenVista {
  id: string;
  pcName: string;
  tipo: string;
  estado: string;
  etiquetaEstado: string;
  viva: boolean;
  detalle: string | null;
  versionObjetivo: string | null;
  intentos: number;
  creadaEn: string;
  terminadaEn: string | null;
}

const TONO_ESTADO_ORDEN: Record<string, string> = {
  HECHA: "text-emerald-600",
  ERROR: "text-rose-600",
  EN_CURSO: "text-[var(--acero)]",
  ENTREGADA: "text-amber-600",
  ESPERA: "text-muted-foreground",
  CANCELADA: "text-muted-foreground",
};

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
  // Las órdenes de actualización del canal del agente: viven en
  // otro sistema que las tareas de instalación, pero esta es su
  // pestaña — aquí se ven con su estado y su detalle de error.
  const [ordenes, setOrdenes] = useState<OrdenVista[] | null>(null);
  const [cancelandoId, setCancelandoId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [expandida, setExpandida] = useState<ReadonlySet<string>>(new Set());
  const [reintentando, setReintentando] = useState<string | null>(null);
  const [claveReintento, setClaveReintento] = useState("");
  // Credencial propia por destino al reintentar (clave del
  // registro: el id del destino), para los equipos con la
  // suya: cada PC tiene su usuario y su contraseña.
  const [ajustesReintento, setAjustesReintento] = useState<
    Record<string, { usuario: string; clave: string }>
  >({});
  const [enviando, setEnviando] = useState(false);
  const [avisoReintento, setAvisoReintento] = useState<string | null>(null);
  // Borrado de tareas: «borradoObjetivo» guarda el id de la
  // tarea que el diálogo de confirmación propone borrar (o
  // "todas" para la limpieza de terminadas, que alcanza
  // también a las órdenes del agente); el servidor es quien
  // decide si algo se puede borrar (lo que está en curso,
  // jamás).
  const [borradoObjetivo, setBorradoObjetivo] = useState<string | null>(
    null,
  );
  const [borrando, setBorrando] = useState(false);
  const [avisoBorrado, setAvisoBorrado] = useState<string | null>(null);

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
    // Las órdenes de actualización van por su propia ruta y su
    // propio fallo no debe tapar la lista de tareas: si no
    // cargan, la sección simplemente no se actualiza esta vez.
    try {
      const res = await fetch("/api/agent/comandos", {
        credentials: "include",
      });
      const datos = await res.json().catch(() => null);
      if (res.ok && datos?.ok) {
        setOrdenes(datos.comandos as OrdenVista[]);
      }
    } catch {
      // Sin órdenes esta vez; la siguiente recarga lo reintenta.
    }
  }, []);

  // Cancelar una orden viva (actualización o desinstalación):
  // el panel la marca CANCELADA y el agente la abandona en su
  // siguiente punto de control; si aún no la había empezado, no
  // llega a ejecutarla. Una desinstalación cancelada devuelve
  // el equipo a la lista de Equipos.
  const cancelarOrden = useCallback(
    async (orden: OrdenVista) => {
      // Como el resto de acciones de esta vista, la llamada
      // lleva la cabecera con el token de seguridad: sin ella,
      // el panel responde «No autorizado» aunque la sesión sea
      // la del administrador (así nació este botón, y por eso
      // detener una orden fallaba siempre con ese mensaje).
      const csrfToken = getCsrfTokenFromDocument();
      if (!csrfToken) {
        setError(
          "Sesión sin token de seguridad. Inicia sesión nuevamente.",
        );
        return;
      }
      try {
        setCancelandoId(orden.id);
        const res = await fetch(
          `/api/agent/comandos/${orden.id}/cancelar`,
          {
            method: "POST",
            credentials: "include",
            headers: { "x-csrf-token": csrfToken },
          },
        );
        const datos = await res.json().catch(() => null);
        if (!res.ok || !datos?.ok) {
          setError(datos?.error ?? "No se pudo cancelar la orden.");
          return;
        }
        await load();
      } catch {
        setError("No se pudo contactar con el panel.");
      } finally {
        setCancelandoId(null);
      }
    },
    [load],
  );

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

  const borrar = async (objetivo: string) => {
    const csrfToken = getCsrfTokenFromDocument();
    if (!csrfToken) {
      setAvisoBorrado(
        "Sesión sin token de seguridad. Inicia sesión nuevamente.",
      );
      return;
    }
    try {
      setBorrando(true);
      setAvisoBorrado(null);
      const esLimpieza = objetivo === "todas";
      const res = await fetch(
        esLimpieza ? "/api/install-tasks" : `/api/install-tasks/${objetivo}`,
        {
          method: "DELETE",
          headers: { "x-csrf-token": csrfToken },
          credentials: "include",
        },
      );
      const datos = await res.json().catch(() => null);
      if (!res.ok || !datos?.ok) {
        setAvisoBorrado(datos?.error || "No se pudo borrar la tarea.");
        return;
      }
      if (esLimpieza) {
        // La limpieza alcanza también a las órdenes del agente
        // ya terminadas (actualizaciones y desinstalaciones):
        // mismo botón y misma confirmación.
        const resOrdenes = await fetch("/api/agent/comandos", {
          method: "DELETE",
          headers: { "x-csrf-token": csrfToken },
          credentials: "include",
        });
        const datosOrdenes = await resOrdenes.json().catch(() => null);
        if (!resOrdenes.ok || !datosOrdenes?.ok) {
          setAvisoBorrado(
            datosOrdenes?.error ||
              "Las tareas se limpiaron, pero las órdenes terminadas no se pudieron borrar.",
          );
          void load();
          return;
        }
      }
      setBorradoObjetivo(null);
      void load();
    } catch {
      setAvisoBorrado("No se pudo contactar con el panel.");
    } finally {
      setBorrando(false);
    }
  };

  // ¿Puede lanzarse el reintento de esta tarea? Cada destino
  // a reintentar tiene que resolver a usuario y contraseña
  // entre la suya y la de reserva (el usuario de la tarea y
  // la clave escrita arriba): la misma regla pura que al
  // crear la tarea y que el servidor vuelve a comprobar.
  const coberturaReintento = (tarea: TareaVista) =>
    credencialesCompletas(
      { usuario: tarea.username, clave: claveReintento },
      tarea.targets
        .filter((d) => d.status === "ERROR" || d.status === "INTERRUMPIDO")
        .map((d) => ajustesReintento[d.id]),
    );

  const reintentar = async (tarea: TareaVista) => {
    const csrfToken = getCsrfTokenFromDocument();
    if (!csrfToken) {
      setAvisoReintento("Sesión sin token de seguridad. Inicia sesión nuevamente.");
      return;
    }
    // Las credenciales propias escritas para destinos que se
    // van a reintentar (los demás van con la de reserva).
    const credenciales = tarea.targets
      .filter((d) => d.status === "ERROR" || d.status === "INTERRUMPIDO")
      .map((d) => {
        const propia = ajustesReintento[d.id];
        if (!propia?.clave) return null;
        return {
          pcName: d.pcName,
          ip: d.ipAddress,
          ...(propia.usuario.trim()
            ? { usuario: propia.usuario.trim() }
            : {}),
          clave: propia.clave,
        };
      })
      .filter(Boolean);
    try {
      setEnviando(true);
      setAvisoReintento(null);
      const res = await fetch(`/api/install-tasks/${tarea.id}/reintentar`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-csrf-token": csrfToken,
        },
        credentials: "include",
        body: JSON.stringify({
          clave: claveReintento,
          ...(credenciales.length > 0 ? { credenciales } : {}),
        }),
      });
      const datos = await res.json().catch(() => null);
      if (!res.ok || !datos?.ok) {
        setAvisoReintento(datos?.error || "No se pudo reintentar la tarea.");
        return;
      }
      setClaveReintento("");
      setAjustesReintento({});
      setReintentando(null);
      void load();
    } catch {
      setAvisoReintento("No se pudo contactar con el panel.");
    } finally {
      setEnviando(false);
    }
  };

  // La tarea que el diálogo de borrado propone eliminar (la
  // limpieza de terminadas no es una tarea concreta).
  const tareaEnDialogo =
    borradoObjetivo !== null && borradoObjetivo !== "todas"
      ? (tareas ?? []).find((t) => t.id === borradoObjetivo)
      : undefined;

  return (
    <div className="animate-view-in space-y-10 p-6" data-tour="tasks-main">
      <div className="flex items-end justify-between gap-4">
        <div className="flex flex-1 flex-col">
          <p className="smallcaps text-acero">
            Instalación remota
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
        <div className="flex gap-2">
          {((tareas !== null &&
            tareas.some((t) => t.status !== "EN_CURSO")) ||
            (ordenes !== null && ordenes.some((o) => !o.viva))) && (
            <Button
              variant="outline"
              onClick={() => {
                setBorradoObjetivo("todas");
                setAvisoBorrado(null);
              }}
            >
              <Trash2 className="mr-1.5 size-3.5" />
              Limpiar terminadas
            </Button>
          )}
          {/* Sin botón de «Actualizar»: la lista se recarga
              sola con cada aviso `install:change` del socket
              (el contador no pasa por el interruptor de
              «Tiempo real»), al reconectar y cada 60 s. La
              recuperación tras un fallo vive en el aviso de
              error de abajo, con su «Reintentar». */}
        </div>
      </div>

      {error && (
        <Alert variant="destructive">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <AlertDescription>{error}</AlertDescription>
            <Button
              size="sm"
              variant="outline"
              onClick={() => void load()}
            >
              Reintentar
            </Button>
          </div>
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
                  {instalados}/{tarea.targets.length} instalados ·{" "}
                  {tarea.username
                    ? `cuenta ${tarea.username}`
                    : "cuenta propia en cada equipo"}
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
                {tarea.status !== "EN_CURSO" && (
                  <Button
                    variant="ghost"
                    size="sm"
                    className={
                      reintentables > 0 ? "" : "ml-auto"
                    }
                    onClick={() => {
                      setBorradoObjetivo(tarea.id);
                      setAvisoBorrado(null);
                    }}
                  >
                    <Trash2 className="mr-1.5 size-3.5" />
                    Eliminar
                  </Button>
                )}
              </div>

              {reintentando === tarea.id && (
                <div className="mt-3 flex flex-wrap items-center gap-3 border border-border/60 bg-background px-3 py-3">
                  <p className="text-sm text-muted-foreground">
                    Las claves no se guardaron: escribe la de cada
                    equipo en su fila. La de reserva solo hace falta
                    si algún equipo va con ella.
                  </p>
                  <Input
                    type="password"
                    value={claveReintento}
                    onChange={(e) => setClaveReintento(e.target.value)}
                    placeholder="Contraseña de reserva (opcional)"
                    className="w-64"
                    autoComplete="off"
                    aria-label="Contraseña de reserva para el reintento"
                  />
                  <Button
                    size="sm"
                    disabled={enviando || !coberturaReintento(tarea)}
                    onClick={() => void reintentar(tarea)}
                  >
                    {enviando ? <Spinner size={14} /> : "Reintentar"}
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => {
                      setReintentando(null);
                      setClaveReintento("");
                      setAjustesReintento({});
                    }}
                  >
                    Cancelar
                  </Button>
                  {tarea.targets.some(
                    (d) => d.status === "ERROR" || d.status === "INTERRUMPIDO",
                  ) && (
                    <div className="w-full space-y-2 border-t border-border/60 pt-3">
                      <p className="text-xs text-muted-foreground">
                        Cada equipo se reintenta con la suya: su
                        usuario y su contraseña. Los que dejes en
                        blanco van con la cuenta de reserva (el
                        usuario de la tarea y la clave de arriba).
                      </p>
                      {tarea.targets
                        .filter(
                          (d) =>
                            d.status === "ERROR" ||
                            d.status === "INTERRUMPIDO",
                        )
                        .map((d) => {
                          const ajuste = ajustesReintento[d.id] ?? {
                            usuario: "",
                            clave: "",
                          };
                          return (
                            <div
                              key={d.id}
                              className="flex flex-wrap items-center gap-2"
                            >
                              <span className="min-w-0">
                                <span className="block truncate text-sm font-medium text-foreground">
                                  {d.pcName}
                                </span>
                                <span className="block font-mono text-xs text-muted-foreground">
                                  {d.ipAddress}
                                </span>
                              </span>
                              <Input
                                value={ajuste.usuario}
                                onChange={(e) =>
                                  setAjustesReintento((prev) => ({
                                    ...prev,
                                    [d.id]: {
                                      ...ajuste,
                                      usuario: e.target.value,
                                    },
                                  }))
                                }
                                placeholder="Su usuario"
                                className="w-40"
                                autoComplete="off"
                                aria-label={`Usuario de ${d.pcName} para reintentar`}
                              />
                              <Input
                                type="password"
                                value={ajuste.clave}
                                onChange={(e) =>
                                  setAjustesReintento((prev) => ({
                                    ...prev,
                                    [d.id]: {
                                      ...ajuste,
                                      clave: e.target.value,
                                    },
                                  }))
                                }
                                placeholder="Su contraseña"
                                className="w-48"
                                autoComplete="off"
                                aria-label={`Contraseña de ${d.pcName} para reintentar`}
                              />
                            </div>
                          );
                        })}
                    </div>
                  )}
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

      {ordenes !== null && (
        <section className="space-y-4">
          <div className="flex flex-col">
            <p className="smallcaps text-acero">Canal del agente</p>
            <h3 className="font-display mt-2 text-[1.35rem] font-bold leading-none text-foreground">
              Órdenes del agente
            </h3>
            <p className="mt-2 max-w-xl text-sm text-muted-foreground">
              Las órdenes que el panel deja a los equipos —
              actualizaciones y desinstalaciones — y que cada
              agente recoge y ejecuta solo. Si una falla, aquí
              queda escrito el motivo que el propio agente
              informó.
            </p>
          </div>

          {ordenes.length === 0 && (
            <div className="flex items-start gap-3 border-t border-border pt-6 text-sm text-muted-foreground">
              <ListTodo className="mt-0.5 size-4 shrink-0 text-[var(--acero)]" />
              <p>
                Todavía no hay órdenes. Las de actualización se
                crean desde Equipos, con el botón Actualizar de
                cada equipo, o solas si la actualización
                automática está encendida; las de desinstalación,
                al borrar un equipo enrolado.
              </p>
            </div>
          )}

          <div className="space-y-8">
            {ordenes.map((orden) => (
              <article
                key={orden.id}
                className="border border-border/60 bg-muted/10 px-4 py-4"
              >
                <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
                  <p className="font-display text-lg font-bold text-foreground">
                    {orden.pcName}
                  </p>
                  <span
                    className={`inline-flex items-center gap-1.5 text-sm font-medium ${
                      TONO_ESTADO_ORDEN[orden.estado] ??
                      "text-muted-foreground"
                    }`}
                  >
                    {orden.viva && orden.estado === "EN_CURSO" && (
                      <Spinner size={12} />
                    )}
                    {orden.estado === "HECHA" && (
                      <CheckCircle2 className="size-3.5" />
                    )}
                    {orden.estado === "ERROR" && (
                      <AlertTriangle className="size-3.5" />
                    )}
                    {orden.etiquetaEstado}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {orden.tipo === "desinstalar"
                      ? "Desinstalación"
                      : orden.tipo === "cancelar-apagado"
                        ? "Cancelar apagado"
                        : orden.versionObjetivo
                          ? `Actualización a la v${orden.versionObjetivo}`
                          : "Actualización"}
                    {orden.intentos > 0
                      ? ` · intento ${orden.intentos}`
                      : ""}
                    {" · "}
                    {formatDateTime(orden.creadaEn)}
                    {orden.terminadaEn
                      ? ` → ${formatDateTime(orden.terminadaEn)}`
                      : ""}
                  </span>
                  {orden.viva && (
                    <Button
                      variant="outline"
                      size="sm"
                      className="ml-auto"
                      onClick={() => void cancelarOrden(orden)}
                      disabled={cancelandoId === orden.id}
                    >
                      {cancelandoId === orden.id ? (
                        <Spinner size={14} />
                      ) : (
                        <OctagonX className="mr-1.5 size-3.5" />
                      )}
                      Detener
                    </Button>
                  )}
                </div>
                {orden.detalle && (
                  <p
                    className={`mt-2 text-xs leading-relaxed ${
                      orden.estado === "ERROR"
                        ? "text-rose-600"
                        : "text-muted-foreground"
                    }`}
                  >
                    {orden.detalle}
                  </p>
                )}
              </article>
            ))}
          </div>
        </section>
      )}

      {/* Confirmación de borrado: un diálogo, no un cuadro en
          línea. Sirve para la limpieza de terminadas (tareas y
          órdenes del agente) y para eliminar una tarea suelta. */}
      <Dialog
        open={borradoObjetivo !== null}
        onOpenChange={(abierto) => {
          if (!abierto && !borrando) {
            setBorradoObjetivo(null);
            setAvisoBorrado(null);
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {borradoObjetivo === "todas"
                ? "Limpiar terminadas"
                : "Eliminar tarea"}
            </DialogTitle>
            <DialogDescription>
              {borradoObjetivo === "todas" ? (
                <>
                  Se borrarán todas las tareas de instalación ya
                  terminadas (completadas y con errores) con sus
                  destinos, y también las órdenes del agente ya
                  terminadas: actualizaciones y desinstalaciones
                  hechas, con error o canceladas hace más de 10
                  minutos. Lo que siga en curso se queda. No se
                  puede deshacer.
                </>
              ) : (
                <>
                  Se borrará esta tarea con el resultado de sus{" "}
                  {tareaEnDialogo?.targets.length ?? 0} destino
                  {(tareaEnDialogo?.targets.length ?? 0) === 1
                    ? ""
                    : "s"}
                  . No se puede deshacer.
                </>
              )}
            </DialogDescription>
          </DialogHeader>
          {avisoBorrado && (
            <p className="text-sm text-rose-600">{avisoBorrado}</p>
          )}
          <DialogFooter>
            <Button
              variant="ghost"
              onClick={() => {
                setBorradoObjetivo(null);
                setAvisoBorrado(null);
              }}
              disabled={borrando}
            >
              Cancelar
            </Button>
            <Button
              variant="destructive"
              onClick={() => {
                if (borradoObjetivo) void borrar(borradoObjetivo);
              }}
              disabled={borrando}
            >
              {borrando ? (
                <Spinner size={14} />
              ) : borradoObjetivo === "todas" ? (
                "Borrar terminadas"
              ) : (
                "Eliminar"
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
