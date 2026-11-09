"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLiveData } from "@/components/providers/LiveDataProvider";
import { Camera } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

/**
 * Vista «Desbloqueos» (fase 5): bloqueos en curso, historial de
 * intentos del flujo 2FA y de la emergencia sin red, y equipos en
 * silencio (método 3). Solo lectura: el admin mira, no interviene.
 */

interface Pending {
  id: string;
  pcName: string;
  driveLetter: string | null;
  serialNumber: string | null;
  deviceLabel: string | null;
  whitelisted: boolean;
  createdAt: string;
  unlockedAt: string | null;
  unlockedBy: { username: string; role: string } | null;
  hasEvidence?: boolean;
}

interface EvidenceData {
  id: string;
  capturedAt: string;
  foregroundProcess: string | null;
  foregroundTitle: string | null;
  processes: { proceso: string; titulo?: string }[];
  browserTabs: { navegador: string; titulo: string; url?: string }[];
  tabsComplete: boolean;
  nota: string | null;
  hasImage: boolean;
}

interface Attempt {
  id: string;
  createdAt: string;
  pcName: string;
  usernameTried: string;
  serialNumber: string | null;
  result: string;
  origin: string;
  adminUnlock: boolean;
  user: { username: string; role: string } | null;
}

interface SilenceComputer {
  id: string;
  name: string;
  ipAddress: string;
  lastSeen: string | null;
  silent: boolean;
  silentSince: string | null;
}

interface UnlocksData {
  blockedNow: Pending[];
  activeUnlocked: Pending[];
  attempts: Attempt[];
  silence: {
    thresholdMinutes: number;
    serverLikelyDown: boolean;
    computers: SilenceComputer[];
  };
}

const RESULT_LABELS: Record<string, string> = {
  SUCCESS: "Desbloqueado",
  BAD_PASSWORD: "Contraseña incorrecta",
  NOT_OWNER: "No es el dueño",
  NOT_WHITELISTED: "Fuera de la lista blanca",
  NO_PENDING: "Sin bloqueo activo",
  LOCKED: "Cuenta bloqueada",
  DISABLED: "Función desactivada",
  OFFLINE_OK: "Desbloqueo sin red",
  OFFLINE_FAIL: "Fallo sin red",
};

