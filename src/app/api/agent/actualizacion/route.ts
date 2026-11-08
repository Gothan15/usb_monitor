import { NextResponse } from "next/server";

import { requireAgentAuth } from "@/lib/agentAuth";
import { db } from "@/lib/db";
import {
  asegurarOrdenActualizacion,
  compararVersiones,
  ESTADOS_ORDEN_ACTIVA,
  TIPO_ORDEN_ACTUALIZAR,
} from "@/lib/agentCommands";
import { logError } from "@/lib/logger";
import { manifiestoPaquete } from "@/lib/paqueteAgente";

/**
 * Actualización pedida por el propio agente (su caja de
 * herramientas), sin pasar por un administrador.
 *
 * GET  -> qué corre este equipo y qué ofrece el panel: versión
 *         del paquete (leída de su PE), si hay actualización y
 *         si ya vive una orden de actualización para él.
 * POST -> deja la orden «actualizar» en ESPERA; el servicio la
 *         recoge en su siguiente llamada de configuración (como
 *         mucho, minutos) y se actualiza solo por el canal de
 *         siempre, verificando el SHA-256 del paquete.
 *
 * Solo vale firmado por UN equipo: la firma identifica al
 * equipo concreto sin lugar a dudas.
 */
async function equipoDeLaPeticion(req: Request) {
  const auth = await requireAgentAuth(req);
  if (!auth.computerId) return null;
  return db.computer.findUnique({
    where: { id: auth.computerId },
    select: { id: true, name: true, agentVersion: true },
  });
}

export async function GET(req: Request) {
  try {
    const computer = await equipoDeLaPeticion(req);
    if (!computer) {
      return NextResponse.json(
        { ok: false, error: "Solo un equipo acreditado puede consultar su actualización" },
        { status: 403 },
      );
    }
    const manifiesto = await manifiestoPaquete();
    const activa = await db.agentCommand.findFirst({
      where: {
        computerId: computer.id,
        type: TIPO_ORDEN_ACTUALIZAR,
        status: { in: ESTADOS_ORDEN_ACTIVA },
      },
      select: { id: true },
    });
    const versionDisponible = manifiesto?.version ?? null;
    return NextResponse.json({
      ok: true,
      versionEquipo: computer.agentVersion,
      versionDisponible,
      hayActualizacion:
        versionDisponible !== null &&
        compararVersiones(versionDisponible, computer.agentVersion) > 0,
      ordenActiva: activa !== null,
    });
  } catch (error: any) {
    if (error?.message === "UNAUTHORIZED") {
      return NextResponse.json({ ok: false, error: "No autorizado" }, { status: 401 });
    }
    logError("Error consultando la actualización del agente", error);
    return NextResponse.json({ ok: false, error: "Error interno" }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const computer = await equipoDeLaPeticion(req);
    if (!computer) {
      return NextResponse.json(
        { ok: false, error: "Solo el token de un equipo puede pedir su actualización" },
        { status: 403 },
      );
    }
    const r = await asegurarOrdenActualizacion(computer.id, computer.agentVersion);
    switch (r.resultado) {
      case "creada":
        return NextResponse.json({
          ok: true,
          estado: "creada",
          versionObjetivo: r.versionObjetivo,
        });
      case "ya-activa":
        return NextResponse.json({
          ok: true,
          estado: "ya-activa",
          versionObjetivo: r.versionObjetivo,
        });
      case "al-dia":
        return NextResponse.json(
          {
            ok: false,
            error: `Este equipo ya corre la versión del paquete (${r.versionObjetivo}).`,
          },
          { status: 409 },
        );
      case "sin-paquete":
        return NextResponse.json(
          { ok: false, error: "El panel no tiene paquete de actualización." },
          { status: 409 },
        );
    }
  } catch (error: any) {
    if (error?.message === "UNAUTHORIZED") {
      return NextResponse.json({ ok: false, error: "No autorizado" }, { status: 401 });
    }
    logError("Error pidiendo la actualización del agente", error);
    return NextResponse.json({ ok: false, error: "Error interno" }, { status: 500 });
  }
}
