import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireAuth } from "@/lib/auth";
import { logError } from "@/lib/logger";

export async function GET(req: Request) {
  try {
    await requireAuth(req, { role: "admin", enforceCsrf: false });
    const { searchParams } = new URL(req.url);
    const page = parseInt(searchParams.get("page") || "1");
    const limit = parseInt(searchParams.get("limit") || "50");
    const skip = (page - 1) * limit;

    const [total, computers] = await Promise.all([
      db.computer.count(),
      db.computer.findMany({
        orderBy: { lastSeen: "desc" },
        skip,
        take: limit,
      }),
    ]);

    return NextResponse.json({
      data: computers,
      meta: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      },
    });
  } catch (error) {
    if ((error as any)?.message === "UNAUTHORIZED")
      return NextResponse.json({ error: "No autorizado" }, { status: 401 });
    if ((error as any)?.message === "FORBIDDEN")
      return NextResponse.json({ error: "Acceso denegado" }, { status: 403 });
    logError("Error al obtener computadoras", error);
    return NextResponse.json(
      { error: "Error interno del servidor" },
      { status: 500 }
    );
  }
}
