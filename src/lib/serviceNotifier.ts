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
        signal: AbortSignal.timeout(1500),
      });

      const latencyMs = getCurrentTimestamp() - started;
      const statusCode = response.status;
      const statusText = response.statusText || undefined;
      const contentType = response.headers.get("content-type") || "";
      const isJson = contentType.toLowerCase().includes("json");
      const data = isJson ? await response.json().catch(() => ({})) : {};

      const hostname =
        data.hostname || data.pc_name || data.pc || data.name || data.pcName || undefined;
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

      if (!response.ok && [404, 405].includes(response.status)) {
        // Esta ruta no existe en ese agente: probar la siguiente.
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

  // La ruta real del agente actual es /estado (antes se buscaban
  // /service-status y /health, que el agente ya no expone: el
  // escáner no encontraba el servicio ni en el propio equipo).
  // Las antiguas quedan como compatibilidad. Si un intento falla
  // por red (nadie escucha en ese puerto), no se prueban las
  // demás: la respuesta sería la misma y el escaneo se eterniza.
  for (const path of ["/estado", "/service-status", "/health"]) {
    const result = await attempt(path);
    if (result) return result;
    // attempt solo devuelve null con respuesta HTTP 404/405 (la
    // ruta no existe: probar la siguiente) o con error de red
    // (sin statusCode: nadie escucha ahí, no insistir).
    if (!lastResult?.statusCode) break;
  }

  return (
    lastResult || {
      available: false,
      statusText: "Sin respuesta",
    }
  );
}
