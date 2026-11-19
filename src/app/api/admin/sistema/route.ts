import { NextRequest, NextResponse } from "next/server";
import { promises as fs } from "fs";
import { db } from "@/lib/db";
import { requireAuth } from "@/lib/auth";
import { obtenerRedis } from "@/lib/redis";
import { manifiestoPaquete } from "@/lib/paqueteAgente";
import { logError } from "@/lib/logger";

/**
 * GET /api/admin/sistema
 * El parte de salud del propio panel para la sección «Estado
 * del sistema» de Ajustes: base de datos, Redis (conectado o
 * en modo degradado — sin Redis el panel sigue, pero calla),
 * disco, tiempo en marcha y el paquete del agente colocado.
 */
export async function GET(req: NextRequest) {
  try {
    await requireAuth(req, { role: "admin" });

    let bdOk = false;
    try {
      // La prueba de vida va por el constructor de consultas, no
      // con SQL crudo: el cliente compartido tiene el SQL crudo
      // prohibido a propósito (db.ts lo bloquea), y el antiguo
      // $queryRaw`SELECT 1` chocaba con ese bloqueo SIEMPRE — el
      // parte salía «sin conexión» con la base de datos sana y el
      // panel guardando sin problema. findFirst con solo el id es
      // la lectura más barata y vale igual como prueba.
      await db.user.findFirst({ select: { id: true } });
      bdOk = true;
    } catch {
      bdOk = false;
    }

    // Redis: sin URL no está configurado; con URL, un PING
    // dice si responde o si el panel va en modo degradado.
    let redis: "conectado" | "degradado" | "no-configurado" =
      "no-configurado";
    if (process.env.REDIS_URL) {
      redis = "degradado";
      try {
        const cliente = await obtenerRedis();
        if (cliente) {
          await cliente.ping();
          redis = "conectado";
        }
      } catch {
        redis = "degradado";
      }
    }

    let disco: { libre: number; total: number } | null = null;
    try {
      const stats = await fs.statfs(process.cwd());
      disco = {
        libre: stats.bavail * stats.bsize,
        total: stats.blocks * stats.bsize,
      };
    } catch {
      disco = null;
    }

    const manifiesto = await manifiestoPaquete().catch(() => null);

    return NextResponse.json({
      ok: true,
      bd: bdOk ? "conectada" : "error",
      redis,
      disco,
      nodeVersion: process.version,
      encendidoDesde: new Date(Date.now() - process.uptime() * 1000),
      paquete: manifiesto
        ? { version: manifiesto.version }
        : null,
    });
  } catch (error: any) {
    if (error?.message === "UNAUTHORIZED" || error?.message === "FORBIDDEN") {
      return NextResponse.json({ error: "No autorizado" }, { status: 401 });
    }
    logError("Error en GET /api/admin/sistema", error);
    return NextResponse.json(
      { error: "No se pudo leer el estado del sistema" },
      { status: 500 },
    );
  }
}
