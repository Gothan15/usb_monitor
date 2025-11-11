import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { addMillisecondsToNow } from "@/lib/time";
import { requireServiceAuth } from "@/lib/auth";
import { hit } from "@/lib/rateLimit";
import { logError } from "@/lib/logger";

/**
 * POST /api/usb-event/pending-unlock
 * Crea un registro de desbloqueo pendiente cuando se detecta un USB
 */
export async function POST(req: Request) {
  try {
    const serviceAuth = await requireServiceAuth(req);

    const clientIp =
      (req.headers.get("x-forwarded-for") || "").split(",")[0].trim() ||
      "unknown";
    const rate = await hit(
      "usb-pending-unlock",
      { windowMs: 5_000, max: 8 },
      { serviceId: serviceAuth.serviceId, ip: clientIp }
    );
    if (!rate.allowed) {
      return NextResponse.json(
        { ok: false, error: "Rate limit" },
        { status: 429 }
      );
    }

    const { pcName, driveLetter } = await req.json();

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

    const normalizedPcName = pcName.trim();
    const normalizedDriveLetter = driveLetter.trim();

    // Crear registro de desbloqueo pendiente (expira en 10 minutos)
    const expiresAt = addMillisecondsToNow(10 * 60 * 1000);

    const pendingUnlock = await (db as any).pendingUnlock.create({
      data: {
        pcName: normalizedPcName,
        driveLetter: normalizedDriveLetter,
        expiresAt,
        unlocked: false,
      },
    });

    const res = NextResponse.json({
      ok: true,
      id: pendingUnlock.id,
      message: "Desbloqueo pendiente creado",
    });
    res.headers.set("Cache-Control", "no-store");
    return res;
  } catch (error: any) {
    if (error?.message === "UNAUTHORIZED") {
      return NextResponse.json(
        { ok: false, error: "No autorizado" },
        { status: 401 }
      );
    }
    logError("Error creando pending unlock", error);
    return NextResponse.json(
      { ok: false, error: error.message },
      { status: 500 }
    );
  }
}
