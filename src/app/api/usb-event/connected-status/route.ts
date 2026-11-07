import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireServiceAuth } from "@/lib/auth";
import { getCurrentDate } from "@/lib/time";
import { hit } from "@/lib/rateLimit";
import { registrarContactoAgente } from "@/lib/agentDebug";
import { logError } from "@/lib/logger";
import { normalizeComputerName } from "@/lib/utils";
import { broadcastUsbDevices } from "@/lib/socket";

/**
 * POST /api/usb-event/connected-status
 * Recibe el estado actual de las unidades USB conectadas desde el servicio
 */
export async function POST(req: NextRequest) {
  try {
    const serviceAuth = await requireServiceAuth(req);

    const body = (await req.json().catch(() => null)) as any;

    if (!body || typeof body !== "object") {
      return NextResponse.json(
        { ok: false, error: "Cuerpo JSON inválido o ausente" },
        { status: 400 }
      );
    }

    const { pcName, connectedDrives } = body;

    if (
      typeof pcName !== "string" ||
      !pcName.trim() ||
      !Array.isArray(connectedDrives)
    ) {
      return NextResponse.json(
        { ok: false, error: "pcName y connectedDrives son requeridos" },
        { status: 400 }
      );
    }

    const normalizedPcName = normalizeComputerName(pcName);
    const clientIp =
      (req.headers.get("x-forwarded-for") || "").split(",")[0].trim() ||
      "unknown";
    const rl = await hit(
      "usb-connected-status",
      { windowMs: 5_000, max: 10 },
      {
        serviceId: serviceAuth.serviceId,
        ip: clientIp,
        identifier: normalizedPcName,
      }
    );
    if (!rl.allowed) {
      return NextResponse.json(
        { ok: false, error: "Rate limit" },
        { status: 429 }
      );
    }

    const now = getCurrentDate();

    // La identidad de una conexión es el SERIAL, no la letra: un
    // dispositivo bloqueado por PnP (o un teléfono WPD) no tiene
    // letra y aun así está conectado; antes se filtraba fuera y el
    // panel nunca lo veía en «Dispositivos USB». Si un mismo serial
    // llega con varias letras (varias particiones), se conserva la
    // primera con letra: una fila por dispositivo.
    // deviceKind dice QUÉ es el dispositivo (lo manda el agente):
    // sin él, un adaptador de red o una impresora se listaban como
    // si fueran memorias. Lo desconocido o ausente cae a DISCO
    // (compatibilidad con agentes viejos).
    const TIPOS_DISPOSITIVO = new Set([
      "DISCO",
      "TELEFONO",
      "OPTICO",
      "RED",
      "IMPRESORA",
    ]);
    const porSerial = new Map<string, any>();
    if (Array.isArray(connectedDrives)) {
      for (const drive of connectedDrives) {
        const rawLetter =
          typeof drive?.driveLetter === "string"
            ? drive.driveLetter.trim()
            : "";
        const normalizedLetter = rawLetter || "SIN-LETRA";
        const rawSerial =
          typeof drive?.serialNumber === "string"
            ? drive.serialNumber.trim()
            : "";
        const rawKind =
          typeof drive?.deviceKind === "string"
            ? drive.deviceKind.trim().toUpperCase()
            : "";
        const entrada = {
          driveLetter: rawLetter || null,
          volumeName:
            typeof drive?.volumeName === "string" ? drive.volumeName : null,
          serialNumber: rawSerial || `AUTO-${normalizedLetter}`,
          model: typeof drive?.model === "string" ? drive.model : null,
          deviceKind: TIPOS_DISPOSITIVO.has(rawKind) ? rawKind : "DISCO",
          size: Number.isFinite(drive?.size) ? Number(drive.size) : 0,
        };
        const previa = porSerial.get(entrada.serialNumber);
        if (!previa || (previa.driveLetter === null && entrada.driveLetter)) {
          porSerial.set(entrada.serialNumber, entrada);
        }
      }
    }
    const sanitizedDrives = Array.from(porSerial.values());

    // Foto del conjunto ANTES de tocar nada (serial + letra): si
    // el reporte trae un conjunto distinto del que consta, al
    // final se avisa por socket para que «Ver USB» y Equipos se
    // refresquen en vivo. Comparar aquí evita emitir en cada
    // latido (cada 30 s) cuando nada cambió.
    const previos = await (db as any).uSBConnection.findMany({
      where: { pcName: normalizedPcName, isConnected: true },
      select: { serialNumber: true, driveLetter: true },
    });
    const firmaPrevia = new Set(
      (previos as any[]).map(
        (c) => `${c.serialNumber}|${c.driveLetter ?? ""}`,
      ),
    );
    const firmaNueva = new Set(
      sanitizedDrives.map((d) => `${d.serialNumber}|${d.driveLetter ?? ""}`),
    );
    const cambioDispositivos =
      firmaPrevia.size !== firmaNueva.size ||
      [...firmaNueva].some((f) => !firmaPrevia.has(f));

    const serials = sanitizedDrives
      .map((drive) => drive.serialNumber)
      .filter((serial): serial is string => Boolean(serial));

    // Marcar como desconectado lo que el agente ya no reporta
    // (por serial: la letra puede cambiar o no existir).
    if (serials.length) {
      await (db as any).uSBConnection.updateMany({
        where: {
          pcName: normalizedPcName,
          isConnected: true,
          serialNumber: { notIn: serials },
        },
        data: {
          isConnected: false,
          disconnectedAt: now,
        },
      });
    } else {
      await (db as any).uSBConnection.updateMany({
        where: {
          pcName: normalizedPcName,
          isConnected: true,
        },
        data: {
          isConnected: false,
          disconnectedAt: now,
        },
      });
    }

    // Fetch active rows for incoming serials once to avoid per-drive round trips.
    const existingConnections = serials.length
      ? await (db as any).uSBConnection.findMany({
          where: {
            pcName: normalizedPcName,
            isConnected: true,
            serialNumber: { in: serials },
          },
        })
      : [];

    const existingBySerial = new Map<string, any>();
    for (const connection of existingConnections) {
      if (connection.serialNumber) {
        existingBySerial.set(connection.serialNumber, connection);
      }
    }

    const operations = sanitizedDrives.map((drive) => {
      const existing = drive.serialNumber
        ? existingBySerial.get(drive.serialNumber)
        : undefined;
      if (existing) {
        return (db as any).uSBConnection.update({
          where: { id: existing.id },
          data: {
            lastSeen: now,
            driveLetter: drive.driveLetter,
            volumeName: drive.volumeName || existing.volumeName,
            deviceKind: drive.deviceKind,
            size: BigInt(drive.size || Number(existing.size) || 0),
          },
        });
      }
      return (db as any).uSBConnection.create({
        data: {
          pcName: normalizedPcName,
          driveLetter: drive.driveLetter,
          volumeName: drive.volumeName || "Sin nombre",
          serialNumber: drive.serialNumber,
          model: drive.model || "Desconocido",
          deviceKind: drive.deviceKind,
          size: BigInt(drive.size || 0),
          connectedAt: now,
          lastSeen: now,
          isConnected: true,
        },
      });
    });

    if (operations.length) {
      await (db as any).$transaction(operations);
    }

    if (cambioDispositivos) {
      broadcastUsbDevices(normalizedPcName);
    }

    registrarContactoAgente(
      normalizedPcName,
      "/api/usb-event/connected-status",
      200
    );
    const res = NextResponse.json({
      ok: true,
      message: "Estado actualizado",
      connectedCount: sanitizedDrives.length,
    });
    res.headers.set("Cache-Control", "no-store");
    return res;
  } catch (error: any) {
    if (error?.message === "UNAUTHORIZED") {
      registrarContactoAgente(null, "/api/usb-event/connected-status", 401);
      return NextResponse.json(
        { ok: false, error: "No autorizado" },
        { status: 401 }
      );
    }
    logError("Error en connected-status", error);
    return NextResponse.json(
      { ok: false, error: error.message },
      { status: 500 }
    );
  }
}

export const dynamic = "force-dynamic";
