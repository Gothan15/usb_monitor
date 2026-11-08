import { createReadStream } from "fs";
import { stat } from "fs/promises";
import { Readable } from "stream";

import { requireAgentAuthOPuente } from "@/lib/agentAuth";
import { logError } from "@/lib/logger";
import { rutaExePaquete } from "@/lib/paqueteAgente";

/**
 * GET /api/agent/paquete
 * Descarga del exe de actualización (~140 MB) que el panel guarda
 * en su carpeta de paquete. Va en flujo, sin cargar el archivo en
 * memoria. El agente verifica el SHA-256 contra el manifiesto
 * antes de aplicarlo: esta ruta solo transporta.
 */
export async function GET(req: Request) {
  try {
    await requireAgentAuthOPuente(req);
    const ruta = rutaExePaquete();
    let info;
    try {
      info = await stat(ruta);
    } catch {
      return Response.json(
        { ok: false, error: "Sin paquete de actualización en el panel" },
        { status: 404 },
      );
    }
    if (!info.isFile() || info.size === 0) {
      return Response.json(
        { ok: false, error: "Sin paquete de actualización en el panel" },
        { status: 404 },
      );
    }
    const flujo = Readable.toWeb(createReadStream(ruta)) as ReadableStream;
    return new Response(flujo, {
      status: 200,
      headers: {
        "Content-Type": "application/octet-stream",
        "Content-Length": String(info.size),
        "Content-Disposition":
          'attachment; filename="USBMonitorService.exe"',
        "Cache-Control": "no-store",
      },
    });
  } catch (error: any) {
    if (error?.message === "UNAUTHORIZED") {
      return Response.json(
        { ok: false, error: "No autorizado" },
        { status: 401 },
      );
    }
    logError("Error en agent/paquete", error);
    return Response.json(
      { ok: false, error: error.message },
      { status: 500 },
    );
  }
}
