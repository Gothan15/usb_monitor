"use client";

import { useEffect, useMemo, useState } from "react";
import {
  type USBEvent,
  type Computer,
  type WhitelistEntry,
  formatDateTime,
  formatHour,
} from "@/components/dashboard/types";
import {
  ResponsiveContainer,
  AreaChart,
  Area,
  BarChart,
  Bar,
  Tooltip as ChartTooltip,
  XAxis,
  YAxis,
  CartesianGrid,
} from "recharts";
import { cn } from "@/lib/utils";
import { getCurrentDate, getCurrentTimestamp } from "@/lib/time";

interface OverviewTabProps {
  events: USBEvent[];
  computers: Computer[];
  whitelist: WhitelistEntry[];
  loading: boolean;
}

const classifyEventTone = (message: string) => {
  const normalized = message.toLowerCase();
  if (
    normalized.includes("deneg") ||
    normalized.includes("fail") ||
    normalized.includes("bloque")
  ) {
    return "blocked" as const;
  }
  if (
    normalized.includes("permit") ||
    normalized.includes("desbloque") ||
    normalized.includes("readonly removido")
  ) {
    return "allowed" as const;
  }
  return "neutral" as const;
};

export function OverviewTab({
  events,
  computers,
  whitelist,
  loading,
}: OverviewTabProps) {
  const activeComputers = computers.filter(
    (computer) => computer.isActive,
  ).length;
  const totalEvents = events.length;
  const recentEvents = events.filter((event) => {
    const eventDate = new Date(event.createdAt);
    const oneHourAgo = getCurrentTimestamp() - 60 * 60 * 1000;
    return eventDate.getTime() >= oneHourAgo;
  }).length;

  const trendData = useMemo(() => {
    const hours = 12;
    const now = getCurrentDate();
    const buckets = new Array(hours).fill(0).map((_, index) => {
      const bucketDate = new Date(
        now.getTime() - (hours - index - 1) * 60 * 60 * 1000,
      );
      const label = formatHour(bucketDate);
      return { label, allowed: 0, blocked: 0, total: 0 };
    });

    // Mapear seriales en whitelist para clasificación precisa
    const whitelistSerials = new Set(
      whitelist
        .map((w) => w.serialNumber?.trim().toLowerCase())
        .filter((s): s is string => Boolean(s)),
    );

    events.forEach((event) => {
      const createdAt = new Date(event.createdAt);
      const diffHours =
        (now.getTime() - createdAt.getTime()) / (60 * 60 * 1000);
      if (diffHours < 0 || diffHours >= hours) return;
      const bucketIndex = Math.floor(hours - diffHours - 1);
      const bucket = buckets[bucketIndex];
      if (!bucket) return;

      const isWhitelisted =
        Boolean(event.whitelisted) ||
        (event.serialNumber
          ? whitelistSerials.has(event.serialNumber.trim().toLowerCase())
          : false);

      if (isWhitelisted) bucket.allowed += 1;
      else bucket.blocked += 1;
      bucket.total += 1;
    });

    return buckets;
  }, [events, whitelist]);

  const latestAlerts = useMemo(
    () =>
      [...events]
        .filter((event) => classifyEventTone(event.event) !== "neutral")
        .slice(0, 6),
    [events],
  );

  const serviceSummary = useMemo(() => {
    const running = computers.filter(
      (computer) => computer.serviceRunning,
    ).length;
    const responding = computers.filter(
      (computer) => computer.lastServiceCheck,
    ).length;
    const offline = computers.length - running;
    return {
      running,
      responding,
      offline,
      total: computers.length,
    };
  }, [computers]);

  const whitelistStats = useMemo(() => {
    const withNotes = whitelist.filter((item) =>
      Boolean(item.notes?.trim()),
    ).length;
    const withLabel = whitelist.filter((item) =>
      Boolean(item.label?.trim()),
    ).length;
    return { total: whitelist.length, withNotes, withLabel };
  }, [whitelist]);

  /* ── Event Distribution (pie data) ── */
  const eventDistribution = useMemo(() => {
    let allowed = 0;
    let blocked = 0;
    let neutral = 0;

    const whitelistSerials = new Set(
      whitelist
        .map((w) => w.serialNumber?.trim().toLowerCase())
        .filter((s): s is string => Boolean(s)),
    );

    events.forEach((ev) => {
      const tone = classifyEventTone(ev.event);
      if (tone === "blocked") blocked++;
      else if (tone === "allowed") allowed++;
      else {
        const isWl =
          Boolean(ev.whitelisted) ||
          (ev.serialNumber
            ? whitelistSerials.has(ev.serialNumber.trim().toLowerCase())
            : false);
        if (isWl) allowed++;
        else neutral++;
      }
    });

    return [
      { name: "Autorizados", value: allowed, color: "oklch(0.72 0.17 160)" },
      { name: "Bloqueados", value: blocked, color: "oklch(0.7 0.18 30)" },
      { name: "Otros", value: neutral, color: "oklch(0.55 0.02 250)" },
    ].filter((d) => d.value > 0);
  }, [events, whitelist]);

  /* ── Top Devices (bar data) ── */
  const topDevices = useMemo(() => {
    const counts = new Map<string, number>();
    events.forEach((ev) => {
      const serial = ev.serialNumber?.trim();
      if (!serial) return;
      counts.set(serial, (counts.get(serial) ?? 0) + 1);
    });
    return [...counts.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 6)
      .map(([serial, count]) => ({
        serial: serial.length > 12 ? serial.slice(0, 12) + "…" : serial,
        count,
      }));
  }, [events]);

  /* ── Chart type toggle ── */
  const [chartType, setChartType] = useState<"area" | "bar">(() => {
    try {
      return localStorage.getItem("usbmonitor:grafico") === "bar" ? "bar" : "area";
    } catch {
      return "area";
    }
  });
  useEffect(() => {
    try {
      localStorage.setItem("usbmonitor:grafico", chartType);
    } catch { /* sin almacenamiento */ }
  }, [chartType]);

  const estadoTitular =
    serviceSummary.total === 0
      ? { titulo: "Sin agentes", detalle: "Ningún equipo está reportando al panel." }
      : serviceSummary.offline === 0
        ? {
            titulo: "Monitoreo estable",
            detalle: `${serviceSummary.running} de ${serviceSummary.total} equipos con el servicio activo.`,
          }
        : {
            titulo: "Agentes sin servicio",
            detalle: `${serviceSummary.offline} de ${serviceSummary.total} equipos no responden.`,
          };
  const totalDistribucion = eventDistribution.reduce(
    (acc, entry) => acc + entry.value,
    0,
  );

  return (
    <div className="animate-view-in">
      {/* ── Titular: estado y cifras del día ── */}
      <section data-tour="stats-cards" className="grid gap-10 lg:grid-cols-[1.2fr_2fr] lg:gap-16">
        <div>
          <p className="smallcaps flex items-center gap-2 text-muted-foreground">
            <span
              className={cn(
                "size-1.5 rounded-full",
                serviceSummary.offline === 0 && serviceSummary.total > 0
                  ? "dot-pulse bg-success"
                  : "bg-warning",
              )}
            />
            Estado en vivo
          </p>
          <h2 className="font-display mt-3 text-[2rem] font-bold leading-tight tracking-tight">
            {estadoTitular.titulo}
          </h2>
          <p className="mt-2 max-w-sm text-sm leading-relaxed text-muted-foreground">
            {estadoTitular.detalle}
          </p>
        </div>
        <dl className="grid grid-cols-3 items-end gap-6">
          {[
            { cifra: whitelist.length, etiqueta: "En lista blanca" },
            { cifra: totalEvents, etiqueta: "Eventos totales" },
            { cifra: recentEvents, etiqueta: "En la última hora" },
          ].map((dato) => (
            <div key={dato.etiqueta} className="border-t-2 border-foreground/70 pt-3">
              <dd className="font-display text-[2.1rem] font-bold leading-none tabular-nums">
                {dato.cifra}
              </dd>
              <dt className="smallcaps mt-2 text-muted-foreground">
                {dato.etiqueta}
              </dt>
            </div>
          ))}
        </dl>
      </section>

      {/* ── Tendencia y alertas ── */}
      <div className="mt-14 grid gap-12 xl:grid-cols-[2fr_1fr]">
        <section className="border-t border-border pt-6">
          <div className="flex flex-wrap items-baseline justify-between gap-3">
            <div>
              <h3 className="font-display text-[1.3rem] font-bold">
                Tendencia de eventos
              </h3>
              <p className="mt-1 text-xs text-muted-foreground">
                Autorizaciones y bloqueos de las últimas 12 horas ·{" "}
                {totalEvents} en total
              </p>
            </div>
            <div className="flex items-center gap-4">
              {(
                [
                  ["area", "Área"],
                  ["bar", "Barras"],
                ] as const
              ).map(([tipo, texto]) => (
                <button
                  key={tipo}
                  type="button"
                  onClick={() => setChartType(tipo)}
                  className={cn(
                    "text-[11px] font-semibold uppercase tracking-[0.12em] transition-colors",
                    chartType === tipo
                      ? "text-foreground underline decoration-[var(--acero)] decoration-2 underline-offset-4"
                      : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  {texto}
                </button>
              ))}
            </div>
          </div>
          <div className="mt-4 h-[280px] w-full">
            <ResponsiveContainer width="100%" height="100%">
              {chartType === "area" ? (
                <AreaChart data={trendData} margin={{ left: 0, right: 0, top: 16, bottom: 4 }}>
                  <defs>
                    <linearGradient id="allowed" x1="0" x2="0" y1="0" y2="1">
                      <stop offset="5%" stopColor="oklch(0.72 0.17 160)" stopOpacity={0.25} />
                      <stop offset="95%" stopColor="oklch(0.72 0.17 160)" stopOpacity={0} />
                    </linearGradient>
                    <linearGradient id="blocked" x1="0" x2="0" y1="0" y2="1">
                      <stop offset="5%" stopColor="oklch(0.7 0.18 30)" stopOpacity={0.3} />
                      <stop offset="95%" stopColor="oklch(0.7 0.18 30)" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} className="stroke-border/50" />
                  <XAxis dataKey="label" tickLine={false} axisLine={false} tick={{ fontSize: 10 }} dy={6} />
                  <YAxis tickLine={false} axisLine={false} tick={{ fontSize: 10 }} width={28} allowDecimals={false} />
                  <ChartTooltip contentStyle={{ fontSize: 12 }} />
                  <Area type="monotone" dataKey="allowed" name="Autorizados" stroke="oklch(0.55 0.12 160)" fill="url(#allowed)" strokeWidth={2} />
                  <Area type="monotone" dataKey="blocked" name="Bloqueados" stroke="oklch(0.55 0.16 30)" fill="url(#blocked)" strokeWidth={2} />
                </AreaChart>
              ) : (
                <BarChart data={trendData} margin={{ left: 0, right: 0, top: 16, bottom: 4 }}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} className="stroke-border/50" />
                  <XAxis dataKey="label" tickLine={false} axisLine={false} tick={{ fontSize: 10 }} dy={6} />
                  <YAxis tickLine={false} axisLine={false} tick={{ fontSize: 10 }} width={28} allowDecimals={false} />
                  <ChartTooltip contentStyle={{ fontSize: 12 }} />
                  <Bar dataKey="allowed" name="Autorizados" fill="oklch(0.72 0.17 160)" radius={[3, 3, 0, 0]} />
                  <Bar dataKey="blocked" name="Bloqueados" fill="oklch(0.7 0.18 30)" radius={[3, 3, 0, 0]} />
                </BarChart>
              )}
            </ResponsiveContainer>
          </div>
        </section>

        <section data-tour="activity-feed" className="border-t border-border pt-6">
          <h3 className="font-display text-[1.3rem] font-bold">
            Alertas recientes
          </h3>
          {loading ? (
            <div className="mt-5 space-y-4">
              {[1, 2, 3].map((i) => (
                <div key={i} className="h-12 animate-pulse bg-muted/50" />
              ))}
            </div>
          ) : latestAlerts.length === 0 ? (
            <p className="mt-5 text-sm text-muted-foreground">
              Sin alertas recientes. Todo lo registrado fue autorizado.
            </p>
          ) : (
            <ol className="mt-2">
              {latestAlerts.map((event, indice) => {
                const tone = classifyEventTone(event.event);
                return (
                  <li
                    key={event.id}
                    className="flex gap-4 border-b border-border/60 py-3.5 last:border-b-0"
                  >
                    <span className="font-display text-sm italic text-[var(--acero)]">
                      {String(indice + 1).padStart(2, "0")}
                    </span>
                    <div className="min-w-0">
                      <p className="text-[13px] font-medium leading-snug">
                        {event.pcName} · {event.pcUser}
                      </p>
                      <p
                        className={cn(
                          "mt-0.5 truncate text-xs",
                          tone === "blocked"
                            ? "text-destructive"
                            : "text-muted-foreground",
                        )}
                      >
                        {event.event}
                      </p>
                      <p className="mt-1 font-mono text-[10px] text-muted-foreground/70">
                        {formatDateTime(event.createdAt)}
                      </p>
                    </div>
                  </li>
                );
              })}
            </ol>
          )}
        </section>
      </div>

      {/* ── Índices: flota, lista blanca, distribución y dispositivos ── */}
      <div className="mt-14 grid gap-12 border-t border-border pt-8 md:grid-cols-2 xl:grid-cols-4">
        <section>
          <h3 className="smallcaps text-muted-foreground">La flota</h3>
          <dl className="mt-4 space-y-3 text-sm">
            {[
              ["Con el servicio activo", serviceSummary.running],
              ["Respondiendo ahora", serviceSummary.responding],
              ["Sin servicio", serviceSummary.offline],
              ["Equipos registrados", serviceSummary.total],
            ].map(([texto, cifra]) => (
              <div key={texto as string} className="flex items-baseline justify-between gap-4">
                <dt className="text-muted-foreground">{texto}</dt>
                <dd className="font-display text-lg font-bold tabular-nums">{cifra}</dd>
              </div>
            ))}
          </dl>
        </section>

        <section>
          <h3 className="smallcaps text-muted-foreground">Lista blanca</h3>
          <p className="font-display mt-4 text-[2rem] font-bold leading-none tabular-nums">
            {whitelistStats.total}
            <span className="ml-2 align-middle font-sans text-xs font-normal text-muted-foreground">
              seriales autorizados
            </span>
          </p>
          <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
            {whitelistStats.withLabel} con alias y {whitelistStats.withNotes}{" "}
            con notas. Conviene sincronizarla en menos de 15 minutos tras un
            cambio importante.
          </p>
        </section>

        <section>
          <h3 className="smallcaps text-muted-foreground">Distribución</h3>
          <dl className="mt-4 space-y-3 text-sm">
            {eventDistribution.map((entry) => (
              <div key={entry.name} className="flex items-baseline justify-between gap-4">
                <dt className="text-muted-foreground">{entry.name}</dt>
                <dd className="font-display text-lg font-bold tabular-nums">
                  {totalDistribucion > 0
                    ? `${Math.round((entry.value / totalDistribucion) * 100)} %`
                    : "—"}
                </dd>
              </div>
            ))}
            {eventDistribution.length === 0 && (
              <p className="text-sm text-muted-foreground">Sin datos todavía.</p>
            )}
          </dl>
        </section>

        <section>
          <h3 className="smallcaps text-muted-foreground">
            Dispositivos más vistos
          </h3>
          {topDevices.length === 0 ? (
            <p className="mt-4 text-sm text-muted-foreground">
              Ningún dispositivo registrado aún.
            </p>
          ) : (
            <ol className="mt-4 space-y-3">
              {topDevices.map((device, indice) => (
                <li
                  key={device.serial + indice}
                  className="flex items-baseline justify-between gap-4 text-sm"
                >
                  <span className="min-w-0 truncate font-mono text-xs">
                    {device.serial}
                  </span>
                  <span className="font-display text-lg font-bold tabular-nums">
                    {device.count}
                  </span>
                </li>
              ))}
            </ol>
          )}
        </section>
      </div>
    </div>
  );
}
