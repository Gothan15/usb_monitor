import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireAuth } from "@/lib/auth";
import { logError } from "@/lib/logger";

/**
 * GET /api/admin/evidence/[id]
 * Metadatos de la evidencia de un bloqueo: [id] es el id del
 * bloqueo (PendingUnlock), no el de la evidencia. La imagen no viaja
 * aquí: va por /api/admin/evidence/[id]/image para que el navegador
 * la cachee como lo que es, una imagen.
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    await requireAuth(req, { role: "admin" });
    const { id } = await params;

    const evidencia = await db.blockEvidence.findFirst({
      where: { pendingUnlockId: id },
      orderBy: { capturedAt: "desc" },
    });
    if (!evidencia) {
      return NextResponse.json(
        { ok: false, error: "Sin evidencia para este bloqueo" },
        { status: 404 }
      );
    }

    return NextResponse.json({
      ok: true,
      evidence: {
        id: evidencia.id,
        pendingUnlockId: evidencia.pendingUnlockId,
        computerName: evidencia.computerName,
        serialNumber: evidencia.serialNumber,
        capturedAt: evidencia.capturedAt,
        foregroundProcess: evidencia.foregroundProcess,
        foregroundTitle: evidencia.foregroundTitle,
        processes: evidencia.processes,
        browserTabs: evidencia.browserTabs,
        tabsComplete: evidencia.tabsComplete,
        nota: evidencia.nota,
        hasImage: evidencia.image !== null,
        imageMime: evidencia.imageMime,
      },
    });
  } catch (error: any) {
    if (error?.message === "UNAUTHORIZED" || error?.message === "FORBIDDEN") {
      return NextResponse.json({ error: "No autorizado" }, { status: 401 });
    }
    logError("Error en /api/admin/evidence/[id]", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
