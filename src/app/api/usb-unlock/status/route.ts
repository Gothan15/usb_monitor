import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getCurrentDate } from "@/lib/time";
import { requireServiceAuth } from "@/lib/auth";
import { hit } from "@/lib/rateLimit";
import { logError } from "@/lib/logger";

/**
 * GET /api/usb-unlock/status?pcName=XXX&check=true
 * Polling del agente: devuelve los dispositivos de esa PC que ya fueron
 * desbloqueados con contraseña (vía /api/usb-auth) y aún no se aplicaron
 * en la PC. Con check=true los marca como ejecutados (executedAt) para
 * no entregarlos dos veces; el registro NO se borra: queda la auditoría.
 *
 * El antiguo POST de esta ruta (un usuario con sesión marcaba el
 * desbloqueo) desaparece: en el flujo 2FA nadie autoriza a mano; la
 * contraseña se verifica automáticamente en /api/usb-auth.
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

    const pendings = await db.pendingUnlock.findMany({
      where: {
        pcName: normalizedPcName,
        status: "UNLOCKED",
        executedAt: null,
        expiresAt: { gte: getCurrentDate() },
      },
      orderBy: { unlockedAt: "asc" },
      select: {
        id: true,
        driveLetter: true,
        serialNumber: true,
      },
    });

    if (checkInterval && pendings.length > 0) {
      await db.pendingUnlock.updateMany({
        where: { id: { in: pendings.map((p) => p.id) } },
        data: { executedAt: getCurrentDate() },
      });
    }

    const res = NextResponse.json({
      ok: true,
      unlocked: pendings.length > 0,
      driveLetter: pendings[0]?.driveLetter,
      pendings,
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
