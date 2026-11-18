import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireAdminUser } from "@/lib/admin";
import { logError } from "@/lib/logger";
import {
  ESTADOS_ORDEN_ACTIVA,
  TIPO_ORDEN_REINICIAR,
} from "@/lib/agentCommands";
import { broadcastComputerStatus } from "@/lib/socket";

/**
 * POST /api/computers/reiniciar-servicio
 *
 * Crea la orden «reiniciar» para uno o varios equipos (el
 * botón de la fila manda uno; el de la selección manda todos).
 * Al reiniciar, el agente relee la configuración nada más
 * arrancar: los ajustes guardados quedan aplicados al momento.
 *
 * No se crea la orden si el equipo no existe, si no está
 * enrolado (nadie la recogería: quedaría en espera para
 * siempre) o si ya tiene un reinicio en curso. Cada omisión va
 * en la respuesta con su motivo, para que la pestaña lo cuente
 * tal cual en vez de fingir que todo salió.
 */
export async function POST(req: Request) {
  try {
    const admin = await requireAdminUser(req);
    if (!admin) {
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
    const ids: string[] = [];
    if (Array.isArray(body?.ids)) {
      for (const x of body.ids as unknown[]) {
        if (typeof x !== "string") continue;
        const limpio = x.trim();
        if (limpio && !ids.includes(limpio)) ids.push(limpio);
      }
    }
    if (ids.length === 0 || ids.length > 200) {
      return NextResponse.json(
        { ok: false, error: "Lista de equipos inválida" },
        { status: 400 },
      );
    }

    const creadas: { id: string; pcName: string }[] = [];
    const omitidas: { id: string; pcName?: string; motivo: string }[] = [];

    for (const id of ids) {
      const computer = await db.computer.findUnique({
        where: { id },
        select: {
          id: true,
          name: true,
          ipAddress: true,
          lastSeen: true,
          credencialAt: true,
        },
      });
      if (!computer) {
        omitidas.push({ id, motivo: "El equipo ya no existe" });
        continue;
      }
      if (!computer.credencialAt) {
        omitidas.push({
          id,
          pcName: computer.name,
          motivo: "El equipo no está enrolado",
        });
        continue;
      }
      const activa = await db.agentCommand.findFirst({
        where: {
          computerId: computer.id,
          type: TIPO_ORDEN_REINICIAR,
          status: { in: ESTADOS_ORDEN_ACTIVA },
        },
        select: { id: true },
      });
      if (activa) {
        omitidas.push({
          id,
          pcName: computer.name,
          motivo: "Ya tiene un reinicio en curso",
        });
        continue;
      }
      await db.agentCommand.create({
        data: { computerId: computer.id, type: TIPO_ORDEN_REINICIAR },
      });
      creadas.push({ id: computer.id, pcName: computer.name });
      // Que las pestañas de Equipos abiertas enseñen la ruleta
      // del reinicio sin esperar al siguiente refresco.
      broadcastComputerStatus({
        name: computer.name,
        ipAddress: computer.ipAddress ?? "",
        isActive: computer.lastSeen != null,
        lastSeen: (computer.lastSeen ?? new Date(0)).toISOString(),
      });
    }

    const res = NextResponse.json({ ok: true, creadas, omitidas });
    res.headers.set("Cache-Control", "no-store");
    return res;
  } catch (error) {
    logError("Error creando las órdenes de reinicio del servicio", error);
    return NextResponse.json(
      { ok: false, error: "Error interno del servidor" },
      { status: 500 },
    );
  }
}
