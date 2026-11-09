import { NextResponse } from "next/server";

import { requireAgentAuth } from "@/lib/agentAuth";
import { logError } from "@/lib/logger";
import { manifiestoPaquete } from "@/lib/paqueteAgente";

/**
 * GET /api/agent/paquete/manifiesto
 * Qué actualización tiene el panel para el agente: versión (si el
 * manifiesto.json de la carpeta la declara), tamaño y SHA-256 del
 * exe. El agente compara el hash tras descargar y solo se
 * sustituye si coincide. 404 si no hay paquete dejado en el panel.
 */
export async function GET(req: Request) {
  try {
    await requireAgentAuth(req);
    const manifiesto = await manifiestoPaquete();
    if (!manifiesto) {
      return NextResponse.json(
        { ok: false, error: "Sin paquete de actualización en el panel" },
        { status: 404 },
      );
    }
    const res = NextResponse.json({ ok: true, ...manifiesto });
    res.headers.set("Cache-Control", "no-store");
    return res;
  } catch (error: any) {
    if (error?.message === "UNAUTHORIZED") {
      return NextResponse.json(
        { ok: false, error: "No autorizado" },
        { status: 401 },
      );
    }
    logError("Error en agent/paquete/manifiesto", error);
    return NextResponse.json(
      { ok: false, error: error.message },
      { status: 500 },
    );
  }
}
