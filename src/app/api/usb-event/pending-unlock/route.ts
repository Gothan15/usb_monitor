import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { addMillisecondsToNow } from "@/lib/time";
import { requireServiceAuth } from "@/lib/auth";
import { hit } from "@/lib/rateLimit";
import { logError } from "@/lib/logger";

/**
 * POST /api/usb-event/pending-unlock
 * El agente registra un dispositivo bloqueado que espera la contraseña
 * del dueño de la PC (o del admin). No es una aprobación: es el estado
 * interno del flujo 2FA (ver plan-desbloqueo-por-contrasena).
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

    const { pcName, driveLetter, serialNumber, deviceLabel, whitelisted } =
      await req.json();

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

    const computer = await db.computer.findUnique({
      where: { name: normalizedPcName },
      select: { id: true },
    });

    // Un bloqueo nuevo en la misma unidad sustituye al anterior que
    // siguiera esperando contraseña (p. ej. reinicio del servicio).
    await db.pendingUnlock.updateMany({
      where: {
        pcName: normalizedPcName,
        driveLetter: normalizedDriveLetter,
        status: "BLOCKED",
      },
      data: {
        status: "CLOSED",
        closedAt: new Date(),
        closeReason: "REPLACED",
      },
    });

    const pendingUnlock = await db.pendingUnlock.create({
      data: {
        computerId: computer?.id ?? null,
        pcName: normalizedPcName,
        driveLetter: normalizedDriveLetter,
        serialNumber:
          typeof serialNumber === "string" && serialNumber.trim()
            ? serialNumber.trim()
            : null,
        deviceLabel:
          typeof deviceLabel === "string" && deviceLabel.trim()
            ? deviceLabel.trim()
            : null,
        whitelisted: whitelisted === true,
        status: "BLOCKED",
        // El permiso de uso termina al extraer el dispositivo (fase 2);
        // esta validez amplia solo caduca bloqueos olvidados.
        expiresAt: addMillisecondsToNow(24 * 60 * 60 * 1000),
      },
    });

    const res = NextResponse.json({
      ok: true,
      id: pendingUnlock.id,
      message: "Dispositivo bloqueado registrado",
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
