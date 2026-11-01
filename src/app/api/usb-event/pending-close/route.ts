import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireServiceAuth } from "@/lib/auth";
import { hit } from "@/lib/rateLimit";
import { registrarContactoAgente } from "@/lib/agentDebug";
import { logError } from "@/lib/logger";

/**
 * POST /api/usb-event/pending-close
 * El agente avisa de que el dispositivo se extrajo: el registro del
 * bloqueo se cierra (el permiso de uso muere al extraer, fase 2 del
 * plan de desbloqueo por contraseña). Cierra tanto los que seguían
 * bloqueados como los ya desbloqueados en esa unidad.
 */
export async function POST(req: Request) {
  try {
    const serviceAuth = await requireServiceAuth(req);

    const clientIp =
      (req.headers.get("x-forwarded-for") || "").split(",")[0].trim() ||
      "unknown";
    const rate = await hit(
      "usb-pending-close",
      { windowMs: 5_000, max: 8 },
      { serviceId: serviceAuth.serviceId, ip: clientIp }
    );
    if (!rate.allowed) {
      return NextResponse.json(
        { ok: false, error: "Rate limit" },
        { status: 429 }
      );
    }

    const { pcName, driveLetter, serialNumber } = await req.json();

    // Detección amplia: sin letra (móvil WPD) se cierra por serial.
    const hasLetter =
      typeof driveLetter === "string" && driveLetter.trim().length > 0;
    const hasSerial =
      typeof serialNumber === "string" && serialNumber.trim().length > 0;
    if (typeof pcName !== "string" || !pcName.trim() || (!hasLetter && !hasSerial)) {
      return NextResponse.json(
        { ok: false, error: "pcName y (driveLetter o serialNumber) requeridos" },
        { status: 400 }
      );
    }

    const result = await db.pendingUnlock.updateMany({
      where: {
        pcName: pcName.trim(),
        ...(hasLetter
          ? { driveLetter: driveLetter.trim() }
          : { serialNumber: serialNumber.trim() }),
        status: { in: ["BLOCKED", "UNLOCKED"] },
        ...(hasLetter && hasSerial
          ? { serialNumber: serialNumber.trim() }
          : {}),
      },
      data: {
        status: "CLOSED",
        closedAt: new Date(),
        closeReason: "REMOVED",
      },
    });

    registrarContactoAgente(
      typeof pcName === "string" ? pcName.trim() : null,
      "/api/usb-event/pending-close",
      200
    );
    const res = NextResponse.json({ ok: true, closed: result.count });
    res.headers.set("Cache-Control", "no-store");
    return res;
  } catch (error: any) {
    if (error?.message === "UNAUTHORIZED") {
      registrarContactoAgente(null, "/api/usb-event/pending-close", 401);
      return NextResponse.json(
        { ok: false, error: "No autorizado" },
        { status: 401 }
      );
    }
    logError("Error cerrando pending unlock", error);
    return NextResponse.json(
      { ok: false, error: error.message },
      { status: 500 }
    );
  }
}
