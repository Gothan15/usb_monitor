import { NextRequest, NextResponse } from "next/server";
import {
  remoteInstall,
  remoteUninstall,
  remoteStart,
  remoteStop,
  remoteStatus,
  summarize,
} from "@/lib/winrmService";
import { db } from "@/lib/db";
import { requireAuth } from "@/lib/auth";

type ServiceAction = "install" | "uninstall" | "start" | "stop" | "status";

export async function POST(
  req: NextRequest,
  { params }: { params: { action: ServiceAction } }
) {
  try {
    await requireAuth(req); // JWT en Authorization: Bearer <token>
    const { ip } = await req.json();
    if (!ip) return NextResponse.json({ error: "Falta ip" }, { status: 400 });
    const action = params.action;

    let raw;
    if (action === "install") raw = await remoteInstall(ip);
    else if (action === "uninstall") raw = await remoteUninstall(ip);
    else if (action === "start") raw = await remoteStart(ip);
    else if (action === "stop") raw = await remoteStop(ip);
    else if (action === "status") raw = await remoteStatus(ip);
    else
      return NextResponse.json(
        { error: "Acción no soportada" },
        { status: 400 }
      );

    const summary = summarize(raw, action);
    // Persistir si tenemos flags
    if (
      summary.serviceInstalled !== undefined ||
      summary.serviceRunning !== undefined
    ) {
      try {
        await (db as any).computer.upsert({
          where: { name: ip },
          update: {
            ipAddress: ip,
            lastSeen: new Date(),
            isActive: true,
            serviceInstalled: summary.serviceInstalled ?? undefined,
            serviceRunning: summary.serviceRunning ?? undefined,
            lastServiceCheck: new Date(),
          } as any,
          create: {
            name: ip,
            ipAddress: ip,
            lastSeen: new Date(),
            isActive: true,
            serviceInstalled: summary.serviceInstalled ?? false,
            serviceRunning: summary.serviceRunning ?? false,
            lastServiceCheck: new Date(),
          } as any,
        });
      } catch (e) {
        console.error("No se pudo persistir estado de servicio", e);
      }
    }
    return NextResponse.json(summary, { status: summary.success ? 200 : 500 });

    return NextResponse.json({ error: "Acción no soportada" }, { status: 400 });
  } catch (error: any) {
    console.error("Error en control de servicio:", error);
    return NextResponse.json(
      { error: error.message || "Error" },
      { status: 500 }
    );
  }
}

export const dynamic = "force-dynamic";
