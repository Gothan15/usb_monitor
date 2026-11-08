import { NextResponse } from "next/server";
import fs from "fs/promises";
import path from "path";
import { db as prisma } from "@/lib/db";
import { requireAuth } from "@/lib/auth";
import { DEFAULT_SETTINGS, invalidarCacheAjustes } from "@/lib/appSettings";

const SETTINGS_PATH = path.join(process.cwd(), "config", "app_settings.json");

export async function GET() {
  try {
    let settings: Record<string, unknown> = {};
    try {
      const data = await fs.readFile(SETTINGS_PATH, "utf-8");
      settings = JSON.parse(data);
    } catch (e: any) {
      if (e.code !== "ENOENT") {
        console.error("Error reading settings file:", e);
      }
    }
    return NextResponse.json({
      ...DEFAULT_SETTINGS,
      startup_network_delay: settings.startup_network_delay ?? 15,
      ...settings,
    });
  } catch (error) {
    console.error("GET /api/settings error:", error);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    // Escribir ajustes exige sesión de administrador: entre ellos van
    // los interruptores del desbloqueo por contraseña (fase 5), que no
    // pueden quedar abiertos a cualquiera en la red.
    await requireAuth(req, { role: "admin" });
    const body = await req.json();
    let currentSettings: any = {};
    
    try {
      const data = await fs.readFile(SETTINGS_PATH, "utf-8");
      currentSettings = JSON.parse(data);
    } catch (e: any) {
      // Ignore if file doesn't exist
    }

    const newSettings = { ...currentSettings, ...body };
    
    await fs.mkdir(path.dirname(SETTINGS_PATH), { recursive: true });
    await fs.writeFile(SETTINGS_PATH, JSON.stringify(newSettings, null, 2), "utf-8");

    // El archivo ya es la nueva verdad: fuera la caché de ajustes en
    // Redis, para que la siguiente lectura no sirva los valores viejos.
    await invalidarCacheAjustes();

    // Sin empuje en caliente: el antiguo POST a :5001/config del
    // agente llevaba inservible desde el token por equipo (el
    // panel se acreditaba con la API key del dueño y el agente
    // esperaba otra cosa) y en el modelo de claves nadie puede
    // firmar como el panel. Los ajustes llegan a cada agente por
    // su sondeo firmado de configuración (máximo 10 minutos y al
    // arrancar), como ya ocurría en la práctica.

    return NextResponse.json({ success: true, settings: newSettings });
  } catch (error: any) {
    if (error?.message === "UNAUTHORIZED" || error?.message === "FORBIDDEN") {
      return NextResponse.json({ error: "No autorizado" }, { status: 401 });
    }
    console.error("POST /api/settings error:", error);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}
