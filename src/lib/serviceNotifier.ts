/**
 * Utilidad para notificar al servicio USB en las computadoras clientes
 * cuando se autoriza un desbloqueo.
 */

import { db } from "./db";

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
export async function checkServiceHealth(
  ip: string
): Promise<{ available: boolean; hostname?: string }> {
  try {
    const servicePort = process.env.USB_SERVICE_PORT || "5001";
    const healthUrl = `http://${ip}:${servicePort}/health`;

    const response = await fetch(healthUrl, {
      method: "GET",
      signal: AbortSignal.timeout(3000),
    });

    if (response.ok) {
      const data = await response.json();
      return {
        available: true,
        hostname: data.hostname,
      };
    }

    return { available: false };
  } catch (error) {
    return { available: false };
  }
}
