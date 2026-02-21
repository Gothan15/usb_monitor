import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireAuth } from "@/lib/auth";
import { getCurrentDate } from "@/lib/time";
import { hit } from "@/lib/rateLimit";
import { logError } from "@/lib/logger";
import { remoteStatus, summarize } from "@/lib/winrmService";

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
    const auth = await requireAuth(req, { role: "admin" });
    const { ip } = await req.json();
    if (typeof ip !== "string" || !ip.trim())
      return NextResponse.json({ error: "Falta ip" }, { status: 400 });
    const normalizedIp = ip.trim();
    const clientIp =
      (req.headers.get("x-forwarded-for") || "").split(",")[0].trim() ||
      "unknown";
    const rl = await hit(
      "refresh-host",
      { windowMs: 30_000, max: 5 },
      { userId: auth.userId, ip: clientIp }
    );
    if (!rl.allowed) {
      return NextResponse.json({ error: "Rate limit" }, { status: 429 });
    }
    const health = await tryHealth(normalizedIp);
    const serviceInstalled = !!health;
    const serviceRunning = !!health;
    const winrmResult = await remoteStatus(normalizedIp);
    const winrm = summarize(winrmResult, "status");
    const checkedAt = getCurrentDate();
    await db.computer.upsert({
      where: { name: normalizedIp },
      update: {
        ipAddress: normalizedIp,
        lastSeen: checkedAt,
        isActive: true,
        serviceInstalled,
        serviceRunning,
        lastServiceCheck: checkedAt,
        agentVersion: health?.version ?? undefined,
      },
      create: {
        name: normalizedIp,
        ipAddress: normalizedIp,
        lastSeen: checkedAt,
        isActive: true,
        serviceInstalled,
        serviceRunning,
        lastServiceCheck: checkedAt,
        agentVersion: health?.version ?? null,
      },
    });
    const res = NextResponse.json({
      ip: normalizedIp,
      serviceInstalled,
      serviceRunning,
      agentVersion: health?.version || null,
      winrm,
      health,
    });
    res.headers.set("Cache-Control", "no-store");
    return res;
  } catch (e: any) {
    if (e?.message === "UNAUTHORIZED")
      return NextResponse.json({ error: "No autorizado" }, { status: 401 });
    if (e?.message === "FORBIDDEN")
      return NextResponse.json({ error: "Acceso denegado" }, { status: 403 });
    if (e?.code === "CSRF_INVALID" || e?.code === "CSRF_MISSING") {
      return NextResponse.json({ error: "CSRF inválido" }, { status: 403 });
    }
    logError("Error en refresh-host", e);
    return NextResponse.json({ error: "Error" }, { status: 500 });
  }
}

export const dynamic = "force-dynamic";
