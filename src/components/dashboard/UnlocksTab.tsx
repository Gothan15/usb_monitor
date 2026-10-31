"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { KeyRound, RefreshCw, ShieldAlert, WifiOff } from "lucide-react";

/**
 * Vista «Desbloqueos» (fase 5): bloqueos en curso, historial de
 * intentos del flujo 2FA y de la emergencia sin red, y equipos en
 * silencio (método 3). Solo lectura: el admin mira, no interviene.
 */

interface Pending {
  id: string;
  pcName: string;
  driveLetter: string;
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

export function UnlocksTab() {
  const [data, setData] = useState<UnlocksData | null>(null);
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
      }
    } finally {
      setLoading(false);
    }
  }, [resultFilter, pcFilter]);

  useEffect(() => {
    load();
    const id = setInterval(load, 30_000);
    return () => clearInterval(id);
  }, [load]);

  const silentComputers = useMemo(
    () => data?.silence.computers.filter((c) => c.silent) ?? [],
    [data],
  );

  return (
    <div className="space-y-6 p-6">
      <div className="flex items-center justify-between">
        <div>
          <p className="font-mono text-[11px] uppercase tracking-[0.22em] text-muted-foreground">
            Auditoría 2FA · Solo lectura
          </p>
          <h2 className="mt-1 text-xl font-semibold">Desbloqueos y bloqueos</h2>
        </div>
        <button
          onClick={load}
          className="inline-flex items-center gap-2 rounded-md border border-input bg-card px-3 py-2 text-sm hover:bg-accent"
        >
          <RefreshCw className={`size-4 ${loading ? "animate-spin" : ""}`} />
          Actualizar
        </button>
      </div>

      {data?.silence.serverLikelyDown && (
        <div className="rounded-md border border-warning/40 bg-warning/10 px-4 py-3 text-sm">
          Ningún equipo está dando señales. Lo probable es que el servidor
          haya estado caído, no que todos los agentes fallaran a la vez:
          los silencios de abajo no cuentan como manipulación.
        </div>
      )}

      {!data?.silence.serverLikelyDown && silentComputers.length > 0 && (
        <section className="rounded-md border border-destructive/40 bg-destructive/5">
          <header className="flex items-center gap-2 border-b border-destructive/20 px-4 py-3">
            <WifiOff className="size-4 text-destructive" />
            <h3 className="text-sm font-semibold">
              Equipos sin agente ({silentComputers.length})
            </h3>
            <span className="font-mono text-[11px] uppercase tracking-widest text-muted-foreground">
              Umbral: {data?.silence.thresholdMinutes} min
            </span>
          </header>
          <ul className="divide-y divide-border/60">
            {silentComputers.map((c) => (
              <li key={c.id} className="flex items-center justify-between px-4 py-2.5 text-sm">
                <span className="font-medium text-destructive">
                  {c.name}
                  <span className="ml-2 font-normal text-muted-foreground">{c.ipAddress}</span>
                </span>
                <span className="font-mono text-xs">
                  sin agente desde las {timeHHMM(c.silentSince)}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="rounded-md border border-border bg-card">
        <header className="flex items-center gap-2 border-b border-border px-4 py-3">
          <ShieldAlert className="size-4 text-warning" />
          <h3 className="text-sm font-semibold">
            Bloqueados ahora ({data?.blockedNow.length ?? 0})
          </h3>
        </header>
        {data && data.blockedNow.length === 0 ? (
          <p className="px-4 py-4 text-sm text-muted-foreground">
            Ningún dispositivo está esperando contraseña.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left font-mono text-[11px] uppercase tracking-widest text-muted-foreground">
                  <th className="px-4 py-2">Equipo</th>
                  <th className="px-4 py-2">Unidad</th>
                  <th className="px-4 py-2">Dispositivo</th>
                  <th className="px-4 py-2">Serial</th>
                  <th className="px-4 py-2">Lista blanca</th>
                  <th className="px-4 py-2">Desde</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/60">
                {data?.blockedNow.map((p) => (
                  <tr key={p.id}>
                    <td className="px-4 py-2 font-medium">{p.pcName}</td>
                    <td className="px-4 py-2 font-mono">{p.driveLetter}</td>
                    <td className="px-4 py-2">{p.deviceLabel || "—"}</td>
                    <td className="px-4 py-2 font-mono text-xs">{p.serialNumber || "—"}</td>
                    <td className="px-4 py-2">{p.whitelisted ? "Conocido" : "Desconocido"}</td>
                    <td className="px-4 py-2">{fmt(p.createdAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="rounded-md border border-border bg-card">
        <header className="flex items-center gap-2 border-b border-border px-4 py-3">
          <KeyRound className="size-4 text-success" />
          <h3 className="text-sm font-semibold">
            En uso tras desbloqueo ({data?.activeUnlocked.length ?? 0})
          </h3>
        </header>
        {data && data.activeUnlocked.length === 0 ? (
          <p className="px-4 py-4 text-sm text-muted-foreground">
            Ningún dispositivo desbloqueado sigue conectado.
          </p>
        ) : (
          <ul className="divide-y divide-border/60">
            {data?.activeUnlocked.map((p) => (
              <li key={p.id} className="flex items-center justify-between px-4 py-2.5 text-sm">
                <span>
                  <span className="font-medium">{p.pcName}</span>
                  <span className="ml-2 font-mono text-xs">{p.driveLetter}</span>
                  <span className="ml-2 text-muted-foreground">{p.deviceLabel || ""}</span>
                </span>
                <span className="text-xs text-muted-foreground">
                  desbloqueado por {p.unlockedBy?.username ?? "—"} · {fmt(p.unlockedAt)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="rounded-md border border-border bg-card">
        <header className="flex flex-wrap items-center gap-3 border-b border-border px-4 py-3">
          <h3 className="text-sm font-semibold">Historial de intentos</h3>
          <select
            value={resultFilter}
            onChange={(e) => setResultFilter(e.target.value)}
            className="rounded-md border border-input bg-background px-2 py-1.5 text-sm"
          >
            <option value="">Todos los resultados</option>
            {Object.entries(RESULT_LABELS).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
          <input
            value={pcFilter}
            onChange={(e) => setPcFilter(e.target.value)}
            placeholder="Filtrar por equipo…"
            className="rounded-md border border-input bg-background px-2 py-1.5 text-sm"
          />
        </header>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left font-mono text-[11px] uppercase tracking-widest text-muted-foreground">
                <th className="px-4 py-2">Cuándo</th>
                <th className="px-4 py-2">Equipo</th>
                <th className="px-4 py-2">Usuario intentado</th>
                <th className="px-4 py-2">Serial</th>
                <th className="px-4 py-2">Resultado</th>
                <th className="px-4 py-2">Origen</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/60">
              {data?.attempts.map((a) => (
                <tr
                  key={a.id}
                  className={a.adminUnlock ? "bg-warning/5" : undefined}
                >
                  <td className="px-4 py-2 whitespace-nowrap">{fmt(a.createdAt)}</td>
                  <td className="px-4 py-2 font-medium">{a.pcName}</td>
                  <td className="px-4 py-2">
                    {a.usernameTried}
                    {a.adminUnlock && (
                      <span className="ml-2 rounded bg-warning/15 px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wider text-warning">
                        con cuenta admin
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-2 font-mono text-xs">{a.serialNumber || "—"}</td>
                  <td className="px-4 py-2">
                    <span
                      className={
                        a.result === "SUCCESS" || a.result === "OFFLINE_OK"
                          ? "text-success"
                          : a.result === "NOT_WHITELISTED" || a.result === "NOT_OWNER"
                            ? "text-warning"
                            : "text-destructive"
                      }
                    >
                      {RESULT_LABELS[a.result] ?? a.result}
                    </span>
                  </td>
                  <td className="px-4 py-2 font-mono text-xs">
                    {a.origin === "OFFLINE_LOCAL" ? "Sin red (local)" : "En línea"}
                  </td>
                </tr>
              ))}
              {data && data.attempts.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-4 py-4 text-muted-foreground">
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
