import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireAuth } from "@/lib/auth";
import { logError } from "@/lib/logger";

/**
 * GET /api/admin/evidence/[id]/image
 * La captura de pantalla de la evidencia de un bloqueo ([id] = id
 * del bloqueo), con su tipo de contenido. 404 si el bloqueo no
 * tiene evidencia o la evidencia llegó sin imagen (p. ej. la sesión
 * estaba bloqueada al conectar el dispositivo).
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    await requireAuth(req, { role: "admin" });
    const { id } = await params;

    const evidencia = await db.blockEvidence.findFirst({
      where: { pendingUnlockId: id, image: { not: null } },
      orderBy: { capturedAt: "desc" },
      select: { image: true, imageMime: true },
    });
    if (!evidencia?.image) {
      return NextResponse.json(
        { error: "Este bloqueo no tiene captura de pantalla" },
        { status: 404 }
      );
    }

    return new NextResponse(new Uint8Array(evidencia.image), {
      headers: {
        "Content-Type": evidencia.imageMime ?? "image/jpeg",
        "Cache-Control": "private, max-age=300",
      },
    });
  } catch (error: any) {
    if (error?.message === "UNAUTHORIZED" || error?.message === "FORBIDDEN") {
      return NextResponse.json({ error: "No autorizado" }, { status: 401 });
    }
    logError("Error en /api/admin/evidence/[id]/image", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
