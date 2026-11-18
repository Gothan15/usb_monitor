import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireAuth } from "@/lib/auth";
import { aCsv, rangoExportacion } from "@/lib/csv";
import { logError } from "@/lib/logger";

/**
 * GET /api/admin/unlocks/exportar?desde=AAAA-MM-DD&hasta=AAAA-MM-DD
 * Los bloqueos (en curso, desbloqueados y cerrados) creados en
 * el rango, como CSV descargable (sin rango, los últimos 30
 * días; tope de 10 000 filas).
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
    const bloqueos = await db.pendingUnlock.findMany({
      where: { createdAt: { gte: rango.desde, lte: rango.hasta } },
      orderBy: { createdAt: "desc" },
      take: 10_000,
      include: { unlockedBy: { select: { username: true } } },
    });
    const filas = bloqueos.map((b) => ({
      Inicio: b.createdAt.toISOString().replace("T", " ").slice(0, 19),
      Equipo: b.pcName,
      Dispositivo: b.deviceLabel ?? "",
      Serial: b.serialNumber ?? "",
      Letra: b.driveLetter ?? "",
      Estado:
        b.status === "BLOCKED"
          ? "Bloqueado"
          : b.status === "UNLOCKED"
            ? "Desbloqueado"
            : "Cerrado",
      "En lista blanca": b.whitelisted ? "Sí" : "No",
      "Desbloqueó": b.unlockedBy?.username ?? "",
      "Desbloqueado el": b.unlockedAt
        ? b.unlockedAt.toISOString().replace("T", " ").slice(0, 19)
        : "",
      "Cerrado el": b.closedAt
        ? b.closedAt.toISOString().replace("T", " ").slice(0, 19)
        : "",
      "Motivo de cierre": b.closeReason ?? "",
    }));
    const csv = aCsv(
      [
        "Inicio",
        "Equipo",
        "Dispositivo",
        "Serial",
        "Letra",
        "Estado",
        "En lista blanca",
        "Desbloqueó",
        "Desbloqueado el",
        "Cerrado el",
        "Motivo de cierre",
      ],
      filas,
    );
    return new NextResponse(csv, {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="desbloqueos.csv"`,
      },
    });
  } catch (error: any) {
    if (error?.message === "UNAUTHORIZED" || error?.message === "FORBIDDEN") {
      return NextResponse.json({ error: "No autorizado" }, { status: 401 });
    }
    logError("Error en GET /api/admin/unlocks/exportar", error);
    return NextResponse.json(
      { error: "No se pudieron exportar los desbloqueos" },
      { status: 500 },
    );
  }
}
