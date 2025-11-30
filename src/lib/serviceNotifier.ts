import { db } from "@/lib/db";
import { getCurrentTimestamp } from "@/lib/time";

/**
 * Verifica si el servicio está disponible en una computadora.
 * Nota: lógica de desbloqueo legacy eliminada; solo se consulta salud.
 */
export async function checkServiceHealth(ip: string): Promise<{
  available: boolean;
  hostname?: string;
  statusCode?: number;
  statusText?: string;
  latencyMs?: number;
  serviceVersion?: string;
  uptimeSeconds?: number;
  heartbeatAt?: number;
}> {
  const servicePort = process.env.USB_SERVICE_PORT || "5001";
  const baseUrl = `http://${ip}:${servicePort}`;

  const normalizeTimestamp = (value: unknown): number | undefined => {
    if (typeof value === "number") {
      return value > 10_000_000_000 ? value : value * 1000;
    }
    if (typeof value === "string") {
      const numeric = Number(value);
      if (!Number.isNaN(numeric)) {
        return numeric > 10_000_000_000 ? numeric : numeric * 1000;
      }
      const parsed = Date.parse(value);
      if (!Number.isNaN(parsed)) return parsed;
    }
    return undefined;
  };

  const coerceNumber = (value: unknown): number | undefined => {
    if (typeof value === "number" && Number.isFinite(value)) return value;
    if (typeof value === "string") {
      const parsed = Number(value);
      if (Number.isFinite(parsed)) return parsed;
    }
    return undefined;
  };

  type HealthResult = {
    available: boolean;
    hostname?: string;
    statusCode?: number;
    statusText?: string;
    latencyMs?: number;
    serviceVersion?: string;
    uptimeSeconds?: number;
    heartbeatAt?: number;
  };

  let lastResult: HealthResult | undefined;

  const attempt = async (path: string): Promise<HealthResult | null> => {
    const started = getCurrentTimestamp();
    try {
      const response = await fetch(`${baseUrl}${path}`, {
        method: "GET",
        signal: AbortSignal.timeout(3000),
      });

      const latencyMs = getCurrentTimestamp() - started;
      const statusCode = response.status;
      const statusText = response.statusText || undefined;
      const contentType = response.headers.get("content-type") || "";
      const isJson = contentType.toLowerCase().includes("json");
      const data = isJson ? await response.json().catch(() => ({})) : {};

      const hostname =
        data.hostname || data.pc_name || data.name || data.pcName || undefined;
      const statusField =
        (typeof data.status === "string" && data.status) ||
        (typeof data.service_status === "string" && data.service_status) ||
        statusText ||
        (response.ok ? "OK" : "Sin respuesta");
      const version =
        (typeof data.version === "string" && data.version) ||
        (typeof data.serviceVersion === "string" && data.serviceVersion) ||
        (typeof data.build === "string" && data.build) ||
        (typeof data.appVersion === "string" && data.appVersion) ||
        undefined;
      const uptimeRaw = data.uptime_seconds ?? data.uptimeSeconds;
      const heartbeatRaw =
        data.timestamp ?? data.heartbeat ?? data.heartbeatAt ?? data.lastPing;
      const uptimeValue = coerceNumber(uptimeRaw);

      const result: HealthResult = {
        available: response.ok,
        hostname,
        statusCode,
        statusText: statusField,
        latencyMs,
        serviceVersion: version,
        uptimeSeconds:
          typeof uptimeValue === "number"
            ? Math.max(0, uptimeValue)
            : undefined,
        heartbeatAt: normalizeTimestamp(heartbeatRaw),
      };

      lastResult = result;

      if (
        !response.ok &&
        path === "/service-status" &&
        [404, 405].includes(response.status)
      ) {
        return null;
      }

      return result;
    } catch (error: any) {
      lastResult = {
        available: false,
        statusText: error?.message || "Error de red",
        latencyMs: getCurrentTimestamp() - started,
      };
      return null;
    }
  };

  const primary = await attempt("/service-status");
  if (primary) return primary;

  const fallback = await attempt("/health");
  if (fallback) return fallback;

  return (
    lastResult || {
      available: false,
      statusText: "Sin respuesta",
    }
  );
}

type NotifyResult = {
  success: boolean;
  status?: number;
  targetUrl?: string;
  data?: unknown;
  error?: string;
};

function normalizeDriveLetter(input: string): string | null {
  const trimmed = input.trim().toUpperCase();
  if (!trimmed) return null;
  if (trimmed.length === 1) {
    return /^[A-Z]$/.test(trimmed) ? `${trimmed}:` : null;
  }
  if (trimmed.length === 2 && /^[A-Z]:$/.test(trimmed)) return trimmed;
  return null;
}

export async function notifyServiceUnlock(
  pcName: string,
  driveLetter: string
): Promise<NotifyResult> {
  if (!pcName?.trim()) {
    return {
      success: false,
      error: "Nombre de PC requerido",
    };
  }

  const normalizedDrive = normalizeDriveLetter(driveLetter ?? "");
  if (!normalizedDrive) {
    return {
      success: false,
      error: "driveLetter inválida",
    };
  }

  const servicePort = process.env.USB_SERVICE_PORT || "5001";

  const computer = await db.computer.findFirst({
    where: {
      name: {
        equals: pcName.trim(),
        mode: "insensitive",
      },
    },
    select: {
      name: true,
      ipAddress: true,
    },
  });

  if (!computer || !computer.ipAddress) {
    return {
      success: false,
      error: "Computadora no encontrada o sin IP registrada",
    };
  }

  const baseUrl = `http://${computer.ipAddress}:${servicePort}`;
  const targetUrl = `${baseUrl}/unlock`;

  try {
    const response = await fetch(targetUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        pcName: computer.name,
        driveLetter: normalizedDrive,
      }),
      signal: AbortSignal.timeout(3500),
    });

    const contentType = response.headers.get("content-type") || "";
    const isJson = contentType.toLowerCase().includes("json");
    const data = isJson
      ? await response.json().catch(() => undefined)
      : undefined;

    if (!response.ok) {
      const errorMessage =
        (typeof data === "object" && data && "error" in data
          ? String((data as Record<string, unknown>).error)
          : undefined) ||
        response.statusText ||
        "Error al notificar";
      return {
        success: false,
        status: response.status,
        targetUrl,
        data,
        error: errorMessage,
      };
    }

    return {
      success: true,
      status: response.status,
      targetUrl,
      data,
    };
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Fallo al contactar servicio";
    return {
      success: false,
      targetUrl,
      error: message,
    };
  }
}
