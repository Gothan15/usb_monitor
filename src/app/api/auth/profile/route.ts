import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
import { db } from "@/lib/db";
import { logError } from "@/lib/logger";

export async function GET(req: Request) {
  try {
    const auth = await requireAuth(req, { enforceCsrf: false });

    const user = await (db as any).user.findUnique({
      where: { id: auth.userId },
      select: {
        id: true,
        username: true,
        role: true,
        apiKey: true,
      },
    });

    if (!user) {
      return NextResponse.json(
        { ok: false, error: "Usuario no encontrado" },
        { status: 404 }
      );
    }

    const res = NextResponse.json({
      ok: true,
      user,
    });
    res.headers.set("Cache-Control", "no-store");
    return res;
  } catch (error: any) {
    if (error?.message === "UNAUTHORIZED") {
      return NextResponse.json(
        { ok: false, error: "No autenticado" },
        { status: 401 }
      );
    }
    if (error?.message === "FORBIDDEN") {
      return NextResponse.json(
        { ok: false, error: "Acceso denegado" },
        { status: 403 }
      );
    }
    logError("Error obteniendo perfil", error);
    return NextResponse.json(
      { ok: false, error: error?.message || "Error interno" },
      { status: 500 }
    );
  }
}

export const dynamic = "force-dynamic";
