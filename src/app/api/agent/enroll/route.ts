import { createHash, randomBytes } from "crypto";

import { NextResponse } from "next/server";

import { db } from "@/lib/db";
import { verifyEnrollKey } from "@/lib/enrollKey";
import { logError } from "@/lib/logger";
import { hit } from "@/lib/rateLimit";
import { normalizeComputerName } from "@/lib/utils";

/**
 * POST /api/agent/enroll  { pcName, key }
 *
 * Enrolamiento de un agente nuevo con la clave de la flota: el
 * equipo se presenta con la clave de enrolamiento (la que el
 * administrador generó en Ajustes) y el panel le emite SU token
 * propio, que se devuelve en claro en esta única respuesta para
 * que el agente lo guarde cifrado en su PC. En el servidor solo
 * queda el hash, como con los tokens provisionados a mano.
 *
 * Enrolar un equipo que ya tenía token lo ROTA: el nuevo pasa a
 * ser el principal al instante (la petición que lo trae ya es la
 * prueba de posesión de la clave) y cualquier pendiente muere.
 * Sin clave vigente configurada, la ruta rechaza todo.
 */
export async function POST(req: Request) {
  try {
    const clientIp =
      (req.headers.get("x-forwarded-for") || "").split(",")[0].trim() ||
      "unknown";
    const rl = await hit(
      "agent-enroll",
      { windowMs: 60_000, max: 10 },
      { identifier: clientIp }
    );
    if (!rl.allowed) {
      return NextResponse.json(
        { ok: false, error: "Rate limit" },
        { status: 429 }
      );
    }

    const body = await req.json().catch(() => null);
    const pcName = normalizeComputerName(
      typeof body?.pcName === "string" ? body.pcName : ""
    );
    const key = typeof body?.key === "string" ? body.key.trim() : "";
    if (!pcName || !key) {
      return NextResponse.json(
        { ok: false, error: "pcName y key requeridos" },
        { status: 400 }
      );
    }
    if (!(await verifyEnrollKey(key))) {
      return NextResponse.json(
        { ok: false, error: "Clave de enrolamiento no válida" },
        { status: 403 }
      );
    }

    const token = randomBytes(32).toString("hex");
    const hash = createHash("sha256").update(token, "utf8").digest("hex");
    await db.computer.upsert({
      where: { name: pcName },
      update: {
        agentTokenHash: hash,
        agentTokenAt: new Date(),
        agentTokenPendingHash: null,
        agentTokenPendingAt: null,
      },
      create: {
        name: pcName,
        ipAddress: clientIp === "unknown" ? "" : clientIp,
        agentTokenHash: hash,
        agentTokenAt: new Date(),
      },
    });
    return NextResponse.json({ ok: true, token });
  } catch (error) {
    logError("Error en el enrolamiento de un agente", error);
    return NextResponse.json(
      { ok: false, error: "Error interno" },
      { status: 500 }
    );
  }
}
