import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireAuth } from "@/lib/auth";
import { logError } from "@/lib/logger";
import {
  accionAlBorrarEquipo,
  ESTADOS_ORDEN_ACTIVA,
  TIPO_ORDEN_DESINSTALAR,
} from "@/lib/agentCommands";

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

    // Con agente enrolado, borrar el equipo también lo
    // desinstala en su PC: se le deja la orden «desinstalar» y la
    // fila se borra cuando el agente la informe HECHA (la orden
    // le espera si la PC está apagada). La lista ya no lo enseña
    // mientras la orden viva. Sin credencial, borrado directo.
    const ordenActiva = computer.clavePublica
      ? await db.agentCommand.findFirst({
          where: {
            computerId: id,
            type: TIPO_ORDEN_DESINSTALAR,
            status: { in: ESTADOS_ORDEN_ACTIVA },
          },
          select: { id: true },
        })
      : null;
    const accion = accionAlBorrarEquipo(
      Boolean(computer.clavePublica),
      Boolean(ordenActiva),
    );
    if (accion !== "borrar") {
      if (accion === "pedir-desinstalacion") {
        await db.agentCommand.create({
          data: { computerId: id, type: TIPO_ORDEN_DESINSTALAR },
        });
      }
      return NextResponse.json({
        ok: true,
        item: computer,
        desinstalacionPedida: true,
      });
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
