import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { verifySessionFromRequest } from "@/lib/auth";
import { getCurrentDate } from "@/lib/time";

/**
 * POST /api/usb-unlock
 * Endpoint para desbloquear un USB pendiente después de autenticación exitosa
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

    const { pcName } = await req.json();

    if (!pcName) {
      return NextResponse.json(
        { ok: false, error: "pcName requerido" },
        { status: 400 }
      );
    }

    // Buscar el unlock pendiente más reciente para esta PC
    const pendingUnlock = await (db as any).pendingUnlock.findFirst({
      where: {
        pcName: pcName,
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
      where: { username: session.username },
      select: { role: true },
    });

    return NextResponse.json({
      ok: true,
      role: user?.role || "user",
      driveLetter: pendingUnlock.driveLetter,
      message: "USB desbloqueado correctamente",
    });
  } catch (error: any) {
    console.error("Error en usb-unlock:", error);
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
    const { searchParams } = new URL(req.url);
    const pcName = searchParams.get("pcName");
    const checkInterval = searchParams.get("check") === "true";

    if (!pcName) {
      return NextResponse.json(
        { ok: false, error: "pcName requerido" },
        { status: 400 }
      );
    }

    // Verificar API Key para el servicio
    const apiKey = req.headers.get("authorization")?.replace("ApiKey ", "");
    if (apiKey) {
      const user = await (db as any).user.findUnique({
        where: { apiKey },
      });
      if (!user) {
        return NextResponse.json(
          { ok: false, error: "API Key inválida" },
          { status: 401 }
        );
      }
    }

    const unlock = await (db as any).pendingUnlock.findFirst({
      where: {
        pcName: pcName,
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

    return NextResponse.json({
      ok: true,
      unlocked: !!unlock,
      driveLetter: unlock?.driveLetter,
    });
  } catch (error: any) {
    console.error("Error en usb-unlock status:", error);
    return NextResponse.json(
      { ok: false, error: error.message },
      { status: 500 }
    );
  }
}
