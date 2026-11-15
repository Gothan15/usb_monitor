import { NextResponse } from "next/server";

import { requireAdminUser } from "@/lib/admin";
import { db } from "@/lib/db";
import { logError } from "@/lib/logger";
import { normalizeComputerName } from "@/lib/utils";
import {
  ESTADO_ORDEN,
  ESTADOS_ORDEN_ACTIVA,
  TIPO_ORDEN_ACTUALIZAR,
  TIPO_ORDEN_DESINSTALAR,
  ordenEliminable,
  vistaOrdenActualizacion,
} from "@/lib/agentCommands";
import { manifiestoPaquete } from "@/lib/paqueteAgente";
import { getCurrentDate } from "@/lib/time";

/**
 * Órdenes del canal del agente, lado del panel (solo administrador).
 *
 * POST { pcName, tipo } -> crea la orden en ESPERA para ese equipo.
 *   Hoy solo existe «actualizar»: la versión objetivo sale del
 *   manifiesto del paquete que sirve el panel; sin paquete no se
 *   crea la orden (el agente no tendría nada que descargar).
 *   Si el equipo ya tiene una «actualizar» activa no se duplica.
 * GET ?pcName= -> las órdenes recientes de ese equipo (25).
 * GET sin pcName -> las órdenes recientes de TODOS los equipos
 *   (50, con forma de vista): la lista que pinta la pestaña de
 *   Tareas, donde estas órdenes viven junto a las de instalación.
 * DELETE -> la limpieza de terminadas: borra las órdenes ya
 *   terminales (la regla `ordenEliminable` manda: las canceladas
 *   recientes se respetan hasta que dejan de servirse al agente).
 */
export async function POST(req: Request) {
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
  const pcName = normalizeComputerName(
    typeof body?.pcName === "string" ? body.pcName : "",
  );
  const tipo =
    typeof body?.tipo === "string" ? body.tipo.trim().toLowerCase() : "";
  if (!pcName) {
    return NextResponse.json(
      { ok: false, error: "pcName requerido" },
      { status: 400 },
    );
  }
  if (tipo !== TIPO_ORDEN_ACTUALIZAR) {
    return NextResponse.json(
      { ok: false, error: "Tipo de orden no soportado" },
      { status: 400 },
    );
  }
  try {
    const computer = await db.computer.findUnique({
      where: { name: pcName },
      select: { id: true, name: true, agentVersion: true },
    });
    if (!computer) {
      return NextResponse.json(
        { ok: false, error: "Equipo no registrado en el panel" },
        { status: 404 },
      );
    }

    const manifiesto = await manifiestoPaquete();
    if (!manifiesto) {
      return NextResponse.json(
        {
          ok: false,
          error:
            "No hay paquete de actualización en el panel: deja el USBMonitorService.exe vigente (y su manifiesto.json) en la carpeta paquete-agente.",
        },
        { status: 409 },
      );
    }
    if (manifiesto.version && computer.agentVersion === manifiesto.version) {
      return NextResponse.json(
        {
          ok: false,
          error: `Ese equipo ya corre la versión del paquete (${manifiesto.version}).`,
        },
        { status: 409 },
      );
    }

    const desinstalando = await db.agentCommand.findFirst({
      where: {
        computerId: computer.id,
        type: TIPO_ORDEN_DESINSTALAR,
        status: { in: ESTADOS_ORDEN_ACTIVA },
      },
      select: { id: true },
    });
    if (desinstalando) {
      return NextResponse.json(
        {
          ok: false,
          error:
            "Ese equipo tiene una desinstalación pedida: no se le crea una actualización.",
        },
        { status: 409 },
      );
    }

    const activa = await db.agentCommand.findFirst({
      where: {
        computerId: computer.id,
        type: TIPO_ORDEN_ACTUALIZAR,
        status: { in: ESTADOS_ORDEN_ACTIVA },
      },
      select: { id: true, status: true },
    });
    if (activa) {
      return NextResponse.json(
        {
          ok: false,
          error: "Ese equipo ya tiene una orden de actualización activa.",
          comando: activa,
        },
        { status: 409 },
      );
    }

    const comando = await db.agentCommand.create({
      data: {
        computerId: computer.id,
        type: TIPO_ORDEN_ACTUALIZAR,
        targetVersion: manifiesto.version,
        targetSha256: manifiesto.sha256,
      },
      select: { id: true, status: true, createdAt: true },
    });
    const res = NextResponse.json({
      ok: true,
      pcName: computer.name,
      comando,
      versionObjetivo: manifiesto.version,
    });
    res.headers.set("Cache-Control", "no-store");
    return res;
  } catch (error: any) {
    logError("Error creando orden del agente", error);
    return NextResponse.json(
      { ok: false, error: error.message },
      { status: 500 },
    );
  }
}

