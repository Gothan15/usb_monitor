"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLiveData } from "@/components/providers/LiveDataProvider";
import { RefreshCw } from "lucide-react";

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
  const [loading, setLoading] = useState(true);
  const [resultFilter, setResultFilter] = useState("");
  const [pcFilter, setPcFilter] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
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
    } finally {
      setLoading(false);
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
        <div className="flex flex-col items-end gap-1">
          <button
            onClick={load}
            className="inline-flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.14em] text-primary underline-offset-4 transition-colors hover:text-foreground hover:underline"
          >
            <RefreshCw className={`size-4 ${loading ? "animate-spin" : ""}`} />
            Actualizar
          </button>
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
                  <span className="text-xs text-muted-foreground tabular-nums">
                    desbloqueado por {p.unlockedBy?.username ?? "—"} ·{" "}
                    {fmt(p.unlockedAt)}
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
    </div>
  );
}
