import { NextResponse } from "next/server";
import { db } from "@/lib/db";

/**
 * POST /api/usb-event/pending-unlock
 * Crea un registro de desbloqueo pendiente cuando se detecta un USB
 */
export async function POST(req: Request) {
  try {
    // Verificar API Key
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

    const { pcName, driveLetter } = await req.json();

    if (!pcName || !driveLetter) {
      return NextResponse.json(
        { ok: false, error: "pcName y driveLetter requeridos" },
        { status: 400 }
      );
    }

    // Crear registro de desbloqueo pendiente (expira en 10 minutos)
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000);

    const pendingUnlock = await (db as any).pendingUnlock.create({
      data: {
        pcName,
        driveLetter,
        expiresAt,
        unlocked: false,
      },
    });

    return NextResponse.json({
      ok: true,
      id: pendingUnlock.id,
      message: "Desbloqueo pendiente creado",
    });
  } catch (error: any) {
    console.error("Error creando pending unlock:", error);
    return NextResponse.json(
      { ok: false, error: error.message },
      { status: 500 }
    );
  }
}
