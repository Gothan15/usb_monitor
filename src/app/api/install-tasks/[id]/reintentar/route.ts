import { NextResponse } from "next/server";

import { requireAdminUser } from "@/lib/admin";
import { db } from "@/lib/db";
import { logError } from "@/lib/logger";
import { normalizeComputerName } from "@/lib/utils";
import { reintentarTarea } from "@/lib/installExecutor";

/**
 * POST (admin): reintenta los destinos en ERROR o INTERRUMPIDO
 * de una tarea. La clave se pide otra vez a propósito: nunca
 * quedó guardada, así que un reintento es también una
 * confirmación de credenciales frescas.
 *   { clave, credenciales?: [{pcName, ip, usuario?, clave}] }
 *   `credenciales` trae la clave propia de los destinos que no
 *   usan la general, igual que al crear la tarea.
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
      select: {
        id: true,
        targets: { select: { id: true, pcName: true, ipAddress: true } },
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
