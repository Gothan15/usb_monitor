import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireServiceAuth } from "@/lib/auth";
import { hit } from "@/lib/rateLimit";
import { registrarContactoAgente } from "@/lib/agentDebug";
import { logError } from "@/lib/logger";
import { broadcastUnlockChange } from "@/lib/socket";
import { validarPaqueteEvidencia } from "@/lib/evidence";
import type { Prisma } from "@/generated/prisma/client";

/**
 * POST /api/usb-event/evidence
 * El agente sube la foto del momento de un bloqueo de un dispositivo
 * no autorizado (ajuste «Capturar evidencia…»): captura de pantalla,
 * ventana en primer plano, procesos y pestañas. Queda guardada
 * colgando del bloqueo (pendingUnlockId) y se ve en Desbloqueos.
 */
export async function POST(req: Request) {
  try {
    const serviceAuth = await requireServiceAuth(req);

    const clientIp =
      (req.headers.get("x-forwarded-for") || "").split(",")[0].trim() ||
      "unknown";
    const rate = await hit(
      "usb-evidence",
      { windowMs: 10_000, max: 6 },
      { serviceId: serviceAuth.serviceId, ip: clientIp }
    );
    if (!rate.allowed) {
      return NextResponse.json(
        { ok: false, error: "Rate limit" },
        { status: 429 }
      );
    }

    let body: unknown;
    try {
      body = await req.json();
    } catch {
      return NextResponse.json(
        { ok: false, error: "JSON inválido" },
        { status: 400 }
      );
    }

    const validacion = validarPaqueteEvidencia(body);
    if (!validacion.ok) {
      return NextResponse.json(
        { ok: false, error: validacion.error },
        { status: 400 }
      );
    }
    const datos = validacion.datos;

    // El nombre del equipo sale del propio bloqueo: es el panel
    // quien lo registró, no el paquete que llega.
    const bloqueo = await db.pendingUnlock.findUnique({
      where: { id: datos.pendingUnlockId },
      select: { pcName: true },
    });
    if (!bloqueo) {
      return NextResponse.json(
        { ok: false, error: "El bloqueo indicado no existe" },
        { status: 404 }
      );
    }

    const evidencia = await db.blockEvidence.create({
      data: {
        pendingUnlockId: datos.pendingUnlockId,
        computerName: bloqueo.pcName,
        serialNumber: datos.serialNumber,
        capturedAt: datos.capturedAt,
        foregroundProcess: datos.foregroundProcess,
        foregroundTitle: datos.foregroundTitle,
        // Las listas validadas son objetos planos: Prisma pide su
        // tipo Json de entrada, sin índice en las interfaces.
        processes: datos.processes as unknown as Prisma.InputJsonValue,
        browserTabs: datos.browserTabs as unknown as Prisma.InputJsonValue,
        tabsComplete: datos.tabsComplete,
        nota: datos.nota,
        image: datos.image ? new Uint8Array(datos.image) : null,
        imageMime: datos.imageMime,
      },
    });

    // La vista de Desbloqueos gana el botón «Evidencia» en esa fila.
    broadcastUnlockChange();
    registrarContactoAgente(
      bloqueo.pcName,
      "/api/usb-event/evidence",
      200
    );
    const res = NextResponse.json({
      ok: true,
      id: evidencia.id,
      message: "Evidencia guardada",
    });
    res.headers.set("Cache-Control", "no-store");
    return res;
  } catch (error: any) {
    if (error?.message === "UNAUTHORIZED") {
      registrarContactoAgente(null, "/api/usb-event/evidence", 401);
      return NextResponse.json(
        { ok: false, error: "No autorizado" },
        { status: 401 }
      );
    }
    logError("Error guardando la evidencia", error);
    return NextResponse.json(
      { ok: false, error: error.message },
      { status: 500 }
    );
  }
}
