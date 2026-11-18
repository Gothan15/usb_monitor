import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireAuth } from "@/lib/auth";
import { logError } from "@/lib/logger";

/**
 * GET /api/admin/unlocks/conteo
 * Solo el número de dispositivos bloqueados ahora mismo: lo
 * pide la medalla de la pestaña «Desbloqueos» en la navegación,
 * que se refresca cada minuto sin cargar la vista entera.
 */
export async function GET(req: NextRequest) {
  try {
    await requireAuth(req, { role: "admin" });
    const bloqueados = await db.pendingUnlock.count({
      where: { status: "BLOCKED" },
    });
    return NextResponse.json({ ok: true, bloqueados });
  } catch (error: any) {
    if (error?.message === "UNAUTHORIZED" || error?.message === "FORBIDDEN") {
      return NextResponse.json({ error: "No autorizado" }, { status: 401 });
    }
    logError("Error en GET /api/admin/unlocks/conteo", error);
    return NextResponse.json(
      { error: "No se pudo contar los bloqueos" },
      { status: 500 },
    );
  }
}
