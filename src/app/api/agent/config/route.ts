import { NextResponse } from "next/server";
import { promises as fs } from "fs";
import path from "path";
import { requireServiceAuth } from "@/lib/auth";
import { readAppSettings } from "@/lib/appSettings";
import { registrarContactoAgente } from "@/lib/agentDebug";
import { logError } from "@/lib/logger";
import { db } from "@/lib/db";
import {
  ESTADO_ORDEN,
  ESTADOS_ORDEN_ACTIVA,
} from "@/lib/agentCommands";
import { getCurrentDate } from "@/lib/time";

/**
 * GET /api/agent/config
 * El agente pide sus ajustes al arrancar y periódicamente, en vez de
 * depender solo del empuje (POST /api/settings → :5001/config), que
 * no llega si el equipo está apagado cuando se guarda el cambio.
 * Devuelve únicamente los ajustes que el agente aplica en local:
 * la espera de red al arranque, el bloqueo de sesión al conectar
 * y el apagado ante un dispositivo fuera de la lista blanca.
 */
export async function GET(req: Request) {
  try {
    const serviceAuth = await requireServiceAuth(req);

    const settings = await readAppSettings();
    let startupNetworkDelay = 15;
    try {
      const raw = await fs.readFile(
        path.join(process.cwd(), "config", "app_settings.json"),
        "utf-8"
      );
      const parsed = JSON.parse(raw);
      if (typeof parsed.startup_network_delay === "number") {
        startupNetworkDelay = parsed.startup_network_delay;
      }
    } catch {
      // Sin archivo: el valor por defecto manda.
    }

    registrarContactoAgente(null, "/api/agent/config", 200);
    // La cuenta atrás se sirve siempre acotada: ni un valor
    // editado a mano en el JSON puede armar un apagado inmediato
    // ni uno de horas.
    const shutdownCountdownSeconds = Math.min(
      600,
      Math.max(10, Number(settings.shutdownCountdownSeconds) || 60),
    );
    // Canal de órdenes: si la credencial es el token de un equipo,
    // la respuesta lleva sus órdenes activas y las que estaban en
    // ESPERA quedan marcadas ENTREGADA con su fecha. Las EN_CURSO
    // se siguen sirviendo: tras el reinicio que trae una
    // actualización, el agente las concilia (confirma HECHA si ya
    // corre la versión objetivo; si no, reintenta hasta el tope).
    let comandos: Array<{
      id: string;
      tipo: string;
      estado: string;
      versionObjetivo: string | null;
      intentos: number;
    }> = [];
    if (serviceAuth.computerId) {
      const activas = await db.agentCommand.findMany({
        where: {
          computerId: serviceAuth.computerId,
          status: { in: ESTADOS_ORDEN_ACTIVA },
        },
        orderBy: { createdAt: "asc" },
        select: {
          id: true,
          type: true,
          status: true,
          targetVersion: true,
          attempts: true,
        },
      });
      const enEspera = activas
        .filter((c) => c.status === ESTADO_ORDEN.ESPERA)
        .map((c) => c.id);
      if (enEspera.length > 0) {
        await db.agentCommand.updateMany({
          where: { id: { in: enEspera } },
          data: {
            status: ESTADO_ORDEN.ENTREGADA,
            deliveredAt: getCurrentDate(),
          },
        });
      }
      comandos = activas.map((c) => ({
        id: c.id,
        tipo: c.type,
        estado:
          c.status === ESTADO_ORDEN.ESPERA
            ? ESTADO_ORDEN.ENTREGADA
            : c.status,
        versionObjetivo: c.targetVersion,
        intentos: c.attempts,
      }));
    }

    const res = NextResponse.json({
      ok: true,
      startupNetworkDelay,
      lockSessionOnInsert: settings.lockSessionOnInsert,
      shutdownOnNonWhitelisted: settings.shutdownOnNonWhitelisted,
      shutdownCountdownSeconds,
      captureEvidenceOnNonWhitelisted:
        settings.captureEvidenceOnNonWhitelisted,
      comandos,
    });
    res.headers.set("Cache-Control", "no-store");
    return res;
  } catch (error: any) {
    if (error?.message === "UNAUTHORIZED") {
      registrarContactoAgente(null, "/api/agent/config", 401);
      return NextResponse.json(
        { ok: false, error: "No autorizado" },
        { status: 401 }
      );
    }
    logError("Error en agent/config", error);
    return NextResponse.json(
      { ok: false, error: error.message },
      { status: 500 }
    );
  }
}
