import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireAuth } from "@/lib/auth";
import { getCurrentDate } from "@/lib/time";
import { hit } from "@/lib/rateLimit";
import { logError } from "@/lib/logger";
import { probeWinRM } from "@/lib/winrmService";
import { checkServiceHealth } from "@/lib/serviceNotifier";
import { getAllLocalNetworks } from "@/lib/networkScanner";

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
    // Sonda real al agente: /estado (la ruta actual; /health era
    // del agente viejo) vía checkServiceHealth. El agente escucha
    // SOLO en 127.0.0.1, así que para las IPs del propio panel se
    // sonda por loopback; para el resto de PCs la sonda no puede
    // llegar (por diseño) y el estado verdadero es la señal del
    // agente en el panel, no esta sonda.
    const ipsPropias = new Set(
      getAllLocalNetworks().map((n) => n.address),
    );
    const ipSonda = ipsPropias.has(normalizedIp) ? "127.0.0.1" : normalizedIp;
    const resultado = await checkServiceHealth(ipSonda);
    const health = resultado.available ? resultado : null;
    const serviceInstalled = !!health;
    const serviceRunning = !!health;
    // Estado WinRM real sin credenciales: sonda WS-Man Identify
    // (no requiere autenticación). Dice si el listener está activo y
    // qué protocolo habla; el estado del servicio vía WinRM requiere
    // credenciales, que esta ruta no recibe, así que va en null.
    const probe = await probeWinRM(normalizedIp);
    const winrm = {
      success: probe.available,
      action: "status",
      available: probe.available,
      protocolVersion: probe.protocolVersion,
      productVersion: probe.productVersion,
      auth: probe.auth,
      error: probe.available ? null : (probe.error ?? null),
      serviceInstalled: null,
      serviceRunning: null,
    };
    const checkedAt = getCurrentDate();
    // OJO: una sonda del panel NO es señal del agente. Antes esta
    // ruta escribía lastSeen = ahora e isActive = true al
    // comprobar, y la pestaña Equipos enseñaba «última conexión:
    // ahora» en PCs cuyo agente llevaba días caído. lastSeen solo
    // lo mueve el propio agente (ping y eventos); aquí se guarda
    // únicamente el resultado de la comprobación.
    await db.computer.upsert({
      where: { name: normalizedIp },
      update: {
        ipAddress: normalizedIp,
        serviceInstalled,
        serviceRunning,
        lastServiceCheck: checkedAt,
        agentVersion: health?.serviceVersion ?? undefined,
      },
      create: {
        name: normalizedIp,
        ipAddress: normalizedIp,
        serviceInstalled,
        serviceRunning,
        lastServiceCheck: checkedAt,
        agentVersion: health?.serviceVersion ?? null,
      },
    });
    const res = NextResponse.json({
      ip: normalizedIp,
      serviceInstalled,
      serviceRunning,
      agentVersion: health?.serviceVersion || null,
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
