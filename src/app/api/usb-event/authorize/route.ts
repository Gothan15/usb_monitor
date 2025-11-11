import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { verifySessionFromRequest } from "@/lib/auth";
import { notifyServiceUnlock } from "@/lib/serviceNotifier";
import { getCurrentDate } from "@/lib/time";

/**
 * POST /api/usb-event/authorize
 * Autoriza una memoria USB específica para que sea desbloqueada
 */
export async function POST(req: Request) {
  try {
    const session = await verifySessionFromRequest(req);
    if (!session) {
      return NextResponse.json(
        { ok: false, error: "No autenticado" },
        { status: 401 }
      );
    }

    const body = await req.json();
    const { driveLetter } = body;

    if (!driveLetter) {
      return NextResponse.json(
        { ok: false, error: "driveLetter es requerido" },
        { status: 400 }
      );
    }

    // Obtener el usuario con su computadora
    const user = await (db as any).user.findUnique({
      where: { username: session.username },
      include: { computer: true },
    });

    if (!user) {
      return NextResponse.json(
        { ok: false, error: "Usuario no encontrado" },
        { status: 404 }
      );
    }

    if (!user.computer) {
      return NextResponse.json(
        { ok: false, error: "No tiene una computadora asignada" },
        { status: 403 }
      );
    }

    // Buscar el pending unlock correspondiente
    const pendingUnlock = await (db as any).pendingUnlock.findFirst({
      where: {
        pcName: user.computer.name,
        driveLetter: driveLetter,
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
        {
          ok: false,
          error:
            "No se encontró solicitud de desbloqueo pendiente para esta memoria",
        },
        { status: 404 }
      );
    }

    // Marcar como desbloqueado
    await (db as any).pendingUnlock.update({
      where: { id: pendingUnlock.id },
      data: { unlocked: true },
    });

    console.log(
      `Usuario ${user.username} autorizó el desbloqueo de ${driveLetter} en ${user.computer.name}`
    );

    // Notificar al servicio USB en la computadora (push notification)
    const notificationResult = await notifyServiceUnlock(
      user.computer.name,
      driveLetter
    );

    if (!notificationResult.success) {
      console.warn(
        `No se pudo notificar al servicio en ${user.computer.name}: ${notificationResult.error}. El servicio lo detectará por polling.`
      );
    } else {
      console.log(
        `Notificación enviada exitosamente al servicio en ${user.computer.name}`
      );
    }

    return NextResponse.json({
      ok: true,
      message: "Memoria autorizada exitosamente",
      driveLetter: driveLetter,
      pcName: user.computer.name,
      notificationSent: notificationResult.success,
    });
  } catch (error: any) {
    console.error("Error en authorize:", error);
    return NextResponse.json(
      { ok: false, error: error.message },
      { status: 500 }
    );
  }
}
