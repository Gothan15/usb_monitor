import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { verifySessionFromRequest } from "@/lib/auth";

/**
 * GET /api/usb-event/user-devices
 * Obtiene los eventos USB de la computadora asignada al usuario actual
 */
export async function GET(req: Request) {
  try {
    const session = await verifySessionFromRequest(req);
    if (!session) {
      return NextResponse.json(
        { ok: false, error: "No autenticado" },
        { status: 401 }
      );
    }

    // Obtener el usuario con su computadora
    const user = await (db as any).user.findUnique({
      where: { username: session.username },
      include: { computer: true },
    });

    if (!user) {
      return NextResponse.json(
        { ok: false, error: "Usuario no encontrado" },
        { status: 404 }
      );
    }

    if (!user.computer) {
      return NextResponse.json({
        ok: true,
        events: [],
        computer: null,
        message: "No tiene una computadora asignada",
      });
    }

    // Obtener eventos USB de la computadora del usuario
    const events = await (db as any).uSBEvent.findMany({
      where: {
        pcName: user.computer.name,
      },
      orderBy: {
        createdAt: "desc",
      },
      take: 100, // Limitar a los últimos 100 eventos
    });

    // Obtener pending unlocks para esta computadora
    const pendingUnlocks = await (db as any).pendingUnlock.findMany({
      where: {
        pcName: user.computer.name,
        unlocked: false,
        expiresAt: {
          gte: new Date(),
        },
      },
      orderBy: {
        createdAt: "desc",
      },
    });

    // Obtener USBs conectadas actualmente
    const connectedUSBs = await (db as any).uSBConnection.findMany({
      where: {
        pcName: user.computer.name,
        isConnected: true,
      },
      orderBy: {
        lastSeen: "desc",
      },
    });

    // Obtener historial de conexiones USB
    const usbHistory = await (db as any).uSBConnection.findMany({
      where: {
        pcName: user.computer.name,
      },
      orderBy: {
        connectedAt: "desc",
      },
      take: 100, // Últimas 100 conexiones
    });

    const serializeConnection = (connection: any) => ({
      ...connection,
      size:
        connection?.size !== undefined && connection?.size !== null
          ? Number(connection.size)
          : 0,
      connectedAt:
        connection?.connectedAt instanceof Date
          ? connection.connectedAt.toISOString()
          : connection.connectedAt,
      lastSeen:
        connection?.lastSeen instanceof Date
          ? connection.lastSeen.toISOString()
          : connection.lastSeen,
      disconnectedAt:
        connection?.disconnectedAt instanceof Date
          ? connection.disconnectedAt.toISOString()
          : connection.disconnectedAt,
    });

    return NextResponse.json({
      ok: true,
      events,
      computer: user.computer,
      pendingUnlocks,
      connectedUSBs: connectedUSBs.map(serializeConnection),
      usbHistory: usbHistory.map(serializeConnection),
    });
  } catch (error: any) {
    console.error("Error en user-devices:", error);
    return NextResponse.json(
      { ok: false, error: error.message },
      { status: 500 }
    );
  }
}
