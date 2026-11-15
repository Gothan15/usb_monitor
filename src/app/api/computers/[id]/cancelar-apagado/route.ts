import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireAdminUser } from "@/lib/admin";
import { logError } from "@/lib/logger";
import {
  ESTADOS_ORDEN_ACTIVA,
  TIPO_ORDEN_CANCELAR_APAGADO,
} from "@/lib/agentCommands";

type RouteContext = {
  params: Promise<{
    id: string;
  }>;
};

/**
 * POST /api/computers/:id/cancelar-apagado
 *
 * Crea la orden «cancelar-apagado» para que el agente detenga
 * la cuenta atrás de apagado en curso en ese equipo. El agente
 * la recoge en el siguiente sondeo de configuración — y con
 * una cuenta en curso ese sondeo corre cada pocos segundos —.
 * Si ya hay una orden viva del mismo tipo, se devuelve esa en
 * vez de duplicarla: detener dos veces es lo mismo que una.
 */
export async function POST(req: Request, context: RouteContext) {
  try {
    const admin = await requireAdminUser(req);
    if (!admin) {
      return NextResponse.json(
        { ok: false, error: "No autorizado" },
        { status: 401 },
      );
    }

    const { id: rawId } = await context.params;
    const id = rawId?.trim();
    if (!id) {
      return NextResponse.json(
        { ok: false, error: "ID de equipo requerida" },
        { status: 400 },
      );
    }

    const computer = await db.computer.findUnique({ where: { id } });
    if (!computer) {
      return NextResponse.json(
        { ok: false, error: "Equipo no encontrado" },
        { status: 404 },
      );
    }

    const activa = await db.agentCommand.findFirst({
      where: {
        computerId: computer.id,
        type: TIPO_ORDEN_CANCELAR_APAGADO,
        status: { in: ESTADOS_ORDEN_ACTIVA },
      },
      select: { id: true, status: true },
    });
    if (activa) {
      return NextResponse.json({
        ok: true,
        pcName: computer.name,
        comando: activa,
        existente: true,
      });
    }

    const comando = await db.agentCommand.create({
      data: {
        computerId: computer.id,
        type: TIPO_ORDEN_CANCELAR_APAGADO,
      },
      select: { id: true, status: true, createdAt: true },
    });
    const res = NextResponse.json({
      ok: true,
      pcName: computer.name,
      comando,
      existente: false,
    });
    res.headers.set("Cache-Control", "no-store");
    return res;
  } catch (error) {
    logError("Error creando la orden de cancelar el apagado", error);
    return NextResponse.json(
      { ok: false, error: "Error interno del servidor" },
      { status: 500 },
    );
  }
}