function fmt(dt: string | null): string {
  if (!dt) return "—";
  return new Date(dt).toLocaleString("es", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function timeHHMM(dt: string | null): string {
  if (!dt) return "nunca";
  return new Date(dt).toLocaleTimeString("es", {
    hour: "2-digit",
    minute: "2-digit",
  });
}

function RegistroHeader({
  numeral,
  title,
  count,
}: Readonly<{ numeral: string; title: string; count?: number }>) {
  return (
    <div className="flex items-baseline gap-3.5">
      <span className="font-display text-xl font-bold italic text-acero">
        {numeral}
      </span>
      <h3 className="font-display text-xl font-bold text-foreground">
        {title}
      </h3>
      {count !== undefined && (
        <span className="smallcaps text-muted-foreground tabular-nums">
          {count}
        </span>
      )}
    </div>
  );
}

const thClass = "smallcaps px-4 py-2.5 text-left font-semibold text-muted-foreground";
const tdClass = "px-4 py-2.5";

export function UnlocksTab() {
  const [data, setData] = useState<UnlocksData | null>(null);
  const [ultimaVez, setUltimaVez] = useState<Date | null>(null);
  const [resultFilter, setResultFilter] = useState("");
  const [pcFilter, setPcFilter] = useState("");
  const [evidenciaDe, setEvidenciaDe] = useState<Pending | null>(null);
  const [evidencia, setEvidencia] = useState<EvidenceData | null>(null);

  // La evidencia se pide al abrir el diálogo: los metadatos por un
  // lado y la captura como imagen aparte, para no moverla en JSON.
  useEffect(() => {
    if (!evidenciaDe) {
      setEvidencia(null);
      return;
    }
    let viva = true;
    fetch(`/api/admin/evidence/${evidenciaDe.id}`, { credentials: "include" })
      .then((res) => (res.ok ? res.json() : null))
      .then((json) => {
        if (viva) setEvidencia(json?.evidence ?? null);
      })
      .catch(() => {
        if (viva) setEvidencia(null);
      });
    return () => {
      viva = false;
    };
  }, [evidenciaDe]);

  // Recarga de la vista sin botón propio: la disparan el
  // empuje por socket (el contador de desbloqueos sube aunque
  // «Tiempo real» esté en pausa), la reconexión del socket y
  // la red de seguridad de 60 s de abajo. Un «Actualizar»
  // manual no refrescaría nada que no llegue solo.
  const load = useCallback(async () => {
    try {
      const params = new URLSearchParams();
      if (resultFilter) params.set("result", resultFilter);
      if (pcFilter) params.set("pcName", pcFilter);
      const res = await fetch(`/api/admin/unlocks?${params.toString()}`, {
        credentials: "include",
      });
      if (res.ok) {
        setData(await res.json());
        setUltimaVez(new Date());
      }
    } catch {
      // Sin estado de error propio: se conservan los datos
      // anteriores y la red de 60 s reintenta sola.
    }
  }, [resultFilter, pcFilter]);

  useEffect(() => {
    // Diferida a una microtarea: los setState de la carga ocurren
    // en un contexto asíncrono, no en el cuerpo síncrono del efecto.
    queueMicrotask(() => {
      void load();
    });
    // Red de seguridad, no el mecanismo: el silencio de un
    // equipo se mide con el reloj y puede vencer sin que llegue
    // ningún evento. El refresco normal lo manda el empuje de
    // abajo.
    const id = setInterval(load, 60_000);
    return () => clearInterval(id);
  }, [load]);

  // Empuje por socket: cada evento USB y cada cambio de
  // desbloqueo (bloqueo nuevo, intento, cierre, entrega al
  // agente) recarga la lista, agrupando ráfagas a 600 ms.
  const { liveEventCount, unlockVersion, connectionStatus } = useLiveData();
  const senalRef = useRef({ eventos: -1, desbloqueos: -1 });
  useEffect(() => {
    const previa = senalRef.current;
    const cambio =
      (previa.eventos !== -1 && previa.eventos !== liveEventCount) ||
      (previa.desbloqueos !== -1 &&
        previa.desbloqueos !== unlockVersion);
    senalRef.current = { eventos: liveEventCount, desbloqueos: unlockVersion };
    if (!cambio) return;
    const id = setTimeout(() => {
      void load();
    }, 600);
    return () => clearTimeout(id);
  }, [liveEventCount, unlockVersion, load]);

  // Al reconectar el socket puede haberse perdido algún aviso:
  // una recarga de reconciliación y seguimos.
  const conectadoRef = useRef(false);
  useEffect(() => {
    if (connectionStatus !== "connected") return;
    if (conectadoRef.current) {
      void load();
    }
    conectadoRef.current = true;
  }, [connectionStatus, load]);

  const silentComputers = useMemo(
    () => data?.silence.computers.filter((c) => c.silent) ?? [],
    [data],
  );

  return (
    <div data-tour="unlocks-main" className="animate-view-in space-y-12 p-6">
      {/* ── Cabecera de la auditoría ── */}
      <div className="flex items-end justify-between gap-4">
        <div className="flex flex-1 flex-col">
          <p className="smallcaps text-acero">
            Auditoría 2FA · Solo lectura
          </p>
          <h2 className="font-display mt-2 text-[1.7rem] font-bold leading-none text-foreground">
            Desbloqueos y bloqueos
          </h2>
        </div>
        {ultimaVez && (
          <span className="text-[11px] text-muted-foreground">
            Actualizado a las{" "}
            {ultimaVez.toLocaleTimeString("es", {
              hour: "2-digit",
              minute: "2-digit",
              second: "2-digit",
            })}
          </span>
        )}
      </div>

      {data?.silence.serverLikelyDown && (
        <div className="frame-double px-5 py-4">
          <p className="smallcaps text-acero">Aviso</p>
          <p className="mt-2 text-sm leading-relaxed text-foreground">
            Ningún equipo está dando señales. Lo probable es que el servidor
            haya estado caído, no que todos los agentes fallaran a la vez:
            los silencios de abajo no cuentan como manipulación.
          </p>
        </div>
      )}

      {!data?.silence.serverLikelyDown && silentComputers.length > 0 && (
        <section>
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h3 className="smallcaps text-destructive">
              Equipos sin agente · {silentComputers.length}
            </h3>
            <span className="smallcaps text-muted-foreground">
              Umbral: {data?.silence.thresholdMinutes} min
            </span>
          </div>
          <ul className="mt-3 divide-y divide-border border-y border-border">
            {silentComputers.map((c) => (
              <li
                key={c.id}
                className="flex items-center justify-between py-3 text-sm"
              >
                <span className="font-medium text-destructive">
                  {c.name}
                  <span className="ml-2 font-normal text-muted-foreground">
                    {c.ipAddress}
                  </span>
                </span>
                <span className="text-xs tabular-nums">
                  sin agente desde las {timeHHMM(c.silentSince)}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* ── Registro I · Bloqueados ahora ── */}
      <section>
        <RegistroHeader
          numeral="I"
          title="Bloqueados ahora"
          count={data?.blockedNow.length ?? 0}
        />
        <div className="mt-4 border-t border-border">
          {data && data.blockedNow.length === 0 ? (
            <p className="py-5 text-sm text-muted-foreground">
              Ningún dispositivo está esperando contraseña.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border">
                    <th className={thClass}>Equipo</th>
                    <th className={thClass}>Unidad</th>
                    <th className={thClass}>Dispositivo</th>
                    <th className={thClass}>Serial</th>
                    <th className={thClass}>Lista blanca</th>
                    <th className={thClass}>Desde</th>
                    <th className={thClass}>Evidencia</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {data?.blockedNow.map((p) => (
                    <tr key={p.id}>
                      <td className={`${tdClass} font-medium`}>{p.pcName}</td>
                      <td className={`${tdClass} font-mono`}>
                        {p.driveLetter ?? p.deviceLabel ?? "Sin unidad"}
                      </td>
                      <td className={tdClass}>{p.deviceLabel || "—"}</td>
                      <td className={`${tdClass} font-mono text-xs`}>
                        {p.serialNumber || "—"}
                      </td>
                      <td className={tdClass}>
                        {p.whitelisted ? "Conocido" : "Desconocido"}
                      </td>
                      <td className={`${tdClass} tabular-nums`}>
                        {fmt(p.createdAt)}
                      </td>
                      <td className={tdClass}>
                        {p.hasEvidence ? (
                          <button
                            onClick={() => setEvidenciaDe(p)}
                            className="inline-flex items-center gap-1.5 text-xs font-semibold uppercase tracking-[0.14em] text-primary underline-offset-4 transition-colors hover:text-foreground hover:underline"
                          >
                            <Camera className="size-4" />
                            Evidencia
                          </button>
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </section>

      {/* ── Registro II · En uso tras desbloqueo ── */}
      <section>
        <RegistroHeader
          numeral="II"
          title="En uso tras desbloqueo"
          count={data?.activeUnlocked.length ?? 0}
        />
        <div className="mt-4 border-t border-border">
          {data && data.activeUnlocked.length === 0 ? (
            <p className="py-5 text-sm text-muted-foreground">
              Ningún dispositivo desbloqueado sigue conectado.
            </p>
          ) : (
            <ul className="divide-y divide-border">
              {data?.activeUnlocked.map((p) => (
                <li
                  key={p.id}
                  className="flex items-center justify-between py-3 text-sm"
                >
                  <span>
                    <span className="font-medium">{p.pcName}</span>
                    <span className="ml-2 font-mono text-xs">
                      {p.driveLetter ?? p.deviceLabel ?? "Sin unidad"}
                    </span>
                    <span className="ml-2 text-muted-foreground">
                      {p.deviceLabel || ""}
                    </span>
                  </span>
                  <span className="flex items-center gap-4">
                    {p.hasEvidence && (
                      <button
                        onClick={() => setEvidenciaDe(p)}
                        className="inline-flex items-center gap-1.5 text-xs font-semibold uppercase tracking-[0.14em] text-primary underline-offset-4 transition-colors hover:text-foreground hover:underline"
                      >
                        <Camera className="size-4" />
                        Evidencia
                      </button>
                    )}
                    <span className="text-xs text-muted-foreground tabular-nums">
                      desbloqueado por {p.unlockedBy?.username ?? "—"} ·{" "}
                      {fmt(p.unlockedAt)}
                    </span>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>

      {/* ── Registro III · Historial de intentos ── */}
      <section className="flex flex-1 flex-col">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <RegistroHeader
            numeral="III"
            title="Historial de intentos"
            count={data?.attempts.length}
          />
          <div className="flex flex-wrap items-center gap-5">
            <label className="flex flex-col gap-1.5">
              <span className="smallcaps text-muted-foreground">
                Resultado
              </span>
              <select
                value={resultFilter}
                onChange={(e) => setResultFilter(e.target.value)}
                className="border-b border-input bg-transparent py-1.5 text-sm outline-none transition-colors focus:border-ring"
              >
                <option value="">Todos los resultados</option>
                {Object.entries(RESULT_LABELS).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1.5">
              <span className="smallcaps text-muted-foreground">Equipo</span>
              <input
                value={pcFilter}
                onChange={(e) => setPcFilter(e.target.value)}
                placeholder="Filtrar por equipo…"
                className="border-b border-input bg-transparent py-1.5 text-sm outline-none transition-colors placeholder:text-muted-foreground/60 focus:border-ring"
              />
            </label>
          </div>
        </div>
        <div className="mt-4 overflow-x-auto border-t border-border">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border">
                <th className={thClass}>Cuándo</th>
                <th className={thClass}>Equipo</th>
                <th className={thClass}>Usuario intentado</th>
                <th className={thClass}>Serial</th>
                <th className={thClass}>Resultado</th>
                <th className={thClass}>Origen</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {data?.attempts.map((a) => (
                <tr key={a.id}>
                  <td className={`${tdClass} whitespace-nowrap tabular-nums`}>
                    {fmt(a.createdAt)}
                  </td>
                  <td className={`${tdClass} font-medium`}>{a.pcName}</td>
                  <td className={tdClass}>
                    {a.usernameTried}
                    {a.adminUnlock && (
                      <span className="smallcaps ml-2.5 text-warning">
                        con cuenta admin
                      </span>
                    )}
                  </td>
                  <td className={`${tdClass} font-mono text-xs`}>
                    {a.serialNumber || "—"}
                  </td>
                  <td className={tdClass}>
                    <span
                      className={
                        a.result === "SUCCESS" || a.result === "OFFLINE_OK"
                          ? "text-success"
                          : a.result === "NOT_WHITELISTED" ||
                              a.result === "NOT_OWNER"
                            ? "text-warning"
                            : "text-destructive"
                      }
                    >
                      {RESULT_LABELS[a.result] ?? a.result}
                    </span>
                  </td>
                  <td className={`${tdClass} text-xs`}>
                    {a.origin === "OFFLINE_LOCAL" ? "Sin red (local)" : "En línea"}
                  </td>
                </tr>
              ))}
              {data && data.attempts.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-4 py-5 text-muted-foreground">
                    Sin intentos registrados con esos filtros.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      {/* ── Diálogo de evidencia: la foto del momento del bloqueo ── */}
      <Dialog
        open={evidenciaDe !== null}
        onOpenChange={(abierto) => {
          if (!abierto) setEvidenciaDe(null);
        }}
      >
        <DialogContent className="max-h-[88vh] overflow-y-auto sm:max-w-3xl">
          <DialogHeader>
            <DialogTitle className="font-display">
              Evidencia del bloqueo
            </DialogTitle>
            <DialogDescription>
              {evidenciaDe
                ? `${evidenciaDe.pcName} · ${evidenciaDe.deviceLabel || evidenciaDe.serialNumber || "Dispositivo"} · capturada el ${evidencia ? fmt(evidencia.capturedAt) : "…"}`
                : ""}
            </DialogDescription>
          </DialogHeader>

          {!evidencia ? (
            <p className="text-sm text-muted-foreground">
              Cargando la evidencia…
            </p>
          ) : (
            <div className="space-y-6">
              {evidencia.hasImage && evidenciaDe ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={`/api/admin/evidence/${evidenciaDe.id}/image`}
                  alt="Captura de pantalla en el momento del bloqueo"
                  className="w-full border border-border"
                />
              ) : (
                <p className="border border-border/60 bg-muted/20 px-4 py-3 text-sm text-muted-foreground">
                  Este bloqueo no tiene captura de pantalla
                  {evidencia.nota ? `: ${evidencia.nota}` : "."}
                </p>
              )}

              <div>
                <p className="smallcaps text-muted-foreground">
                  Ventana en primer plano
                </p>
                <p className="mt-1.5 text-sm">
                  {evidencia.foregroundProcess ? (
                    <>
                      <span className="font-medium">
                        {evidencia.foregroundProcess}
                      </span>
                      {evidencia.foregroundTitle && (
                        <span className="text-muted-foreground">
                          {" "}
                          — {evidencia.foregroundTitle}
                        </span>
                      )}
                    </>
                  ) : (
                    "—"
                  )}
                </p>
              </div>

              <div>
                <p className="smallcaps text-muted-foreground">
                  Procesos en la sesión · {evidencia.processes.length}
                </p>
                {evidencia.processes.length === 0 ? (
                  <p className="mt-1.5 text-sm text-muted-foreground">
                    Sin procesos en el paquete.
                  </p>
                ) : (
                  <ul className="mt-1.5 max-h-52 divide-y divide-border overflow-y-auto border-y border-border">
                    {evidencia.processes.map((proc, i) => (
                      <li key={i} className="py-1.5 text-sm">
                        <span className="font-mono text-xs">{proc.proceso}</span>
                        {proc.titulo && (
                          <span className="text-muted-foreground">
                            {" "}
                            — {proc.titulo}
                          </span>
                        )}
                      </li>
                    ))}
                  </ul>
                )}
              </div>

              <div>
                <p className="smallcaps text-muted-foreground">
                  Pestañas del navegador
                  {!evidencia.tabsComplete && (
                    <span className="ml-2 text-warning">
                      lista parcial: solo la activa de cada ventana
                    </span>
                  )}
                </p>
                {evidencia.browserTabs.length === 0 ? (
                  <p className="mt-1.5 text-sm text-muted-foreground">
                    Ningún navegador abierto en ese momento.
                  </p>
                ) : (
                  <ul className="mt-1.5 divide-y divide-border border-y border-border">
                    {evidencia.browserTabs.map((tab, i) => (
                      <li key={i} className="py-1.5 text-sm">
                        <span className="smallcaps text-muted-foreground">
                          {tab.navegador}
                        </span>
                        <span className="ml-2">{tab.titulo}</span>
                        {tab.url && (
                          <span className="block truncate font-mono text-xs text-muted-foreground">
                            {tab.url}
                          </span>
                        )}
                      </li>
                    ))}
                  </ul>
                )}
              </div>

              {evidencia.hasImage && evidencia.nota && (
                <p className="text-xs text-muted-foreground">
                  Nota del agente: {evidencia.nota}
                </p>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
