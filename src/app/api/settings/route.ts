import { NextResponse } from "next/server";
import fs from "fs/promises";
import path from "path";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const SETTINGS_PATH = path.join(process.cwd(), "config", "app_settings.json");

export async function GET() {
  try {
    let settings = {};
    try {
      const data = await fs.readFile(SETTINGS_PATH, "utf-8");
      settings = JSON.parse(data);
    } catch (e: any) {
      if (e.code !== "ENOENT") {
        console.error("Error reading settings file:", e);
      }
    }
    return NextResponse.json({
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
    if (body.startup_network_delay !== undefined) {
      const computers = await prisma.computer.findMany({
        where: { isActive: true },
      });

      const servicePort = process.env.USB_SERVICE_PORT || "5001";

      const fetchPromises = computers.map(async (computer) => {
        if (!computer.ipAddress) return;
        try {
          const url = `http://${computer.ipAddress}:${servicePort}/config`;
          console.log(`Pushing config to ${url}`);
          await fetch(url, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
            },
            body: JSON.stringify({ startup_network_delay: Number(body.startup_network_delay) }),
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
  } catch (error) {
    console.error("POST /api/settings error:", error);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}
