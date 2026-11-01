import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireServiceAuth } from "@/lib/auth";
import { getCurrentDate, getCurrentIsoString } from "@/lib/time";
import { normalizeComputerName } from "@/lib/utils";
import { registrarContactoAgente } from "@/lib/agentDebug";
import { logError } from "@/lib/logger";

/**
 * GET /api/agent/ping?pcName=...
 * Prueba de conexión del agente (botón «Probar conexión» de su
 * ventana): ruta barata, sin lecturas de ajustes ni de archivos.
 * Autentica como servicio, renueva el lastSeen del equipo si existe
 * y devuelve la hora del servidor para que el agente pueda comparar
 * relojes. Cada llamada queda registrada en agentDebug (y, con
 * USB_MONITOR_DEBUG=1, en el latido por segundo del servidor).
 */
export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const pcNameRaw = searchParams.get("pcName") || "";
  try {
    const serviceAuth = await requireServiceAuth(req);

    const pcName = normalizeComputerName(
      pcNameRaw || serviceAuth.serviceId || ""
    );

    let pc: string | null = null;
    if (pcName) {
      const computer = await db.computer.findUnique({
        where: { name: pcName },
        select: { id: true, name: true },
      });
      if (computer) {
        pc = computer.name;
        await db.computer.update({
          where: { id: computer.id },
          data: { lastSeen: getCurrentDate(), isActive: true },
        });
      }
    }

    registrarContactoAgente(pc ?? (pcName || null), "/api/agent/ping", 200);

    const res = NextResponse.json({
      ok: true,
      serverTime: getCurrentIsoString(),
      pc,
    });
    res.headers.set("Cache-Control", "no-store");
    return res;
  } catch (error: any) {
    if (error?.message === "UNAUTHORIZED") {
      registrarContactoAgente(
        pcNameRaw ? normalizeComputerName(pcNameRaw) : null,
        "/api/agent/ping",
        401
      );
      return NextResponse.json(
        { ok: false, error: "No autorizado" },
        { status: 401 }
      );
    }
    logError("Error en agent/ping", error);
    return NextResponse.json(
      { ok: false, error: error.message },
      { status: 500 }
    );
  }
}
