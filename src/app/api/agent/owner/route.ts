import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireAgentAuth } from "@/lib/agentAuth";
import { readAppSettings } from "@/lib/appSettings";
import { normalizeComputerName } from "@/lib/utils";
import { registrarContactoAgente } from "@/lib/agentDebug";
import { logError } from "@/lib/logger";

/**
 * GET /api/agent/owner?pcName=...
 * Identidad pública del equipo para el agente: qué usuario del panel
 * es el dueño asignado de esta PC y en qué modo se desbloquea.
 *
 * A diferencia de /api/agent/owner-hash NO entrega ninguna
 * credencial (ni siquiera el hash): solo el nombre de usuario, para
 * que la caja de herramientas y el compañero puedan decirle a quien
 * está frente a la PC de quién es la contraseña que vale aquí, o
 * avisar de que el equipo no tiene dueño asignado (entonces solo un
 * administrador puede desbloquear, y el arreglo es asignar un
 * usuario al equipo en el panel). Sin dueño no es un error: se
 * responde 200 con ownerUsername en null.
 */
export async function GET(req: Request) {
  const pcNameQuery = new URL(req.url).searchParams.get("pcName");
  try {
    const serviceAuth = await requireAgentAuth(req);

    const { searchParams } = new URL(req.url);
    // Normalizado como en ping y usb-event (mayúsculas, sin
    // espacios): el nombre guardado del equipo es el normalizado.
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
      select: { id: true, name: true, unlockMode: true },
    });
    if (!computer) {
      return NextResponse.json(
        { ok: false, error: "Equipo no encontrado" },
        { status: 404 }
      );
    }

    // Si la identidad es un token de equipo, solo puede pedir lo suyo.
    if (serviceAuth.computerId && serviceAuth.computerId !== computer.id) {
      return NextResponse.json(
        { ok: false, error: "No autorizado" },
        { status: 403 }
      );
    }

    const owner = await db.user.findFirst({
      where: { computerId: computer.id },
      orderBy: { createdAt: "asc" },
      select: { username: true },
    });

    const settings = await readAppSettings();
    registrarContactoAgente(computer.name, "/api/agent/owner", 200);
    const res = NextResponse.json({
      ok: true,
      pcName: computer.name,
      ownerUsername: owner?.username ?? null,
      unlockMode: computer.unlockMode,
      passwordUnlockEnabled: settings.passwordUnlockEnabled,
    });
    res.headers.set("Cache-Control", "no-store");
    return res;
  } catch (error: any) {
    if (error?.message === "UNAUTHORIZED") {
      registrarContactoAgente(pcNameQuery, "/api/agent/owner", 401);
      return NextResponse.json(
        { ok: false, error: "No autorizado" },
        { status: 401 }
      );
    }
    logError("Error en agent/owner", error);
    return NextResponse.json(
      { ok: false, error: error.message },
      { status: 500 }
    );
  }
}
