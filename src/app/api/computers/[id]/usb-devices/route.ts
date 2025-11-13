import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireAuth } from "@/lib/auth";
import { logError } from "@/lib/logger";

type RouteContext = {
  params: Promise<{
    id: string;
  }>;
};

function toNumber(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof (value as any) === "bigint") return Number(value);
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

export async function GET(req: Request, context: RouteContext) {
  try {
    await requireAuth(req, { role: "admin", enforceCsrf: false });

    const { params } = context;
    const { id: rawId } = await params;
    const id = rawId?.trim();
    if (!id) {
      return NextResponse.json(
        { ok: false, error: "ID de equipo requerida" },
        { status: 400 }
      );
    }

    const url = new URL(req.url);
    const type = (url.searchParams.get("type") || "connected").toLowerCase();
    const historyDays = Math.max(
      1,
      Math.min(30, Number(url.searchParams.get("historyDays") || 1))
    );

    if (type !== "connected" && type !== "history") {
      return NextResponse.json(
        { ok: false, error: "Parámetro 'type' inválido" },
        { status: 400 }
      );
    }

    const computer = await db.computer.findUnique({ where: { id } });
    if (!computer) {
      return NextResponse.json(
        { ok: false, error: "Equipo no encontrado" },
        { status: 404 }
      );
    }

    const since = new Date(Date.now() - historyDays * 24 * 60 * 60 * 1000);

    if (type === "connected") {
      const rows = await db.uSBConnection.findMany({
        where: {
          pcName: computer.name,
          isConnected: true,
        },
        orderBy: { lastSeen: "desc" },
        take: 200,
      });

      const serials = Array.from(
        new Set(rows.map((r) => r.serialNumber).filter(Boolean))
      );
      const whitelisted = await db.uSBWhitelist.findMany({
        where: { serialNumber: { in: serials } },
        select: { serialNumber: true },
      });
      const whiteSet = new Set(whitelisted.map((w) => w.serialNumber));

      const items = rows.map((r) => ({
        id: r.id,
        pcName: r.pcName,
        driveLetter: r.driveLetter,
        volumeName: r.volumeName,
        serialNumber: r.serialNumber,
        model: r.model,
        size: toNumber(r.size),
        lastSeen: r.lastSeen.toISOString(),
        connectedAt: r.connectedAt.toISOString(),
        isConnected: r.isConnected,
        isWhitelisted: whiteSet.has(r.serialNumber),
      }));

      return NextResponse.json({ ok: true, items });
    }

    // history
    const rows = await db.uSBConnection.findMany({
      where: {
        pcName: computer.name,
        isConnected: false,
        disconnectedAt: { gte: since },
      },
      orderBy: { disconnectedAt: "desc" },
      take: 300,
    });

    const serials = Array.from(
      new Set(rows.map((r) => r.serialNumber).filter(Boolean))
    );
    const whitelisted = await db.uSBWhitelist.findMany({
      where: { serialNumber: { in: serials } },
      select: { serialNumber: true },
    });
    const whiteSet = new Set(whitelisted.map((w) => w.serialNumber));

    const items = rows.map((r) => ({
      id: r.id,
      pcName: r.pcName,
      driveLetter: r.driveLetter,
      volumeName: r.volumeName,
      serialNumber: r.serialNumber,
      model: r.model,
      size: toNumber(r.size),
      connectedAt: r.connectedAt.toISOString(),
      disconnectedAt: r.disconnectedAt?.toISOString() ?? null,
      lastSeen: r.lastSeen.toISOString(),
      isConnected: r.isConnected,
      isWhitelisted: whiteSet.has(r.serialNumber),
    }));

    return NextResponse.json({ ok: true, items });
  } catch (error) {
    if ((error as any)?.message === "UNAUTHORIZED")
      return NextResponse.json({ error: "No autorizado" }, { status: 401 });
    if ((error as any)?.message === "FORBIDDEN")
      return NextResponse.json({ error: "Acceso denegado" }, { status: 403 });
    logError("Error al obtener dispositivos USB por equipo", error);
    return NextResponse.json(
      { ok: false, error: "Error interno del servidor" },
      { status: 500 }
    );
  }
}
