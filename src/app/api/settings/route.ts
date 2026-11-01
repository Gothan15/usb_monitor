import { NextResponse } from "next/server";
import fs from "fs/promises";
import path from "path";
import { PrismaClient } from "@prisma/client";
import { requireAuth } from "@/lib/auth";
import { DEFAULT_SETTINGS } from "@/lib/appSettings";

const prisma = new PrismaClient();
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

    // Push new setting to active computers if startup_network_delay changed or provided
    if (body.startup_network_delay !== undefined || body.lockSessionOnInsert !== undefined) {
      const computers = await prisma.computer.findMany({
        where: { isActive: true },
      });

      const servicePort = process.env.USB_SERVICE_PORT || "5001";

      const fetchPromises = computers.map(async (computer) => {
        if (!computer.ipAddress) return;
        try {
          const url = `http://${computer.ipAddress}:${servicePort}/config`;
          console.log(`Pushing config to ${url}`);
          // El agente exige credencial en /config (fase 3): se usa la
          // API key del usuario dueño del equipo, que el agente conoce.
          const owner = await prisma.user.findFirst({
            where: { computerId: computer.id },
            select: { apiKey: true },
          });
          const payload: Record<string, unknown> = {};
          if (body.startup_network_delay !== undefined) {
            payload.startup_network_delay = Number(body.startup_network_delay);
          }
          if (body.lockSessionOnInsert !== undefined) {
            payload.lock_session_on_insert = Boolean(body.lockSessionOnInsert);
          }
          await fetch(url, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              ...(owner?.apiKey
                ? { Authorization: `ApiKey ${owner.apiKey}` }
                : {}),
            },
            body: JSON.stringify(payload),
            signal: AbortSignal.timeout(5000), // 5s timeout
          });
        } catch (err: any) {
          console.error(`Failed to push config to computer ${computer.ipAddress}:`, err.message);
        }
      });

      // We don't await Promise.all here so we don't block the response, or we could.
      // Better to await it so we know if it succeeded? The requirements don't specify, but fire-and-forget is safer for UI responsiveness.
      Promise.allSettled(fetchPromises);
    }

    return NextResponse.json({ success: true, settings: newSettings });
  } catch (error: any) {
    if (error?.message === "UNAUTHORIZED" || error?.message === "FORBIDDEN") {
      return NextResponse.json({ error: "No autorizado" }, { status: 401 });
    }
    console.error("POST /api/settings error:", error);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}
