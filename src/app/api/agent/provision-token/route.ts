import { createHash, randomBytes } from "crypto";

import { NextResponse } from "next/server";

import { requireAdminUser } from "@/lib/admin";
import { db } from "@/lib/db";
import { logError } from "@/lib/logger";
import { normalizeComputerName } from "@/lib/utils";

/**
 * Provisión de tokens del agente (solo administradores, con sesión).
 *
 * POST   { pcName } -> genera un token nuevo para ese equipo, guarda
 *                      SOLO su hash SHA-256 en Computer.agentTokenHash
 *                      y devuelve el token en claro UNA ÚNICA VEZ.
 *                      Generar otro invalida el anterior (rotación).
 * DELETE { pcName } -> revoca el token del equipo (hash a null).
 *
 * El equipo puede no existir todavía en el panel (instalación manual
 * nueva): se crea su fila al provisionar. El agente presenta el
 * token como `Authorization: AgentToken <token>` y el panel lo
 * localiza por el hash (ver authenticateAgentToken en lib/auth).
 */

function hashToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

async function leerPcName(req: Request): Promise<string> {
  try {
    const body = await req.json();
    const bruto = typeof body?.pcName === "string" ? body.pcName : "";
    return normalizeComputerName(bruto);
  } catch {
    return "";
  }
}

export async function POST(req: Request) {
  const admin = await requireAdminUser(req);
  if (!admin) {
    return NextResponse.json(
      { ok: false, error: "No autorizado" },
      { status: 401 }
    );
  }
  const pcName = await leerPcName(req);
  if (!pcName) {
    return NextResponse.json(
      { ok: false, error: "pcName requerido" },
      { status: 400 }
    );
  }
  try {
    const token = randomBytes(32).toString("hex");
    const computer = await db.computer.upsert({
      where: { name: pcName },
      update: { agentTokenHash: hashToken(token), agentTokenAt: new Date() },
      create: {
        name: pcName,
        ipAddress: "",
        agentTokenHash: hashToken(token),
        agentTokenAt: new Date(),
      },
      select: { id: true, name: true },
    });
    const res = NextResponse.json({
      ok: true,
      pcName: computer.name,
      token,
      message:
        "Token generado. Se muestra una sola vez: cópialo ahora en la caja de herramientas del agente de ese equipo.",
    });
    res.headers.set("Cache-Control", "no-store");
    return res;
  } catch (error: any) {
    logError("Error provisionando token del agente", error);
    return NextResponse.json(
      { ok: false, error: error.message },
      { status: 500 }
    );
  }
}

export async function DELETE(req: Request) {
  const admin = await requireAdminUser(req);
  if (!admin) {
    return NextResponse.json(
      { ok: false, error: "No autorizado" },
      { status: 401 }
    );
  }
  const pcName = await leerPcName(req);
  if (!pcName) {
    return NextResponse.json(
      { ok: false, error: "pcName requerido" },
      { status: 400 }
    );
  }
  try {
    await db.computer.updateMany({
      where: { name: pcName },
      data: { agentTokenHash: null },
    });
    const res = NextResponse.json({ ok: true, pcName, revoked: true });
    res.headers.set("Cache-Control", "no-store");
    return res;
  } catch (error: any) {
    logError("Error revocando token del agente", error);
    return NextResponse.json(
      { ok: false, error: error.message },
      { status: 500 }
    );
  }
}
