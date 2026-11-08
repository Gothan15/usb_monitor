import { NextResponse } from "next/server";

import { requireAdminUser } from "@/lib/admin";
import { db } from "@/lib/db";
import {
  generarCodigoEnrolamiento,
  revocarCredencial,
} from "@/lib/credenciales";
import { logError } from "@/lib/logger";
import { normalizeComputerName } from "@/lib/utils";

/**
 * Credencial de un equipo, lado del administrador (overhaul de
 * 2026-11-08):
 *
 * GET    ?pcName=...  el estado de la credencial (para el
 *                     diálogo de Equipos): si tiene clave, su
 *                     huella y fecha; si aún guarda el token
 *                     antiguo pendiente de migrar; código en
 *                     curso y su caducidad; intentos fallidos y
 *                     última alerta de revocación.
 * POST   { pcName }   genera un código de enrolamiento de un
 *                     solo uso (30 min) atado a ese equipo y lo
 *                     devuelve UNA vez. Crea la fila del equipo
 *                     si aún no existe.
 * DELETE { pcName }   revoca la credencial: fuera clave, fuera
 *                     token legado, fuera código. El equipo
 *                     solo podrá volver enrolándose con un
 *                     código nuevo.
 */

async function buscarEquipo(pcNameCrudo: unknown) {
  const pcName = normalizeComputerName(
    typeof pcNameCrudo === "string" ? pcNameCrudo : ""
  );
  if (!pcName) return null;
  return (db as any).computer.findUnique({
    where: { name: pcName },
    select: {
      id: true,
      name: true,
      clavePublicaHuella: true,
      credencialAt: true,
      agentTokenHash: true,
      codigoEnrolamientoExpira: true,
      intentosFallidosCredencial: true,
      alertaCredencial: true,
      credencialRevocadaAt: true,
    },
  });
}

export async function GET(req: Request) {
  const admin = await requireAdminUser(req);
  if (!admin) {
    return NextResponse.json(
      { ok: false, error: "No autorizado" },
      { status: 401 }
    );
  }
  try {
    const { searchParams } = new URL(req.url);
    const computer = await buscarEquipo(searchParams.get("pcName"));
    if (!computer) {
      return NextResponse.json(
        { ok: false, error: "Equipo no encontrado" },
        { status: 404 }
      );
    }
    return NextResponse.json({
      ok: true,
      tieneClave: !!computer.clavePublicaHuella,
      huella: computer.clavePublicaHuella,
      credencialAt: computer.credencialAt,
      tieneTokenLegado: !!computer.agentTokenHash,
      codigoExpira: computer.codigoEnrolamientoExpira,
      intentosFallidos: computer.intentosFallidosCredencial,
      alertaCredencial: computer.alertaCredencial,
      credencialRevocadaAt: computer.credencialRevocadaAt,
    });
  } catch (error) {
    logError("Error en GET /api/agent/codigo-enrolamiento", error);
    return NextResponse.json(
      { ok: false, error: "Error al consultar la credencial" },
      { status: 500 }
    );
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
  try {
    const body = await req.json().catch(() => null);
    const pcName = normalizeComputerName(
      typeof body?.pcName === "string" ? body.pcName : ""
    );
    if (!pcName) {
      return NextResponse.json(
        { ok: false, error: "pcName requerido" },
        { status: 400 }
      );
    }
    const computer = await (db as any).computer.upsert({
      where: { name: pcName },
      update: {},
      create: { name: pcName, ipAddress: "" },
      select: { id: true },
    });
    const { codigo, expira } = await generarCodigoEnrolamiento(
      computer.id,
      30
    );
    return NextResponse.json({ ok: true, codigo, expira, computerId: computer.id, pcName });
  } catch (error) {
    logError("Error en POST /api/agent/codigo-enrolamiento", error);
    return NextResponse.json(
      { ok: false, error: "Error al generar el código" },
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
  try {
    const body = await req.json().catch(() => null);
    const computer = await buscarEquipo(body?.pcName);
    if (!computer) {
      return NextResponse.json(
        { ok: false, error: "Equipo no encontrado" },
        { status: 404 }
      );
    }
    await revocarCredencial(computer.id, "Credencial revocada por el administrador.");
    return NextResponse.json({ ok: true });
  } catch (error) {
    logError("Error en DELETE /api/agent/codigo-enrolamiento", error);
    return NextResponse.json(
      { ok: false, error: "Error al revocar la credencial" },
      { status: 500 }
    );
  }
}
