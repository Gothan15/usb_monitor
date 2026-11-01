import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireAuth } from "@/lib/auth";
import { logError } from "@/lib/logger";

export async function GET(req: Request) {
  try {
    await requireAuth(req, { role: "admin", enforceCsrf: false });
    const computers = await db.computer.findMany({
      orderBy: { lastSeen: "desc" },
    });

    return NextResponse.json(computers);
  } catch (error) {
    if ((error as any)?.message === "UNAUTHORIZED")
      return NextResponse.json({ error: "No autorizado" }, { status: 401 });
    if ((error as any)?.message === "FORBIDDEN")
      return NextResponse.json({ error: "Acceso denegado" }, { status: 403 });
    logError("Error al obtener computadoras", error);
    return NextResponse.json(
      { error: "Error interno del servidor" },
      { status: 500 }
    );
  }
}

function sanitizeIds(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  for (const item of value) {
    if (typeof item === "string" && item.trim()) seen.add(item.trim());
    if (seen.size >= 500) break;
  }
  return [...seen];
}

export async function DELETE(req: Request) {
  try {
    await requireAuth(req, { role: "admin" });
    const body = await req.json().catch(() => null);
    const ids = sanitizeIds((body as any)?.ids);
    if (!ids.length) {
      return NextResponse.json(
        { ok: false, error: "Selecciona al menos un equipo" },
        { status: 400 }
      );
    }
    const existing = await db.computer.findMany({
      where: { id: { in: ids } },
      select: { id: true },
    });
    const found = existing.map((c) => c.id);
    if (found.length) {
      // Mismo criterio que el borrado individual: los usuarios del
      // equipo quedan desvinculados, no borrados.
      await db.$transaction([
        db.user.updateMany({
          where: { computerId: { in: found } },
          data: { computerId: null },
        }),
        db.computer.deleteMany({ where: { id: { in: found } } }),
      ]);
    }
    return NextResponse.json({
      ok: true,
      deleted: found.length,
      notFound: ids.filter((id) => !found.includes(id)),
    });
  } catch (error) {
    if ((error as any)?.message === "UNAUTHORIZED") {
      return NextResponse.json({ error: "No autorizado" }, { status: 401 });
    }
    if ((error as any)?.message === "FORBIDDEN") {
      return NextResponse.json({ error: "Acceso denegado" }, { status: 403 });
    }
    logError("Error al eliminar computadoras por lotes", error);
    return NextResponse.json(
      { ok: false, error: "Error interno del servidor" },
      { status: 500 }
    );
  }
}
