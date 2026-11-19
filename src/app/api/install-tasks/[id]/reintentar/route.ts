import { NextResponse } from "next/server";

import { requireAdminUser } from "@/lib/admin";
import { db } from "@/lib/db";
import { logError } from "@/lib/logger";
import { normalizeComputerName } from "@/lib/utils";
import { reintentarTarea } from "@/lib/installExecutor";
import {
  ESTADO_DESTINO,
  credencialesCompletas,
} from "@/lib/installTasks";

/**
 * POST (admin): reintenta los destinos en ERROR o INTERRUMPIDO
 * de una tarea. La clave se pide otra vez a propósito: nunca
 * quedó guardada, así que un reintento es también una
 * confirmación de credenciales frescas.
 *   { clave?, credenciales?: [{pcName, ip, usuario?, clave}] }
 *   `credenciales` trae la credencial propia de cada destino
 *   a reintentar, igual que al crear la tarea: cada uno con
 *   la suya completa (su usuario y su clave). La clave
 *   general se acepta por compatibilidad, pero el panel ya
 *   no la manda: no hay cuenta de reserva.
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
  try {
    const tarea = await db.installTask.findUnique({
      where: { id },
      select: {
        id: true,
        username: true,
        targets: {
          select: { id: true, pcName: true, ipAddress: true, status: true },
        },
      },
    });
    if (!tarea) {
      return NextResponse.json(
        { ok: false, error: "Tarea no encontrada" },
        { status: 404 },
      );
    }
    // Las claves propias de destinos concretos, si vienen: se
    // enlazan con la fila del destino, como al crear la tarea.
    const porDestino = new Map<
      string,
      { usuario?: string; clave: string }
    >();
    if (body?.credenciales !== undefined) {
      if (!Array.isArray(body.credenciales)) {
        return NextResponse.json(
          { ok: false, error: "Credenciales por destino inválidas." },
          { status: 400 },
        );
      }
      for (const entrada of body.credenciales) {
        const pcName = normalizeComputerName(
          typeof entrada?.pcName === "string" ? entrada.pcName : "",
        );
        const ip =
          typeof entrada?.ip === "string"
            ? entrada.ip.trim()
            : typeof entrada?.ipAddress === "string"
              ? entrada.ipAddress.trim()
              : "";
        const claveDestino =
          typeof entrada?.clave === "string" ? entrada.clave : "";
        const usuarioDestino =
          typeof entrada?.usuario === "string"
            ? entrada.usuario.trim()
            : "";
        const destino = tarea.targets.find(
          (t) => t.pcName === pcName && t.ipAddress === ip,
        );
        if (!destino || !claveDestino) {
          return NextResponse.json(
            {
              ok: false,
              error:
                "Credenciales por destino inválidas: cada entrada debe ser de un destino de la tarea y traer su clave.",
            },
            { status: 400 },
          );
        }
        porDestino.set(destino.id, {
          ...(usuarioDestino ? { usuario: usuarioDestino } : {}),
          clave: claveDestino,
        });
      }
    }
    // Cobertura del reintento: cada destino a reintentar
    // tiene que resolver a usuario y contraseña. Desde el
    // panel solo llega la credencial propia de cada uno; la
    // regla compartida sigue admitiendo la general (el
    // usuario guardado de la tarea y la clave que llegue)
    // por las tareas creadas cuando había cuenta de reserva.
    // Si a alguno le falta una pieza, su empujón nacería
    // condenado: no se lanza.
    const reintentables = tarea.targets.filter(
      (t) =>
        t.status === ESTADO_DESTINO.ERROR ||
        t.status === ESTADO_DESTINO.INTERRUMPIDO,
    );
    if (
      reintentables.length > 0 &&
      !credencialesCompletas(
        { usuario: tarea.username, clave },
        reintentables.map((t) => porDestino.get(t.id)),
      )
    ) {
      return NextResponse.json(
        {
          ok: false,
          error:
            "Falta credencial para reintentar: escribe la propia de cada equipo (su usuario y su contraseña).",
        },
        { status: 400 },
      );
    }
    const relanzada = await reintentarTarea(id, {
      general: clave,
      porDestino,
    });
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
