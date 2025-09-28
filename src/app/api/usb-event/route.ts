import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireAuth } from "@/lib/auth"; // Sólo se usará para GET (consulta), no para POST (ingesta)

export async function POST(request: NextRequest) {
  try {
    // Ingesta abierta: NO requiere autenticación (según petición).
    // Considera en el futuro: firma compartida, lista blanca IP o token simple.
    const body = await request.json();

    const { pc_name, pc_ip, pc_user, event } = body;

    if (!pc_name || !pc_ip || !pc_user || !event) {
      return NextResponse.json(
        { error: "Faltan campos requeridos" },
        { status: 400 }
      );
    }

    // Guardar el evento USB en la base de datos
    const usbEvent = await db.uSBEvent.create({
      data: {
        pcName: pc_name,
        pcIp: pc_ip,
        pcUser: pc_user,
        event: event,
        timestamp: new Date(),
      },
    });

    // Actualizar o crear registro de computadora
    await db.computer.upsert({
      where: { name: pc_name },
      update: {
        ipAddress: pc_ip,
        lastSeen: new Date(),
        isActive: true,
      },
      create: {
        name: pc_name,
        ipAddress: pc_ip,
        lastSeen: new Date(),
        isActive: true,
      },
    });

    console.log(`Evento USB recibido: ${event} desde ${pc_name} (${pc_ip})`);

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
    const events = await db.uSBEvent.findMany({
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
