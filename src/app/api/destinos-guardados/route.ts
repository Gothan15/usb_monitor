import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireAdminUser } from "@/lib/admin";
import { logError } from "@/lib/logger";

/**
 * Destinos de instalación remota guardados: nombre, dirección
 * y el usuario administrador DE ESE equipo. La contraseña no
 * se guarda jamás — se escribe al lanzar cada tarea.
 *
 * GET  → la lista guardada.
 * POST → guarda (crea o actualiza por dirección) el lote que
 *        manda el diálogo de instalación: { destinos: [...] }.
 */

export async function GET(req: NextRequest) {
  try {
    const admin = await requireAdminUser(req);
    if (!admin) {
      return NextResponse.json({ error: "No autorizado" }, { status: 401 });
    }
    const destinos = await db.destinoGuardado.findMany({
      orderBy: { nombre: "asc" },
    });
    return NextResponse.json({ ok: true, destinos });
  } catch (error) {
    logError("Error en GET /api/destinos-guardados", error);
    return NextResponse.json(
      { error: "No se pudieron leer los destinos guardados" },
      { status: 500 },
    );
  }
}

export async function POST(req: NextRequest) {
  try {
    const admin = await requireAdminUser(req);
    if (!admin) {
      return NextResponse.json({ error: "No autorizado" }, { status: 401 });
    }
    const body = await req.json().catch(() => null);
    const entradas = Array.isArray(body?.destinos) ? body.destinos : [];
    // Se acepta el lote tal cual viene del diálogo: cada
    // destino con nombre y dirección; el usuario puede ir
    // vacío (se escribe al lanzar). Sin dirección no hay fila.
    const limpios = entradas
      .map((d: any) => ({
        nombre: String(d?.nombre ?? d?.pcName ?? "").trim(),
        ip: String(d?.ip ?? "").trim(),
        usuario: String(d?.usuario ?? "").trim(),
      }))
      .filter((d: any) => d.ip.length > 0)
      .map((d: any) => ({ ...d, nombre: d.nombre || d.ip }));
    for (const d of limpios.slice(0, 200)) {
      await db.destinoGuardado.upsert({
        where: { ip: d.ip },
        create: d,
        update: { nombre: d.nombre, usuario: d.usuario },
      });
    }
    const destinos = await db.destinoGuardado.findMany({
      orderBy: { nombre: "asc" },
    });
    return NextResponse.json({ ok: true, destinos });
  } catch (error) {
    logError("Error en POST /api/destinos-guardados", error);
    return NextResponse.json(
      { error: "No se pudieron guardar los destinos" },
      { status: 500 },
    );
  }
}
