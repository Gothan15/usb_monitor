/**
 * Utilidad para notificar al servicio USB en las computadoras clientes
 * cuando se autoriza un desbloqueo.
 */

import { db } from "./db";
import { getCurrentTimestamp } from "@/lib/time";

/**
 * Notifica al servicio USB de una computadora específica
 * que debe desbloquear una unidad.
 */
export async function notifyServiceUnlock(
  pcName: string,
  driveLetter: string
): Promise<{ success: boolean; error?: string }> {
  try {
    // Obtener la IP de la computadora desde la base de datos
    const computer = await db.computer.findFirst({
      where: {
        name: {
          equals: pcName,
        },
      },
      select: {
        ipAddress: true,
        name: true,
      },
    });

    if (!computer || !computer.ipAddress) {
      return {
        success: false,
        error: `No se encontró IP para la computadora ${pcName}`,
      };
    }

    // Puerto por defecto del servicio (configurable via env)
    const servicePort = process.env.USB_SERVICE_PORT || "5001";
    const serviceUrl = `http://${computer.ipAddress}:${servicePort}/unlock`;

    // Enviar notificación HTTP POST al servicio
    const response = await fetch(serviceUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        pcName: computer.name,
        driveLetter: driveLetter,
      }),
      signal: AbortSignal.timeout(5000), // Timeout de 5 segundos
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      return {
        success: false,
        error: `Servicio respondió con status ${response.status}: ${
          errorData.error || "Error desconocido"
        }`,
      };
    }

    const data = await response.json();
    return {
      success: data.ok === true,
      error: data.error,
    };
  } catch (error: any) {
    // Si falla la notificación HTTP, el servicio usará polling como fallback
    console.error(`Error al notificar servicio en ${pcName}:`, error);
    return {
      success: false,
      error: `Error de red: ${
        error.message || "No se pudo conectar al servicio"
      }`,
    };
  }
}

/**
 * Verifica si el servicio está disponible en una computadora.
 */
export async function checkServiceHealth(ip: string): Promise<{
  available: boolean;
  hostname?: string;
  statusCode?: number;
  statusText?: string;
  latencyMs?: number;
  serviceVersion?: string;
  uptimeSeconds?: number;
  pendingUnlocks?: number;
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
    pendingUnlocks?: number;
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
      const pendingRaw =
        data.pending_unlocks ?? data.pendingUnlocks ?? data.pending;
      const heartbeatRaw =
        data.timestamp ?? data.heartbeat ?? data.heartbeatAt ?? data.lastPing;
      const uptimeValue = coerceNumber(uptimeRaw);
      const pendingValue = coerceNumber(pendingRaw);

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
        pendingUnlocks:
          typeof pendingValue === "number"
            ? Math.max(0, Math.round(pendingValue))
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
