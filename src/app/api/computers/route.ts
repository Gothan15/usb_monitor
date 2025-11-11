import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireAuth } from "@/lib/auth";
import { logError } from "@/lib/logger";

export async function GET(req: Request) {
  try {
    await requireAuth(req, { role: "admin", enforceCsrf: false });
    const computers = await db.computer.findMany({
      orderBy: { lastSeen: "desc" },
    });

    return NextResponse.json(computers);
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
