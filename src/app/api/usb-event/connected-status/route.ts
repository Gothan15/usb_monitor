import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { authenticateRequest } from "@/lib/auth";

/**
 * POST /api/usb-event/connected-status
 * Recibe el estado actual de las unidades USB conectadas desde el servicio
 */
export async function POST(req: NextRequest) {
  try {
    // Verificar autenticación con API Key
    const authResult = await authenticateRequest(req);
    if (!authResult) {
      return NextResponse.json(
        { ok: false, error: "No autorizado" },
        { status: 401 }
      );
    }

    const body = (await req.json().catch(() => null)) as any;

    if (!body || typeof body !== "object") {
      return NextResponse.json(
        { ok: false, error: "Cuerpo JSON inválido o ausente" },
        { status: 400 }
      );
    }

    const { pcName, connectedDrives } = body;

    if (!pcName || !Array.isArray(connectedDrives)) {
      return NextResponse.json(
        { ok: false, error: "pcName y connectedDrives son requeridos" },
        { status: 400 }
      );
    }

    const now = new Date();

    // Obtener todas las conexiones activas de esta PC
    const activeConnections = await (db as any).uSBConnection.findMany({
      where: {
        pcName: pcName,
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
          pcName: pcName,
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
            pcName: pcName,
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

    return NextResponse.json({
      ok: true,
      message: "Estado actualizado",
      connectedCount: connectedDrives.length,
    });
  } catch (error: any) {
    console.error("Error en connected-status:", error);
    return NextResponse.json(
      { ok: false, error: error.message },
      { status: 500 }
    );
  }
}

export const dynamic = "force-dynamic";
