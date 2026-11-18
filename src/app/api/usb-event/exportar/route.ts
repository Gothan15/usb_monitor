import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireAuth } from "@/lib/auth";
import { aCsv, rangoExportacion } from "@/lib/csv";
import { etiquetaEventoUsb } from "@/lib/eventosUsb";
import { logError } from "@/lib/logger";

/**
 * GET /api/usb-event/exportar?desde=AAAA-MM-DD&hasta=AAAA-MM-DD
 * Los eventos USB del rango como CSV descargable (sin rango,
 * los últimos 30 días; tope de 10 000 filas).
 */
export async function GET(req: NextRequest) {
  try {
    await requireAuth(req, { role: "admin" });
    const { searchParams } = new URL(req.url);
    const rango = rangoExportacion(
      searchParams.get("desde"),
      searchParams.get("hasta"),
    );
    if (!rango) {
      return NextResponse.json(
        { error: "Fechas no válidas" },
        { status: 400 },
      );
    }
    const eventos = await db.uSBEvent.findMany({
      where: { timestamp: { gte: rango.desde, lte: rango.hasta } },
      orderBy: { timestamp: "desc" },
      take: 10_000,
    });
    const filas = eventos.map((e) => ({
      Fecha: e.timestamp.toISOString().slice(0, 10),
      Hora: e.timestamp.toISOString().slice(11, 19),
      Equipo: e.pcName,
      "IP": e.pcIp,
      "Usuario de la PC": e.pcUser,
      Evento: etiquetaEventoUsb(e.event),
      "Código": e.event,
      Serial: e.serialNumber ?? "",
      Letra: e.driveLetter ?? "",
      "En lista blanca": e.whitelisted ? "Sí" : "No",
      "Autorizó": e.unlockedBy ?? "",
    }));
    const csv = aCsv(
      [
        "Fecha",
        "Hora",
        "Equipo",
        "IP",
        "Usuario de la PC",
        "Evento",
        "Código",
        "Serial",
        "Letra",
        "En lista blanca",
        "Autorizó",
      ],
      filas,
    );
    return new NextResponse(csv, {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="eventos-usb.csv"`,
      },
    });
  } catch (error: any) {
    if (error?.message === "UNAUTHORIZED" || error?.message === "FORBIDDEN") {
      return NextResponse.json({ error: "No autorizado" }, { status: 401 });
    }
    logError("Error en GET /api/usb-event/exportar", error);
    return NextResponse.json(
      { error: "No se pudieron exportar los eventos" },
      { status: 500 },
    );
  }
}
