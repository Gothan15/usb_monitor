import { createReadStream } from "fs";
import { stat } from "fs/promises";
import { Readable } from "stream";

import { requireAgentAuth } from "@/lib/agentAuth";
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
    await requireAgentAuth(req);
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
    // Descarga por rangos: el agente reanuda una descarga
    // cortada desde donde se quedó (Range: bytes=N-) en vez de
    // empezar los ~95 MB de cero. Sin cabecera Range, el archivo
    // entero como siempre.
    const rango = /^bytes=(\d+)-(\d*)$/.exec(
      (req.headers.get("range") ?? "").trim(),
    );
    if (rango) {
      const inicio = Number(rango[1]);
      const fin = rango[2] ? Number(rango[2]) : info.size - 1;
      if (
        !Number.isSafeInteger(inicio) ||
        !Number.isSafeInteger(fin) ||
        inicio < 0 ||
        inicio >= info.size ||
        fin < inicio
      ) {
        return new Response(null, {
          status: 416,
          headers: { "Content-Range": `bytes */${info.size}` },
        });
      }
      const finReal = Math.min(fin, info.size - 1);
      const flujoRango = Readable.toWeb(
        createReadStream(ruta, { start: inicio, end: finReal }),
      ) as ReadableStream;
      return new Response(flujoRango, {
        status: 206,
        headers: {
          "Content-Type": "application/octet-stream",
          "Content-Length": String(finReal - inicio + 1),
          "Content-Range": `bytes ${inicio}-${finReal}/${info.size}`,
          "Accept-Ranges": "bytes",
          "Cache-Control": "no-store",
        },
      });
    }
    const flujo = Readable.toWeb(createReadStream(ruta)) as ReadableStream;
    return new Response(flujo, {
      status: 200,
      headers: {
        "Content-Type": "application/octet-stream",
        "Content-Length": String(info.size),
        "Accept-Ranges": "bytes",
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
