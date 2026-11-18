import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireAdminUser } from "@/lib/admin";
import { logError } from "@/lib/logger";

/** DELETE: quita un destino de la lista guardada. */
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const admin = await requireAdminUser(req);
    if (!admin) {
      return NextResponse.json({ error: "No autorizado" }, { status: 401 });
    }
    const { id } = await params;
    await db.destinoGuardado.delete({ where: { id } }).catch(() => null);
    return NextResponse.json({ ok: true });
  } catch (error) {
    logError("Error en DELETE /api/destinos-guardados/[id]", error);
    return NextResponse.json(
      { error: "No se pudo quitar el destino" },
      { status: 500 },
    );
  }
}
