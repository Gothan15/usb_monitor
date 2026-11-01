import { NextResponse } from "next/server";
import { promises as fs } from "fs";
import path from "path";
import { requireServiceAuth } from "@/lib/auth";
import { readAppSettings } from "@/lib/appSettings";
import { registrarContactoAgente } from "@/lib/agentDebug";
import { logError } from "@/lib/logger";

/**
 * GET /api/agent/config
 * El agente pide sus ajustes al arrancar y periódicamente, en vez de
 * depender solo del empuje (POST /api/settings → :5001/config), que
 * no llega si el equipo está apagado cuando se guarda el cambio.
 * Devuelve únicamente los dos ajustes que el agente aplica en local:
 * la espera de red al arranque y el bloqueo de sesión al conectar.
 */
export async function GET(req: Request) {
  try {
    await requireServiceAuth(req);

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
    const res = NextResponse.json({
      ok: true,
      startupNetworkDelay,
      lockSessionOnInsert: settings.lockSessionOnInsert,
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
