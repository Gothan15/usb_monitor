import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireAuth } from "@/lib/auth";
import { logError } from "@/lib/logger";
import { readAppSettings } from "@/lib/appSettings";
import { getCurrentDate } from "@/lib/time";
import { manifiestoPaquete } from "@/lib/paqueteAgente";
import { necesitaActualizacion } from "@/lib/versionesAgente";

export async function GET(req: Request) {
  try {
    await requireAuth(req, { role: "admin", enforceCsrf: false });
    const computers = await db.computer.findMany({
      orderBy: { lastSeen: "desc" },
    });

    // UNA sola verdad para «¿está activo el servicio en esta PC?»:
    // el agente ES el servicio, así que el servicio está activo si
    // el agente ha dado señal hace poco (latido cada 30 s; umbral =
    // el del método 3, silenceThresholdMinutes, mín. 2 min).
    // Antes convivían dos datos: isActive (lo alimenta el latido,
    // funcionaba) y serviceRunning (solo lo escribían el escáner,
    // la instalación remota y una sonda a http://<ip>:5001/health
    // que nunca puede responder: el agente escucha solo en
    // 127.0.0.1 y su ruta es /estado, no /health). Resultado: la
    // pestaña Equipos enseñaba «Servicio: Sin respuesta» en PCs
    // con el servicio en marcha, y el botón de ver USB salía
    // deshabilitado. Aquí ambos campos se derivan de la señal.
    const settings = await readAppSettings();
    const umbralMs =
      Math.max(2, settings.silenceThresholdMinutes || 5) * 60_000;
    const ahora = getCurrentDate().getTime();

    // Versión del paquete que sirve el panel: contra ella se
    // sabe si el agente de cada equipo (agentVersion, la que el
    // ping guarda desde la fase B) va por detrás y necesita
    // actualizarse por el canal.
    const manifiesto = await manifiestoPaquete();
    const versionPaquete = manifiesto?.version ?? null;

    const conEstadoReal = computers.map((computer) => {
      const activo =
        computer.lastSeen != null &&
        ahora - new Date(computer.lastSeen).getTime() <= umbralMs;
      return {
        ...computer,
        isActive: activo,
        serviceRunning: activo,
        versionPaquete,
        actualizacionDisponible: necesitaActualizacion(
          computer.agentVersion,
          versionPaquete,
        ),
      };
    });

    return NextResponse.json(conEstadoReal);
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
