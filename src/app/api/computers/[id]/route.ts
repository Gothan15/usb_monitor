import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireAuth } from "@/lib/auth";

type RouteContext = {
  params: Promise<{
    id: string;
  }>;
};

export async function DELETE(req: Request, context: RouteContext) {
  try {
    await requireAuth(req);

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

    console.error("Error al eliminar computadora:", error);
    return NextResponse.json(
      { ok: false, error: "Error interno del servidor" },
      { status: 500 }
    );
  }
}
