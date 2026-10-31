import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireServiceAuth } from "@/lib/auth";
import { hit } from "@/lib/rateLimit";
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

    if (
      typeof pcName !== "string" ||
      !pcName.trim() ||
      typeof driveLetter !== "string" ||
      !driveLetter.trim()
    ) {
      return NextResponse.json(
        { ok: false, error: "pcName y driveLetter requeridos" },
        { status: 400 }
      );
    }

    const result = await db.pendingUnlock.updateMany({
      where: {
        pcName: pcName.trim(),
        driveLetter: driveLetter.trim(),
        status: { in: ["BLOCKED", "UNLOCKED"] },
        ...(typeof serialNumber === "string" && serialNumber.trim()
          ? { serialNumber: serialNumber.trim() }
          : {}),
      },
      data: {
        status: "CLOSED",
        closedAt: new Date(),
        closeReason: "REMOVED",
      },
    });

    const res = NextResponse.json({ ok: true, closed: result.count });
    res.headers.set("Cache-Control", "no-store");
    return res;
  } catch (error: any) {
    if (error?.message === "UNAUTHORIZED") {
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
