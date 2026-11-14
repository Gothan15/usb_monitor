import { NextResponse } from "next/server";

import { requireAdminUser } from "@/lib/admin";
import { db } from "@/lib/db";
import { logError } from "@/lib/logger";
import { ESTADO_ORDEN, sePuedeCancelar } from "@/lib/agentCommands";
import { getCurrentDate } from "@/lib/time";

/**
 * POST /api/agent/comandos/:id/cancelar — el administrador
 * cancela una orden viva («actualizar» o «desinstalar»).
 *
 * La orden queda CANCELADA, estado terminal: sale de las activas
 * (el panel ya no la sirve como viva) y durante unos minutos la
 * configuración la sigue enseñando marcada, para que el agente
 * que la esté ejecutando la abandone en su punto de control. Si
 * el agente aún no la había empezado, no llega a ejecutarla.
 * Cancelar una «desinstalar» devuelve el equipo a la lista de
 * Equipos: su fila solo se borra cuando la orden llega a HECHA.
 */
export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const admin = await requireAdminUser(req);
  if (!admin) {
    return NextResponse.json(
      { ok: false, error: "No autorizado" },
      { status: 401 },
    );
  }
  const { id } = await params;
  try {
    const comando = await db.agentCommand.findUnique({
      where: { id },
      select: { id: true, status: true, type: true },
    });
    if (!comando) {
      return NextResponse.json(
        { ok: false, error: "Orden no encontrada" },
        { status: 404 },
      );
    }
    if (!sePuedeCancelar(comando.status)) {
      return NextResponse.json(
        {
          ok: false,
          error: `La orden ya terminó (${comando.status.toLowerCase()}): no se puede cancelar.`,
        },
        { status: 409 },
      );
    }
    const actualizado = await db.agentCommand.update({
      where: { id },
      data: {
        status: ESTADO_ORDEN.CANCELADA,
        finishedAt: getCurrentDate(),
        detail: "Cancelada por el administrador.",
      },
      select: { id: true, status: true, type: true },
    });
    const res = NextResponse.json({ ok: true, comando: actualizado });
    res.headers.set("Cache-Control", "no-store");
    return res;
  } catch (error) {
    logError("Error cancelando la orden del agente", error);
    return NextResponse.json(
      { ok: false, error: "Error interno del servidor" },
      { status: 500 },
    );
  }
}
