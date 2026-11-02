import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireServiceAuth } from "@/lib/auth";
import { readAppSettings } from "@/lib/appSettings";
import { normalizeComputerName } from "@/lib/utils";
import { registrarContactoAgente } from "@/lib/agentDebug";
import { logError } from "@/lib/logger";

/**
 * GET /api/agent/owner-hash?pcName=...
 * Fase 4 del plan de desbloqueo: entrega al agente (autenticado) el
 * hash argon2 del usuario dueño del equipo, para la emergencia sin
 * red. El agente lo guarda cifrado con su clave de máquina y lo
 * refresca en cada contacto. El hash no es la contraseña: solo sirve
 * para verificar localmente, con contador de intentos.
 */
export async function GET(req: Request) {
  // Se lee antes del try solo para poder registrar el contacto
  // también cuando la autenticación falla (401).
  const pcNameQuery = new URL(req.url).searchParams.get("pcName");
  try {
    const serviceAuth = await requireServiceAuth(req);

    const settings = await readAppSettings();
    if (!settings.offlineEmergencyEnabled) {
      return NextResponse.json(
        { ok: false, error: "Emergencia sin red desactivada" },
        { status: 403 }
      );
    }

    const { searchParams } = new URL(req.url);
    // Normalizado como en ping y usb-event (mayúsculas, sin
    // espacios): el nombre guardado del equipo es el normalizado, y
    // buscarlo en crudo podía dar «no encontrado» con la fila
    // existiendo.
    const pcName = normalizeComputerName(
      searchParams.get("pcName") || serviceAuth.serviceId || ""
    );
    if (!pcName) {
      return NextResponse.json(
        { ok: false, error: "pcName requerido" },
        { status: 400 }
      );
    }

    const computer = await db.computer.findUnique({
      where: { name: pcName },
      select: { id: true, name: true },
    });
    if (!computer) {
      return NextResponse.json(
        { ok: false, error: "Equipo no encontrado" },
        { status: 404 }
      );
    }

    // Si la identidad es un token de equipo, solo puede pedir su hash.
    if (serviceAuth.computerId && serviceAuth.computerId !== computer.id) {
      return NextResponse.json(
        { ok: false, error: "No autorizado" },
        { status: 403 }
      );
    }

    const owner = await db.user.findFirst({
      where: { computerId: computer.id },
      orderBy: { createdAt: "asc" },
      select: { username: true, passwordHash: true },
    });
    if (!owner) {
      return NextResponse.json(
        { ok: false, error: "El equipo no tiene usuario asignado" },
        { status: 404 }
      );
    }

    registrarContactoAgente(computer.name, "/api/agent/owner-hash", 200);
    const res = NextResponse.json({
      ok: true,
      pcName: computer.name,
      username: owner.username,
      passwordHash: owner.passwordHash,
    });
    res.headers.set("Cache-Control", "no-store");
    return res;
  } catch (error: any) {
    if (error?.message === "UNAUTHORIZED") {
      registrarContactoAgente(pcNameQuery, "/api/agent/owner-hash", 401);
      return NextResponse.json(
        { ok: false, error: "No autorizado" },
        { status: 401 }
      );
    }
    logError("Error en owner-hash", error);
    return NextResponse.json(
      { ok: false, error: error.message },
      { status: 500 }
    );
  }
}
