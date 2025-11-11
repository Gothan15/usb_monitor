import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireServiceAuth } from "@/lib/auth";
import { getCurrentDate } from "@/lib/time";
import { hit } from "@/lib/rateLimit";
import { logError } from "@/lib/logger";

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

    const normalizedPcName = pcName.trim();
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

    // Obtener todas las conexiones activas de esta PC
    const activeConnections = await (db as any).uSBConnection.findMany({
      where: {
        pcName: normalizedPcName,
        isConnected: true,
      },
    });

    // Crear un Set con las letras de unidad actualmente conectadas
    const currentDriveLetters = new Set(
      connectedDrives.map((d: any) => d.driveLetter)
    );

    // Marcar como desconectadas las que ya no están
    for (const connection of activeConnections) {
      if (!currentDriveLetters.has(connection.driveLetter)) {
        await (db as any).uSBConnection.update({
          where: { id: connection.id },
          data: {
            isConnected: false,
            disconnectedAt: now,
          },
        });
      }
    }

    // Actualizar o crear registros para las unidades conectadas
    for (const drive of connectedDrives) {
      const { driveLetter, volumeName, serialNumber, model, size, freeSpace } =
        drive;

      // Buscar conexión existente por serialNumber y pcName
      const existingConnection = await (db as any).uSBConnection.findFirst({
        where: {
          pcName: normalizedPcName,
          serialNumber: serialNumber,
          isConnected: true,
        },
        orderBy: {
          connectedAt: "desc",
        },
      });

      if (existingConnection) {
        // Actualizar lastSeen y driveLetter (puede cambiar)
        await (db as any).uSBConnection.update({
          where: { id: existingConnection.id },
          data: {
            lastSeen: now,
            driveLetter: driveLetter,
            volumeName: volumeName || existingConnection.volumeName,
          },
        });
      } else {
        // Crear nueva conexión
        await (db as any).uSBConnection.create({
          data: {
            pcName: normalizedPcName,
            driveLetter: driveLetter,
            volumeName: volumeName || "Sin nombre",
            serialNumber: serialNumber,
            model: model || "Unknown",
            size: BigInt(size || 0),
            connectedAt: now,
            lastSeen: now,
            isConnected: true,
          },
        });
      }
    }

    const res = NextResponse.json({
      ok: true,
      message: "Estado actualizado",
      connectedCount: connectedDrives.length,
    });
    res.headers.set("Cache-Control", "no-store");
    return res;
  } catch (error: any) {
    if (error?.message === "UNAUTHORIZED") {
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
