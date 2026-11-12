import { NextRequest, NextResponse } from "next/server";
import type { PrismaClient } from "@/generated/prisma/client";
import { resolve, TOKENS } from "@/lib/di/container";
import { requireAuth } from "@/lib/auth"; // requireAuth: GET (consulta de usuarios)
import { requireAgentAuth } from "@/lib/agentAuth"; // POST: solo el agente, firmado
import { readAppSettings } from "@/lib/appSettings";
import { usbEventPayloadSchema } from "@/lib/validators";
import { getCurrentDate } from "@/lib/time";
import { normalizeComputerName } from "@/lib/utils";
import { registrarContactoAgente } from "@/lib/agentDebug";
import { fusionarDuplicadoDeReporte } from "@/lib/identidadEquipo";
import { normalizeSerial } from "../whitelist/_helpers";
import { broadcastUSBEvent, broadcastComputerStatus } from "@/lib/socket";
import {
  esEventoDesbloqueo,
  resolverNombreDesbloqueador,
  completarDesbloqueadores,
} from "@/lib/eventoDesbloqueo";

const prisma = resolve<PrismaClient>(TOKENS.prisma);

export async function POST(request: NextRequest) {
  try {
    // Ingesta de eventos: SOLO el agente y SOLO firmado con la
    // clave de su equipo (overhaul de credenciales de 2026-11-08;
    // el antiguo ajuste que permitía ingesta abierta desaparece:
    // sin firma válida no hay conversación).
    let authAgente: Awaited<ReturnType<typeof requireAgentAuth>>;
    try {
      authAgente = await requireAgentAuth(request);
    } catch {
      // El body aún no se leyó: la PC no se conoce en este punto.
      registrarContactoAgente(null, "/api/usb-event", 401);
      return NextResponse.json(
        { error: "No autorizado" },
        { status: 401 },
      );
    }
    const body = await request.json();
    const parsed = usbEventPayloadSchema.safeParse(body);

    if (!parsed.success) {
      const firstIssue = parsed.error.issues.at(0)?.message || "invalid body";
      registrarContactoAgente(
        typeof (body as any)?.pc_name === "string"
          ? normalizeComputerName((body as any).pc_name)
          : null,
        "/api/usb-event",
        400
      );
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
    // El «¿está en la lista blanca?» de un evento lo decide el
    // PANEL, no el agente: el agente solo incluye su veredicto en
    // el evento BLOCKED (y a veces desde su caché, o ni eso), así
    // que Conectado/Desconectado/Desbloqueado llegaban sin el dato
    // y el panel de eventos pintaba «Fuera de la lista blanca» en
    // TODOS los eventos, también los de dispositivos listados.
    // Con serial presente, se resuelve aquí contra la lista real;
    // si la consulta fallara, se conserva el valor del agente.
    let whitelistedFlag = Boolean(whitelisted);
    if (normalizedSerial) {
      const serialNorm = normalizeSerial(normalizedSerial);
      if (serialNorm) {
        try {
          const entry = await prisma.uSBWhitelist.findUnique({
            where: { serialNumber: serialNorm },
            select: { id: true },
          });
          whitelistedFlag = Boolean(entry);
        } catch {
          // La ingesta no puede caer por esta consulta.
        }
      }
    }

    // Guardar el evento USB en la base de datos
    const occurredAt = getCurrentDate();

    // Si es un desbloqueo, se estampa la cuenta que lo autorizó
    // cruzando el evento con su bloqueo (el bloqueo ya guarda
    // quién y cuándo; el agente no conoce ese dato, lo aporta el
    // panel). Si el cruce no encuentra nada —p. ej. un desbloqueo
    // sin conexión cuyo intento aún no se sincronizó—, el evento
    // queda sin sello y la lectura lo rellena cuando exista.
    let unlockedBy: string | null = null;
    if (esEventoDesbloqueo(event)) {
      unlockedBy = await resolverNombreDesbloqueador({
        pcName: computerName,
        event,
        serialNumber: normalizedSerial,
        driveLetter: normalizedDrive,
        cuando: occurredAt,
      }).catch(() => null);
    }

    const usbEvent = await prisma.uSBEvent.create({
      data: {
        pcName: computerName,
        pcIp: pc_ip,
        pcUser: pc_user,
        unlockedBy,
        event,
        timestamp: occurredAt,
        driveLetter: normalizedDrive,
        serialNumber: normalizedSerial,
        readonlyStatus: normalizedReadonly,
        whitelisted: whitelistedFlag,
      },
    });

    // Actualizar el registro de computadora: la fila es la de
    // la credencial que firmó el evento (identidad resuelta por
    // requireAgentAuth), no una que coincida por nombre. Si el
    // nombre reportado existía como fila aparte —la duplicada
    // «por IP»—, se fusiona en la acreditada antes de anotar.
    if (authAgente?.computerId) {
      await fusionarDuplicadoDeReporte(authAgente.computerId, computerName);
      await prisma.computer.update({
        where: { id: authAgente.computerId },
        data: {
          ipAddress: pc_ip,
          lastSeen: occurredAt,
          isActive: true,
        },
      });
    } else {
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
    }

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

    // Sin console.log por evento: cada inserción o extracción
    // dejaría una línea en la consola para siempre, y el evento ya
    // queda en la base de datos y en el aviso en vivo. La consola
    // es para el arranque y los problemas, no para el tráfico.

    // Broadcast vía Socket.IO a todos los clientes conectados
    broadcastUSBEvent({
      id: usbEvent.id,
      pcName: computerName,
      pcIp: pc_ip,
      pcUser: pc_user,
      unlockedBy,
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

    registrarContactoAgente(computerName, "/api/usb-event", 200);
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
    const found = await prisma.uSBEvent.findMany({
      orderBy: { createdAt: "desc" },
      take: 50, // Limitar a los últimos 50 eventos
    });

    // Relleno al leer de la cuenta que desbloqueó: los eventos de
    // desbloqueo que entraron sin sello (la ingesta no encontró
    // aún el bloqueo, p. ej. desbloqueos sin conexión que se
    // sincronizan después) se completan cruzando con los
    // bloqueos, igual que abajo se recalcula la lista blanca.
    // Si el cruce falla, se sirve lo guardado.
    let events = found;
    try {
      const nombres = await completarDesbloqueadores(
        found.map((e) => ({
          pcName: e.pcName,
          event: e.event,
          serialNumber: e.serialNumber,
          driveLetter: e.driveLetter,
          cuando: e.timestamp,
          unlockedBy: e.unlockedBy,
        })),
      );
      events = found.map((e, i) =>
        nombres[i] ? { ...e, unlockedBy: nombres[i] } : e,
      );
    } catch {
      // El registro no puede caer por este relleno.
    }

    // El sello guardado puede venir vacío o de la caché del agente
    // (ver la nota en el POST): al LEER se recalcula contra la
    // lista blanca actual, para que también el historial ya
    // guardado se pinte bien sin tocar la base de datos.
    const seriales = Array.from(
      new Set(
        events
          .map((e) => (e.serialNumber ? normalizeSerial(e.serialNumber) : ""))
          .filter(Boolean),
      ),
    );
    if (seriales.length > 0) {
      try {
        const entries = await prisma.uSBWhitelist.findMany({
          where: { serialNumber: { in: seriales } },
          select: { serialNumber: true },
        });
        const enLista = new Set(entries.map((e) => e.serialNumber));
        return NextResponse.json(
          events.map((e) =>
            e.serialNumber
              ? { ...e, whitelisted: enLista.has(normalizeSerial(e.serialNumber)) }
              : e,
          ),
        );
      } catch {
        // Si la lista no se puede leer, se sirve lo guardado.
      }
    }

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
