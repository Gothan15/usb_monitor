import { NextRequest, NextResponse } from "next/server";
import { remoteStatus, summarize } from "@/lib/winrmService";
import { db } from "@/lib/db";
import { requireAuth } from "@/lib/auth";

async function tryHealth(ip: string) {
  try {
    const controller = new AbortController();
    const t = setTimeout(() => controller.abort(), 1500);
    const res = await fetch(`http://${ip}:5001/health`, {
      signal: controller.signal,
    });
    clearTimeout(t);
    if (res.ok) return await res.json();
  } catch {}
  return null;
}

export async function POST(req: NextRequest) {
  try {
    await requireAuth(req); // JWT en Authorization: Bearer <token>
    const { ip } = await req.json();
    if (!ip) return NextResponse.json({ error: "Falta ip" }, { status: 400 });
    const raw = await remoteStatus(ip);
    const statusSummary = summarize(raw, "status");
    const health = await tryHealth(ip);
    const serviceInstalled = statusSummary.serviceInstalled ?? !!health;
    const serviceRunning = statusSummary.serviceRunning ?? !!health;
    await (db as any).computer.upsert({
      where: { name: ip },
      update: {
        ipAddress: ip,
        lastSeen: new Date(),
        isActive: true,
        serviceInstalled,
        serviceRunning,
        lastServiceCheck: new Date(),
        agentVersion: health?.version ?? undefined,
      },
      create: {
        name: ip,
        ipAddress: ip,
        lastSeen: new Date(),
        isActive: true,
        serviceInstalled,
        serviceRunning,
        lastServiceCheck: new Date(),
        agentVersion: health?.version ?? null,
      },
    });
    return NextResponse.json({
      ip,
      serviceInstalled,
      serviceRunning,
      agentVersion: health?.version || null,
      winrm: statusSummary,
      health,
    });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}

export const dynamic = "force-dynamic";
