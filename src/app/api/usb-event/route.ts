import { NextRequest, NextResponse } from "next/server";
import type { PrismaClient } from "@prisma/client";
import { resolve, TOKENS } from "@/lib/di/container";
import { requireAuth } from "@/lib/auth"; // Sólo se usará para GET (consulta), no para POST (ingesta)
import { usbEventPayloadSchema } from "@/lib/validators";
import { getCurrentDate } from "@/lib/time";
import { normalizeComputerName } from "@/lib/utils";
import { LRUCache } from "lru-cache";

const prisma = resolve<PrismaClient>(TOKENS.prisma);

const apiKeyCache = new LRUCache<string, string>({
  max: 500,
  ttl: 1000 * 60 * 5, // 5 minutes
});

export async function POST(request: NextRequest) {
  try {
    // 1. Validación de Seguridad: API Key
    const apiKey = request.headers.get("x-api-key");
    if (!apiKey) {
      return NextResponse.json(
        { error: "Falta API Key" },
        { status: 401 }
      );
    }

    let userId = apiKeyCache.get(apiKey);

    if (!userId) {
      const authorizedUser = await prisma.user.findUnique({
        where: { apiKey },
        select: { id: true },
      });

      if (!authorizedUser) {
        return NextResponse.json(
          { error: "API Key inválida" },
          { status: 401 }
        );
      }
      userId = authorizedUser.id;
      apiKeyCache.set(apiKey, userId);
    }

    const body = await request.json();
    const parsed = usbEventPayloadSchema.safeParse(body);

    if (!parsed.success) {
      const firstIssue = parsed.error.issues.at(0)?.message || "invalid body";
      return NextResponse.json(
        { error: "Payload invalido", detail: firstIssue },
        { status: 400 }
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

    const [usbEvent] = await Promise.all([
      prisma.uSBEvent.create({
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
        select: { id: true },
      }),
      // Actualizar o crear registro de computadora
      prisma.computer.upsert({
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
        select: { id: true },
      }),
    ]);

    console.log(
      `Evento USB recibido: ${event} desde ${computerName} (${pc_ip})`
    );

    return NextResponse.json({
      success: true,
      message: "Evento USB registrado correctamente",
      eventId: usbEvent.id,
    });
  } catch (error) {
    console.error("Error al procesar evento USB:", error);
    return NextResponse.json(
      { error: "Error interno del servidor" },
      { status: 500 }
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
      { status: 500 }
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
        { status: 403 }
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
      { status: 500 }
    );
  }
}
