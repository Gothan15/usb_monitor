import { NextRequest, NextResponse } from "next/server";
import type { PrismaClient } from "@prisma/client";
import { resolve, TOKENS } from "@/lib/di/container";
import { requireAuth, requireServiceAuth } from "@/lib/auth"; // requireAuth: GET (consulta). requireServiceAuth: POST si el ajuste requireAgentToken está activo
import { readAppSettings } from "@/lib/appSettings";
import { usbEventPayloadSchema } from "@/lib/validators";
import { getCurrentDate } from "@/lib/time";
import { normalizeComputerName } from "@/lib/utils";
import { broadcastUSBEvent, broadcastComputerStatus } from "@/lib/socket";

const prisma = resolve<PrismaClient>(TOKENS.prisma);

export async function POST(request: NextRequest) {
  try {
    // Ingesta de eventos (fase 3 del plan de desbloqueo): si el ajuste
    // requireAgentToken está activo en el panel, el agente debe
    // autenticarse (token por equipo o clave de servicio); si está
    // apagado —periodo de compatibilidad con agentes viejos— la ingesta
    // sigue abierta, pero queda constancia en el log del servidor.
    const settings = await readAppSettings();
    if (settings.requireAgentToken) {
      try {
        await requireServiceAuth(request);
      } catch {
        return NextResponse.json(
          { error: "No autorizado" },
          { status: 401 },
        );
      }
    }
    const body = await request.json();
    const parsed = usbEventPayloadSchema.safeParse(body);

    if (!parsed.success) {
      const firstIssue = parsed.error.issues.at(0)?.message || "invalid body";
      return NextResponse.json(
        { error: "Payload invalido", detail: firstIssue },
        { status: 400 },
      );
    }

    const {
      pc_name,
      pc_ip,
      pc_user,
      event,
      drive_letter,
      serial_number,
      readonly_status,
      whitelisted,
    } = parsed.data;

    const computerName = normalizeComputerName(pc_name);
    const normalizedDrive = drive_letter ?? null;
    const normalizedSerial = serial_number ?? null;
    const normalizedReadonly = readonly_status ?? null;
    const whitelistedFlag = Boolean(whitelisted);

    // Guardar el evento USB en la base de datos
    const occurredAt = getCurrentDate();

    const usbEvent = await prisma.uSBEvent.create({
      data: {
        pcName: computerName,
        pcIp: pc_ip,
        pcUser: pc_user,
        event,
        timestamp: occurredAt,
        driveLetter: normalizedDrive,
        serialNumber: normalizedSerial,
        readonlyStatus: normalizedReadonly,
        whitelisted: whitelistedFlag,
      },
    });

    // Actualizar o crear registro de computadora
    await prisma.computer.upsert({
      where: { name: computerName },
      update: {
        ipAddress: pc_ip,
        lastSeen: occurredAt,
        isActive: true,
      },
      create: {
        name: computerName,
        ipAddress: pc_ip,
        lastSeen: occurredAt,
        isActive: true,
      },
    });

    // Fase 2: al extraerse el dispositivo, el permiso de uso muere.
    // El agente también llama a /api/usb-event/pending-close; esto es
    // el respaldo por si ese aviso se pierde.
    if (event === "DISCONNECTED" && normalizedDrive) {
      await prisma.pendingUnlock
        .updateMany({
          where: {
            pcName: computerName,
            driveLetter: normalizedDrive,
            status: { in: ["BLOCKED", "UNLOCKED"] },
          },
          data: {
            status: "CLOSED",
            closedAt: occurredAt,
            closeReason: "REMOVED",
          },
        })
        .catch(() => undefined);
    }

    console.log(
      `Evento USB recibido: ${event} desde ${computerName} (${pc_ip})`,
    );

    // Broadcast vía Socket.IO a todos los clientes conectados
    broadcastUSBEvent({
      id: usbEvent.id,
      pcName: computerName,
      pcIp: pc_ip,
      pcUser: pc_user,
      event,
      driveLetter: normalizedDrive,
      serialNumber: normalizedSerial,
      readonlyStatus: normalizedReadonly,
      whitelisted: whitelistedFlag,
      timestamp: occurredAt.toISOString(),
      createdAt: usbEvent.createdAt.toISOString(),
    });

    broadcastComputerStatus({
      name: computerName,
      ipAddress: pc_ip,
      isActive: true,
      lastSeen: occurredAt.toISOString(),
    });

    return NextResponse.json({
      success: true,
      message: "Evento USB registrado correctamente",
      eventId: usbEvent.id,
    });
  } catch (error) {
    console.error("Error al procesar evento USB:", error);
    return NextResponse.json(
      { error: "Error interno del servidor" },
      { status: 500 },
    );
  }
}

export async function GET(req: Request) {
  try {
    await requireAuth(req); // JWT en Authorization: Bearer <token>
    const events = await prisma.uSBEvent.findMany({
      orderBy: { createdAt: "desc" },
      take: 50, // Limitar a los últimos 50 eventos
    });

    return NextResponse.json(events);
  } catch (error) {
    if ((error as any)?.message === "UNAUTHORIZED")
      return NextResponse.json({ error: "No autorizado" }, { status: 401 });
    console.error("Error al obtener eventos USB:", error);
    return NextResponse.json(
      { error: "Error interno del servidor" },
      { status: 500 },
    );
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const auth = await requireAuth(req);
    const actor = await prisma.user.findUnique({
      where: { id: auth.userId },
      select: { role: true },
    });

    if (!actor || actor.role.toUpperCase() !== "ADMIN") {
      return NextResponse.json(
        { ok: false, error: "Solo un administrador puede limpiar eventos." },
        { status: 403 },
      );
    }

    const deletedEvents = await prisma.uSBEvent.deleteMany();

    return NextResponse.json({
      ok: true,
      deletedEvents: deletedEvents.count,
    });
  } catch (error) {
    console.error("Error al limpiar eventos USB:", error);
    return NextResponse.json(
      { ok: false, error: "No se pudo limpiar el historial." },
      { status: 500 },
    );
  }
}
