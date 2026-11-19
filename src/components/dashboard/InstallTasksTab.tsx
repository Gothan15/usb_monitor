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
import { HttpError } from "@/lib/http";
import * as tareasApi from "@/lib/api/tareas";
import type { OrdenVista, TareaVista } from "@/lib/api/tareas";
import { useLiveData } from "@/components/providers/LiveDataProvider";
import {
  EmpujeChecklist,
  type RequisitoEmpujeVista,
} from "@/components/dashboard/EmpujeChecklist";
import {
  ETIQUETA_ESTADO_DESTINO,
  ETIQUETA_ESTADO_TAREA,
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
  CANCELADO: "text-muted-foreground",
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
  // Cancelación de una tarea EN CURSO: «cancelacionObjetivo»
  // guarda el id de la tarea que el diálogo de confirmación
  // propone detener; la petición en vuelo se marca con el
  // mismo «cancelandoId» de las órdenes (los ids no se
  // cruzan), así el botón enseña el spinner igual que el de
  // «Detener» de una orden viva.
  const [cancelacionObjetivo, setCancelacionObjetivo] = useState<
    string | null
  >(null);
  const [avisoCancelacion, setAvisoCancelacion] = useState<string | null>(
    null,
  );

  const load = useCallback(async () => {
    try {
      setError(null);
      setTareas(await tareasApi.listar());
    } catch (error) {
      setError(
        error instanceof HttpError
          ? error.message || "No se pudieron cargar las tareas."
          : "No se pudo contactar con el panel.",
      );
    }
    // Las órdenes del agente van por su propio servicio y su
    // fallo no debe tapar la lista de tareas: si no cargan, la
    // sección simplemente no se actualiza esta vez.
    const ordenes = await tareasApi.listarOrdenes();
    if (ordenes) setOrdenes(ordenes);
  }, []);

  // Cancelar una orden viva: el panel la marca CANCELADA y
  // el agente la abandona en su siguiente punto de control;
  // si aún no la había empezado, no llega a ejecutarla.
  const cancelarOrden = useCallback(
    async (orden: OrdenVista) => {
      // Como el resto de acciones de esta vista, la llamada
      // lleva la cabecera con el token de seguridad: sin ella,
      // el panel responde «No autorizado» aunque la sesión sea
      // la del administrador (así nació este botón, y por eso
      // detener una orden fallaba siempre con ese mensaje).
      try {
        setCancelandoId(orden.id);
        await tareasApi.cancelarOrden(orden.id);
        await load();
      } catch (error) {
        setError(
          error instanceof HttpError
            ? error.message || "No se pudo cancelar la orden."
            : "No se pudo contactar con el panel.",
        );
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
    try {
      setBorrando(true);
      setAvisoBorrado(null);
      const esLimpieza = objetivo === "todas";
      if (esLimpieza) {
        await tareasApi.limpiarTerminadas();
      } else {
        await tareasApi.eliminar(objetivo);
      }
      if (esLimpieza) {
        // La limpieza alcanza también a las órdenes del agente
        // ya terminadas: mismo botón y misma confirmación.
        try {
          await tareasApi.limpiarOrdenesTerminadas();
        } catch (errorOrdenes) {
          setAvisoBorrado(
            errorOrdenes instanceof HttpError && errorOrdenes.message
              ? errorOrdenes.message
              : "Las tareas se limpiaron, pero las órdenes terminadas no se pudieron borrar.",
          );
          void load();
          return;
        }
      }
      setBorradoObjetivo(null);
      void load();
    } catch (error) {
      setAvisoBorrado(
        error instanceof HttpError
          ? error.message || "No se pudo borrar la tarea."
          : "No se pudo contactar con el panel.",
      );
    } finally {
      setBorrando(false);
    }
  };

  // ¿Puede lanzarse el reintento de esta tarea? Cada destino
  // a reintentar tiene que traer SU credencial completa
  // (usuario y contraseña en su fila): ya no hay cuenta de
  // reserva que lo cubra. La misma regla pura que al crear
  // la tarea y que el servidor vuelve a comprobar.
  const coberturaReintento = (tarea: TareaVista) =>
    credencialesCompletas(
      { usuario: "", clave: "" },
      tarea.targets
        .filter((d) => d.status === "ERROR" || d.status === "INTERRUMPIDO")
        .map((d) => ajustesReintento[d.id]),
    );

  const reintentar = async (tarea: TareaVista) => {
    // La credencial propia de cada destino a reintentar: es
    // lo único que viaja (ya no hay clave de reserva).
    const credenciales = tarea.targets
      .filter((d) => d.status === "ERROR" || d.status === "INTERRUMPIDO")
      .map((d) => {
        const propia = ajustesReintento[d.id];
        return {
          pcName: d.pcName,
          ip: d.ipAddress,
          usuario: (propia?.usuario ?? "").trim(),
          clave: propia?.clave ?? "",
        };
      });
    try {
      setEnviando(true);
      setAvisoReintento(null);
      await tareasApi.reintentar(tarea.id, { credenciales });
      setAjustesReintento({});
      setReintentando(null);
      void load();
    } catch (error) {
      setAvisoReintento(
        error instanceof HttpError
          ? error.message || "No se pudo reintentar la tarea."
          : "No se pudo contactar con el panel.",
      );
    } finally {
      setEnviando(false);
    }
  };

  // Detener una tarea de instalación EN CURSO: el panel la
  // marca CANCELADA con sus destinos no finales en CANCELADO
  // y el ejecutor se para en su siguiente punto de control.
  // Si un equipo ya tenía el agente instalado y esperaba
  // señal, su código de enrolamiento queda anulado (no se
  // enrolará solo tras cancelar): el diálogo lo avisa antes.
  const cancelarTarea = async (tareaId: string) => {
    try {
      setCancelandoId(tareaId);
      setAvisoCancelacion(null);
      await tareasApi.cancelar(tareaId);
      setCancelacionObjetivo(null);
      void load();
    } catch (error) {
      setAvisoCancelacion(
        error instanceof HttpError
          ? error.message || "No se pudo detener la tarea."
          : "No se pudo contactar con el panel.",
      );
    } finally {
      setCancelandoId(null);
    }
  };

  // La tarea que el diálogo de borrado propone eliminar (la
  // limpieza de terminadas no es una tarea concreta).
  const tareaEnDialogo =
    borradoObjetivo !== null && borradoObjetivo !== "todas"
      ? (tareas ?? []).find((t) => t.id === borradoObjetivo)
      : undefined;

  // La tarea que el diálogo de cancelación propone detener.
  const tareaEnCancelacion =
    cancelacionObjetivo !== null
      ? (tareas ?? []).find((t) => t.id === cancelacionObjetivo)
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
                  className={`inline-flex items-center gap-1.5 text-sm font-medium ${
                    tarea.status === "EN_CURSO"
                      ? "text-[var(--acero)]"
                      : tarea.status === "COMPLETADA"
                        ? "text-emerald-600"
                        : tarea.status === "CANCELADA"
                          ? "text-muted-foreground"
                          : "text-rose-600"
                  }`}
                >
                  {/* Igual que las órdenes vivas: la tarea en
                      curso enseña el spinner girando junto a
                      su etiqueta de estado. */}
                  {tarea.status === "EN_CURSO" && <Spinner size={12} />}
                  {ETIQUETA_ESTADO_TAREA[tarea.status] ?? tarea.status}
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
                {/* Detener una tarea en curso: EL MISMO botón
                    que el «Detener» de las órdenes vivas de
                    abajo (mismo Button, mismo icono, mismo
                    spinner en vuelo), para que la pestaña
                    hable un solo idioma. Abre el diálogo de
                    confirmación de la cancelación. */}
                {tarea.status === "EN_CURSO" && (
                  <Button
                    variant="outline"
                    size="sm"
                    className="ml-auto"
                    onClick={() => {
                      setCancelacionObjetivo(tarea.id);
                      setAvisoCancelacion(null);
                    }}
                    disabled={cancelandoId === tarea.id}
                  >
                    {cancelandoId === tarea.id ? (
                      <Spinner size={14} />
                    ) : (
                      <OctagonX className="mr-1.5 size-3.5" />
                    )}
                    Detener
                  </Button>
                )}
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
                    equipo en su fila.
                  </p>
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
                        usuario y su contraseña, escritos en su
                        fila.
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
              actualizaciones, reinicios y cancelaciones de
              apagado — y que cada agente recoge y ejecuta
              solo. Si una falla, aquí queda escrito el motivo
              que el propio agente informó.
            </p>
          </div>

          {ordenes.length === 0 && (
            <div className="flex items-start gap-3 border-t border-border pt-6 text-sm text-muted-foreground">
              <ListTodo className="mt-0.5 size-4 shrink-0 text-[var(--acero)]" />
              <p>
                Todavía no hay órdenes. Las de actualización se
                crean desde Equipos, con el botón Actualizar de
                cada equipo, o solas si la actualización
                automática está encendida; las de reinicio,
                también desde Equipos, y las de cancelar un
                apagado, desde el aviso de apagado en curso de
                cada equipo.
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
                    {orden.tipo === "cancelar-apagado"
                      ? "Cancelar apagado"
                      : orden.tipo === "reiniciar"
                        ? "Reinicio del servicio"
                        : orden.tipo === "actualizar"
                          ? orden.versionObjetivo
                            ? `Actualización a la v${orden.versionObjetivo}`
                            : "Actualización"
                          : "Orden del agente"}
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

      {/* Confirmación de cancelación: detener una tarea en
          curso no se deshace, y tiene una consecuencia que hay
          que leer antes — el código anulado de los equipos que
          ya tenían el agente instalado esperando señal. */}
      <Dialog
        open={cancelacionObjetivo !== null}
        onOpenChange={(abierto) => {
          if (!abierto && cancelandoId !== cancelacionObjetivo) {
            setCancelacionObjetivo(null);
            setAvisoCancelacion(null);
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Detener tarea de instalación</DialogTitle>
            <DialogDescription>
              Se detiene la instalación remota de esta tarea
              {tareaEnCancelacion
                ? ` (${tareaEnCancelacion.targets.length} destino${
                    tareaEnCancelacion.targets.length === 1 ? "" : "s"
                  })`
                : ""}
              . Los equipos que no habían empezado no se
              instalan; el que esté a mitad se detiene en su
              siguiente punto de control (una copia ya en curso
              no se parte a la mitad). Si un equipo ya tiene el
              agente instalado y estaba esperando su primera
              señal, su código de enrolamiento queda ANULADO:
              no se enrolará solo. Para enrolarlo luego, genera
              un código en Equipos → «Credencial del equipo» y
              escríbelo en el asistente de esa PC. No se puede
              deshacer.
            </DialogDescription>
          </DialogHeader>
          {avisoCancelacion && (
            <p className="text-sm text-rose-600">{avisoCancelacion}</p>
          )}
          <DialogFooter>
            <Button
              variant="ghost"
              onClick={() => {
                setCancelacionObjetivo(null);
                setAvisoCancelacion(null);
              }}
              disabled={cancelandoId === cancelacionObjetivo}
            >
              Volver
            </Button>
            <Button
              variant="destructive"
              onClick={() => {
                if (cancelacionObjetivo) {
                  void cancelarTarea(cancelacionObjetivo);
                }
              }}
              disabled={cancelandoId === cancelacionObjetivo}
            >
              {cancelandoId === cancelacionObjetivo ? (
                <Spinner size={14} />
              ) : (
                "Detener tarea"
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

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
                  terminadas: las hechas, con error o canceladas
                  hace más de 10 minutos. Lo que siga en curso
                  se queda. No se puede deshacer.
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
