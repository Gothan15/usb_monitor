import { NextResponse } from "next/server";

import { requireServiceAuth } from "@/lib/auth";
import { db } from "@/lib/db";
import { logError } from "@/lib/logger";
import { registrarContactoAgente } from "@/lib/agentDebug";
import {
  ESTADO_ORDEN,
  MAX_INTENTOS_ORDEN,
  transicionInformeValida,
} from "@/lib/agentCommands";
import { getCurrentDate } from "@/lib/time";

/**
 * POST /api/agent/comandos/:id — informe del agente sobre su orden.
 *
 * Cuerpo: { estado: "EN_CURSO" | "HECHA" | "ERROR", detalle?,
 *           versionObjetivo? }
 * La orden tiene que ser del equipo dueño del token (la identidad
 * de servicio trae su computerId); con una clave de servicio del
 * operador no se puede informar en nombre de un equipo.
 * EN_CURSO suma un intento y fija startedAt (y la versión objetivo
 * si el agente la manda: sale de su manifiesto descargado).
 */
export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  try {
    const serviceAuth = await requireServiceAuth(req);
    if (!serviceAuth.computerId) {
      return NextResponse.json(
        { ok: false, error: "No autorizado" },
        { status: 401 },
      );
    }
    let body: any;
    try {
      body = await req.json();
    } catch {
      return NextResponse.json(
        { ok: false, error: "Cuerpo inválido" },
        { status: 400 },
      );
    }
    const estado =
      typeof body?.estado === "string" ? body.estado.trim().toUpperCase() : "";
    const detalle =
      typeof body?.detalle === "string"
        ? body.detalle.trim().slice(0, 500)
        : null;
    const versionObjetivo =
      typeof body?.versionObjetivo === "string" && body.versionObjetivo.trim()
        ? body.versionObjetivo.trim().slice(0, 32)
        : null;

    const comando = await db.agentCommand.findUnique({
      where: { id },
      select: { id: true, computerId: true, status: true, attempts: true },
    });
    if (!comando || comando.computerId !== serviceAuth.computerId) {
      return NextResponse.json(
        { ok: false, error: "Orden no encontrada" },
        { status: 404 },
      );
    }
    if (!transicionInformeValida(comando.status, estado)) {
      return NextResponse.json(
        {
          ok: false,
          error: `Transición no válida: ${comando.status} → ${estado}`,
        },
        { status: 409 },
      );
    }
    if (
      estado === ESTADO_ORDEN.EN_CURSO &&
      comando.attempts >= MAX_INTENTOS_ORDEN
    ) {
      return NextResponse.json(
        { ok: false, error: "La orden agotó sus intentos" },
        { status: 409 },
      );
    }

    const ahora = getCurrentDate();
    const actualizado = await db.agentCommand.update({
      where: { id },
      data: {
        status: estado,
        ...(detalle ? { detail: detalle } : {}),
        ...(estado === ESTADO_ORDEN.EN_CURSO
          ? {
              attempts: { increment: 1 },
              startedAt: comando.status === ESTADO_ORDEN.EN_CURSO ? undefined : ahora,
              ...(versionObjetivo ? { targetVersion: versionObjetivo } : {}),
            }
          : {}),
        ...(estado === ESTADO_ORDEN.HECHA || estado === ESTADO_ORDEN.ERROR
          ? { finishedAt: ahora }
          : {}),
      },
      select: { id: true, status: true, attempts: true },
    });
    registrarContactoAgente(null, "/api/agent/comandos", 200);
    const res = NextResponse.json({ ok: true, comando: actualizado });
    res.headers.set("Cache-Control", "no-store");
    return res;
  } catch (error: any) {
    if (error?.message === "UNAUTHORIZED") {
      registrarContactoAgente(null, "/api/agent/comandos", 401);
      return NextResponse.json(
        { ok: false, error: "No autorizado" },
        { status: 401 },
      );
    }
    logError("Error informando orden del agente", error);
    return NextResponse.json(
      { ok: false, error: error.message },
      { status: 500 },
    );
  }
}
