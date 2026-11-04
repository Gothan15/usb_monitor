import { NextResponse } from "next/server";

import { requireAdminUser } from "@/lib/admin";
import { db } from "@/lib/db";
import { logError } from "@/lib/logger";
import { reintentarTarea } from "@/lib/installExecutor";

/**
 * POST (admin): reintenta los destinos en ERROR o INTERRUMPIDO
 * de una tarea. La clave se pide otra vez a propósito: nunca
 * quedó guardada, así que un reintento es también una
 * confirmación de credenciales frescas.
 *   { clave }
 */
export async function POST(
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
  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(
      { ok: false, error: "Cuerpo inválido" },
      { status: 400 },
    );
  }
  const clave = typeof body?.clave === "string" ? body.clave : "";
  if (!clave) {
    return NextResponse.json(
      {
        ok: false,
        error:
          "La clave de la cuenta es requerida para reintentar (no se guardó de la vez anterior).",
      },
      { status: 400 },
    );
  }
  try {
    const tarea = await db.installTask.findUnique({
      where: { id },
      select: { id: true },
    });
    if (!tarea) {
      return NextResponse.json(
        { ok: false, error: "Tarea no encontrada" },
        { status: 404 },
      );
    }
    const relanzada = await reintentarTarea(id, clave);
    if (!relanzada) {
      return NextResponse.json(
        {
          ok: false,
          error: "Esta tarea no tiene destinos en error o interrumpidos.",
        },
        { status: 409 },
      );
    }
    const res = NextResponse.json({ ok: true });
    res.headers.set("Cache-Control", "no-store");
    return res;
  } catch (error: any) {
    logError("Error reintentando tarea de instalación", error);
    return NextResponse.json(
      { ok: false, error: error.message },
      { status: 500 },
    );
  }
}
