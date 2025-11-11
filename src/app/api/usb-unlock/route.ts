import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getCurrentDate } from "@/lib/time";
import { requireAuth, requireServiceAuth } from "@/lib/auth";
import { hit } from "@/lib/rateLimit";
import { logError } from "@/lib/logger";

/**
 * POST /api/usb-unlock
 * Endpoint para desbloquear un USB pendiente después de autenticación exitosa
 */
export async function POST(req: Request) {
  try {
    const auth = await requireAuth(req);

    const clientIp =
      (req.headers.get("x-forwarded-for") || "").split(",")[0].trim() ||
      "unknown";
    const limit = await hit(
      "usb-unlock-confirm",
      { windowMs: 5000, max: 10 },
      { userId: auth.userId, ip: clientIp }
    );
    if (!limit.allowed) {
      return NextResponse.json(
        { ok: false, error: "Rate limit" },
        { status: 429 }
      );
    }

    const { pcName } = await req.json();

    if (typeof pcName !== "string" || !pcName.trim()) {
      return NextResponse.json(
        { ok: false, error: "pcName requerido" },
        { status: 400 }
      );
    }
    const normalizedPcName = pcName.trim();
    // Buscar el unlock pendiente más reciente para esta PC
    const pendingUnlock = await (db as any).pendingUnlock.findFirst({
      where: {
        pcName: normalizedPcName,
        unlocked: false,
        expiresAt: {
          gte: getCurrentDate(),
        },
      },
      orderBy: {
        createdAt: "desc",
      },
    });

    if (!pendingUnlock) {
      return NextResponse.json(
        { ok: false, error: "No hay desbloqueos pendientes para esta PC" },
        { status: 404 }
      );
    }

    // Marcar como desbloqueado
    await (db as any).pendingUnlock.update({
      where: { id: pendingUnlock.id },
      data: { unlocked: true },
    });

    // Obtener el rol del usuario
    const user = await (db as any).user.findUnique({
      where: { id: auth.userId },
      select: { role: true },
    });

    const res = NextResponse.json({
      ok: true,
      role: user?.role || "user",
      driveLetter: pendingUnlock.driveLetter,
      message: "USB desbloqueado correctamente",
    });
    res.headers.set("Cache-Control", "no-store");
    return res;
  } catch (error: any) {
    if (error?.message === "UNAUTHORIZED")
      return NextResponse.json(
        { ok: false, error: "No autorizado" },
        { status: 401 }
      );
    if (error?.message === "FORBIDDEN")
      return NextResponse.json(
        { ok: false, error: "Acceso denegado" },
        { status: 403 }
      );
    if (error?.code === "CSRF_INVALID" || error?.code === "CSRF_MISSING") {
      return NextResponse.json(
        { ok: false, error: "CSRF inválido" },
        { status: 403 }
      );
    }
    logError("Error en usb-unlock (POST)", error);
    return NextResponse.json(
      { ok: false, error: error.message },
      { status: 500 }
    );
  }
}

/**
 * GET /api/usb-unlock/status?pcName=XXX
 * Verifica si hay un desbloqueo pendiente que ya fue autorizado
 */
export async function GET(req: Request) {
  try {
    const auth = await requireServiceAuth(req);
    const { searchParams } = new URL(req.url);
    const pcName = searchParams.get("pcName");
    const checkInterval = searchParams.get("check") === "true";

    if (!pcName || !pcName.trim()) {
      return NextResponse.json(
        { ok: false, error: "pcName requerido" },
        { status: 400 }
      );
    }

    const normalizedPcName = pcName.trim();

    const clientIp =
      (req.headers.get("x-forwarded-for") || "").split(",")[0].trim() ||
      "unknown";
    const rl = await hit(
      "usb-unlock-status",
      { windowMs: 2000, max: 15 },
      { serviceId: auth.serviceId, identifier: normalizedPcName, ip: clientIp }
    );
    if (!rl.allowed) {
      return NextResponse.json(
        { ok: false, error: "Rate limit" },
        { status: 429 }
      );
    }

    const unlock = await (db as any).pendingUnlock.findFirst({
      where: {
        pcName: normalizedPcName,
        unlocked: true,
        expiresAt: {
          gte: getCurrentDate(),
        },
      },
      orderBy: {
        createdAt: "desc",
      },
    });

    // Si hay un unlock autorizado, eliminarlo después de devolverlo
    // para evitar que se procese múltiples veces
    if (unlock && checkInterval) {
      await (db as any).pendingUnlock.delete({
        where: { id: unlock.id },
      });
      console.log(
        `PendingUnlock ${unlock.id} eliminado después de ser procesado`
      );
    }

    const res = NextResponse.json({
      ok: true,
      unlocked: !!unlock,
      driveLetter: unlock?.driveLetter,
    });
    res.headers.set("Cache-Control", "no-store");
    return res;
  } catch (error: any) {
    if (error?.message === "UNAUTHORIZED")
      return NextResponse.json(
        { ok: false, error: "No autorizado" },
        { status: 401 }
      );
    logError("Error en usb-unlock status", error);
    return NextResponse.json(
      { ok: false, error: error.message },
      { status: 500 }
    );
  }
}
