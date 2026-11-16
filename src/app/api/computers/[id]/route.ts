import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireAuth } from "@/lib/auth";
import { logError } from "@/lib/logger";

type RouteContext = {
  params: Promise<{
    id: string;
  }>;
};

export async function DELETE(req: Request, context: RouteContext) {
  try {
    await requireAuth(req, { role: "admin" });

    const { params } = context;
    const { id: rawId } = await params;
    const id = rawId?.trim();
    if (!id) {
      return NextResponse.json(
        { ok: false, error: "ID de equipo requerida" },
        { status: 400 }
      );
    }

    const computer = await db.computer.findUnique({ where: { id } });
    if (!computer) {
      return NextResponse.json(
        { ok: false, error: "Equipo no encontrado" },
        { status: 404 }
      );
    }

    // Borrar un equipo es solo borrar su fila: la
    // desinstalación remota está retirada (2026-11-16), así
    // que el agente de esa PC NO se desinstala — queda
    // instalado, pero su credencial deja de valer al irse la
    // fila y ya no puede hablar con el panel. Para quitarlo
    // de la PC hay que desinstalarlo allí mismo
    // (USBMonitorService.exe desinstalar) o re-enrolarlo.
    const [, deletedComputer] = await db.$transaction([
      db.user.updateMany({
        where: { computerId: id },
        data: { computerId: null },
      }),
      db.computer.delete({ where: { id } }),
    ]);

    return NextResponse.json({ ok: true, item: deletedComputer });
  } catch (error) {
    if ((error as any)?.message === "UNAUTHORIZED") {
      return NextResponse.json({ error: "No autorizado" }, { status: 401 });
    }
    if ((error as any)?.message === "FORBIDDEN") {
      return NextResponse.json({ error: "Acceso denegado" }, { status: 403 });
    }

    logError("Error al eliminar computadora", error);
    return NextResponse.json(
      { ok: false, error: "Error interno del servidor" },
      { status: 500 }
    );
  }
}
