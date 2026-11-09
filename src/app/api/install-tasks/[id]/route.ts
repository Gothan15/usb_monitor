import { NextResponse } from "next/server";

import { requireAdminUser } from "@/lib/admin";
import { db } from "@/lib/db";
import { logError } from "@/lib/logger";
import { tareaEnEjecucion } from "@/lib/installExecutor";
import { tareaPuedeBorrarse } from "@/lib/installTasks";

/**
 * DELETE (admin): borra UNA tarea de instalación terminada,
 * con sus destinos (la relación borra en cascada). Las tareas
 * se acumulaban sin forma de quitarlas de la vista.
 *
 * Una tarea viva no se borra: ni EN_CURSO, ni con destinos a
 * medias, ni con el ejecutor de este proceso entre manos —
 * borrarla dejaría empujones corriendo contra filas que ya
 * no existen. Para una tarea atascada en curso, el camino es
 * dejar que acabe o reiniciar el panel (al arrancar, lo que
 * quedó a medias pasa a INTERRUMPIDO y ya se puede borrar).
 */
export async function DELETE(
  req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const admin = await requireAdminUser(req);
  if (!admin) {
    return NextResponse.json(
      { ok: false, error: "No autorizado" },
      { status: 401 },
    );
  }
  const { id } = await ctx.params;
  try {
    const tarea = await db.installTask.findUnique({
      where: { id },
      select: {
        id: true,
        status: true,
        targets: { select: { status: true } },
      },
    });
    if (!tarea) {
      return NextResponse.json(
        { ok: false, error: "Tarea no encontrada" },
        { status: 404 },
      );
    }
    const puede = tareaPuedeBorrarse({
      status: tarea.status,
      estadosDestinos: tarea.targets.map((t) => t.status),
      enEjecucion: tareaEnEjecucion(id),
    });
    if (!puede) {
      return NextResponse.json(
        {
          ok: false,
          error:
            "Esta tarea aún está en curso y no se puede borrar. Espera a que termine; si quedó atascada, reinicia el panel y lo que quedara a medias pasará a interrumpido.",
        },
        { status: 409 },
      );
    }
    await db.installTask.delete({ where: { id } });
    const res = NextResponse.json({ ok: true });
    res.headers.set("Cache-Control", "no-store");
    return res;
  } catch (error: any) {
    logError("Error borrando tarea de instalación", error);
    return NextResponse.json(
      { ok: false, error: error.message },
      { status: 500 },
    );
  }
}
