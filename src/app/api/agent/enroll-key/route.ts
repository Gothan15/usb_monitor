import { NextResponse } from "next/server";

import { requireAdminUser } from "@/lib/admin";
import {
  deleteEnrollKey,
  enrollKeyStatus,
  generateEnrollKey,
  hashEnrollKey,
  saveEnrollKeyHash,
} from "@/lib/enrollKey";
import { logError } from "@/lib/logger";

/**
 * Gestión de la clave de enrolamiento de la flota (solo
 * administradores, con sesión). Es la hermana global de
 * /api/agent/provision-token: en vez de un token por equipo
 * llevado a mano, UNA clave de despliegue con la que cada agente
 * nuevo obtiene su propio token en /api/agent/enroll.
 *
 * GET    -> si hay clave vigente y desde cuándo (nunca el hash).
 * POST   -> genera una clave nueva (la anterior muere), guarda
 *           solo su hash y devuelve la clave en claro UNA VEZ.
 * DELETE -> revoca la clave: los enrolamientos futuros se
 *           rechazan; los tokens ya emitidos no se tocan.
 */
export async function GET(req: Request) {
  const admin = await requireAdminUser(req);
  if (!admin) {
    return NextResponse.json(
      { ok: false, error: "No autorizado" },
      { status: 401 }
    );
  }
  const status = await enrollKeyStatus();
  return NextResponse.json({ ok: true, ...status });
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
    const key = generateEnrollKey();
    await saveEnrollKeyHash(hashEnrollKey(key));
    return NextResponse.json({ ok: true, key });
  } catch (error) {
    logError("Error generando la clave de enrolamiento", error);
    return NextResponse.json(
      { ok: false, error: "No se pudo generar la clave" },
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
  await deleteEnrollKey();
  return NextResponse.json({ ok: true });
}
