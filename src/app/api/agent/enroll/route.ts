import { NextResponse } from "next/server";

import { db } from "@/lib/db";
import {
  codigoEnrolamientoValido,
  registrarClavePublica,
} from "@/lib/credenciales";
import { logError } from "@/lib/logger";
import { hit } from "@/lib/rateLimit";
import { normalizeComputerName } from "@/lib/utils";

/**
 * POST /api/agent/enroll  { pcName, codigo, clavePublica }
 *
 * Enrolamiento con código de UN SOLO USO (overhaul de
 * credenciales de 2026-11-08, en sustitución de la clave de
 * flota compartida): el administrador genera el código atado a
 * ESTE equipo en Equipos, el agente lo presenta junto con la
 * clave pública que acaba de nacer en su PC, y el servidor la
 * registra como su credencial y le devuelve su id. El código
 * muere en este acto; la clave privada nunca sale de la PC.
 *
 * Sin código vigente para ese nombre, la ruta rechaza todo con
 * un 401 genérico: no se distingue si falló el nombre, el
 * código o su caducidad.
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
        { ok: false, error: "Demasiados intentos: espera un minuto" },
        { status: 429 }
      );
    }

    const body = await req.json().catch(() => null);
    const pcName = normalizeComputerName(
      typeof body?.pcName === "string" ? body.pcName : ""
    );
    const codigo = typeof body?.codigo === "string" ? body.codigo : "";
    const clavePublica =
      typeof body?.clavePublica === "string" ? body.clavePublica : "";
    if (!pcName || !codigo || !clavePublica) {
      return NextResponse.json(
        { ok: false, error: "pcName, codigo y clavePublica requeridos" },
        { status: 400 }
      );
    }

    const computer = await (db as any).computer.findUnique({
      where: { name: pcName },
      select: {
        id: true,
        codigoEnrolamientoHash: true,
        codigoEnrolamientoExpira: true,
      },
    });
    if (!computer || !codigoEnrolamientoValido(computer, codigo)) {
      return NextResponse.json(
        { ok: false, error: "Enrolamiento rechazado" },
        { status: 401 }
      );
    }

    let huella: string;
    try {
      huella = await registrarClavePublica(computer.id, clavePublica);
    } catch {
      return NextResponse.json(
        { ok: false, error: "La clave pública no es válida" },
        { status: 400 }
      );
    }

    return NextResponse.json({ ok: true, equipoId: computer.id, huella });
  } catch (error) {
    logError("Error en POST /api/agent/enroll", error);
    return NextResponse.json(
      { ok: false, error: "Error al enrolar el equipo" },
      { status: 500 }
    );
  }
}
