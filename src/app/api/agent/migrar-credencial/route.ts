import { NextResponse } from "next/server";

import { autenticarPuenteLegado } from "@/lib/agentAuth";
import { registrarClavePublica } from "@/lib/credenciales";
import { logError } from "@/lib/logger";

/**
 * POST /api/agent/migrar-credencial  { clavePublica }
 * Autenticación: el antiguo token del equipo (Authorization:
 * AgentToken ...), una última vez.
 *
 * La migración del overhaul de credenciales: un agente que aún
 * guarda su token presenta ese token como pasaporte y registra
 * la clave pública que acaba de generar en su PC. Al registrar,
 * el hash del token se borra: el equipo ya solo firma, y esta
 * ruta deja de existir para él. Cuando ningún equipo conserve
 * hash legado, la ruta no aceptará a nadie.
 */
export async function POST(req: Request) {
  try {
    const auth = await autenticarPuenteLegado(req);
    if (!auth?.computerId) {
      return NextResponse.json(
        { ok: false, error: "Migración rechazada" },
        { status: 401 }
      );
    }

    const body = await req.json().catch(() => null);
    const clavePublica =
      typeof body?.clavePublica === "string" ? body.clavePublica : "";
    if (!clavePublica) {
      return NextResponse.json(
        { ok: false, error: "clavePublica requerida" },
        { status: 400 }
      );
    }

    let huella: string;
    try {
      huella = await registrarClavePublica(auth.computerId, clavePublica);
    } catch {
      return NextResponse.json(
        { ok: false, error: "La clave pública no es válida" },
        { status: 400 }
      );
    }

    return NextResponse.json({ ok: true, equipoId: auth.computerId, huella });
  } catch (error) {
    logError("Error en POST /api/agent/migrar-credencial", error);
    return NextResponse.json(
      { ok: false, error: "Error al migrar la credencial" },
      { status: 500 }
    );
  }
}