export async function GET(req: Request) {
  const admin = await requireAdminUser(req);
  if (!admin) {
    return NextResponse.json(
      { ok: false, error: "No autorizado" },
      { status: 401 },
    );
  }
  const { searchParams } = new URL(req.url);
  const pcName = normalizeComputerName(searchParams.get("pcName") || "");
  if (!pcName) {
    // Sin equipo concreto: la lista global para la pestaña de
    // Tareas, con el nombre de cada equipo y forma de vista.
    try {
      const filas = await db.agentCommand.findMany({
        orderBy: { createdAt: "desc" },
        take: 50,
        include: { computer: { select: { name: true } } },
      });
      const comandos = filas.map((fila) =>
        vistaOrdenActualizacion({
          id: fila.id,
          pcName: fila.computer.name,
          type: fila.type,
          status: fila.status,
          detail: fila.detail,
          targetVersion: fila.targetVersion,
          attempts: fila.attempts,
          createdAt: fila.createdAt,
          deliveredAt: fila.deliveredAt,
          startedAt: fila.startedAt,
          finishedAt: fila.finishedAt,
        }),
      );
      const res = NextResponse.json({ ok: true, comandos });
      res.headers.set("Cache-Control", "no-store");
      return res;
    } catch (error: any) {
      logError("Error listando las órdenes de todos los equipos", error);
      return NextResponse.json(
        { ok: false, error: error.message },
        { status: 500 },
      );
    }
  }
  try {
    const computer = await db.computer.findUnique({
      where: { name: pcName },
      select: { id: true },
    });
    if (!computer) {
      return NextResponse.json(
        { ok: false, error: "Equipo no registrado en el panel" },
        { status: 404 },
      );
    }
    const comandos = await db.agentCommand.findMany({
      where: { computerId: computer.id },
      orderBy: { createdAt: "desc" },
      take: 25,
    });
    const res = NextResponse.json({ ok: true, pcName, comandos });
    res.headers.set("Cache-Control", "no-store");
    return res;
  } catch (error: any) {
    logError("Error listando órdenes del agente", error);
    return NextResponse.json(
      { ok: false, error: error.message },
      { status: 500 },
    );
  }
}

export async function DELETE(req: Request) {
  const admin = await requireAdminUser(req);
  if (!admin) {
    return NextResponse.json(
      { ok: false, error: "No autorizado" },
      { status: 401 },
    );
  }
  try {
    const ahora = getCurrentDate();
    const candidatas = await db.agentCommand.findMany({
      where: {
        status: {
          in: [
            ESTADO_ORDEN.HECHA,
            ESTADO_ORDEN.ERROR,
            ESTADO_ORDEN.CANCELADA,
          ],
        },
      },
      select: { id: true, status: true, finishedAt: true },
    });
    const ids = candidatas
      .filter((c) => ordenEliminable(c.status, c.finishedAt, ahora))
      .map((c) => c.id);
    const resultado = ids.length
      ? await db.agentCommand.deleteMany({ where: { id: { in: ids } } })
      : { count: 0 };
    const res = NextResponse.json({ ok: true, eliminadas: resultado.count });
    res.headers.set("Cache-Control", "no-store");
    return res;
  } catch (error: any) {
    logError("Error limpiando las órdenes terminadas", error);
    return NextResponse.json(
      { ok: false, error: error.message },
      { status: 500 },
    );
  }
}
