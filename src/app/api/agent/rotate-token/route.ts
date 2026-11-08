import { createHash, randomBytes } from "crypto";

import { NextResponse } from "next/server";

import { requireServiceAuth } from "@/lib/auth";
import { db } from "@/lib/db";
import { logError } from "@/lib/logger";

/**
 * POST /api/agent/rotate-token  (Authorization: AgentToken ...)
 *
 * Rotación del token pedida por el propio agente (la automática
 * diaria y la manual desde sus ventanas). No hay corte: el token
 * nuevo se guarda como EN ESPERA y el actual sigue valiendo; el
 * agente guarda el nuevo y lo usa en su siguiente petición, y
 * ese primer uso lo promueve a principal matando al viejo (ver
 * authenticateAgentToken en lib/auth). Si el nuevo nunca se usa,
 * caduca a las 24 h y el viejo nunca dejó de valer.
 *
 * Solo vale con el token de UN equipo: las claves de servicio del
 * operador no tienen equipo asociado y se rechazan.
 */
export async function POST(req: Request) {
  try {
    const auth = await requireServiceAuth(req);
    if (!auth.computerId) {
      return NextResponse.json(
        { ok: false, error: "Solo el token de un equipo puede rotarse" },
        { status: 403 }
      );
    }
    const token = randomBytes(32).toString("hex");
    const hash = createHash("sha256").update(token, "utf8").digest("hex");
    await db.computer.update({
      where: { id: auth.computerId },
      data: { agentTokenPendingHash: hash, agentTokenPendingAt: new Date() },
    });
    return NextResponse.json({ ok: true, token });
  } catch (error: any) {
    if (error?.message === "UNAUTHORIZED") {
      return NextResponse.json(
        { ok: false, error: "No autorizado" },
        { status: 401 }
      );
    }
    logError("Error rotando el token de un agente", error);
    return NextResponse.json(
      { ok: false, error: "Error interno" },
      { status: 500 }
    );
  }
}
