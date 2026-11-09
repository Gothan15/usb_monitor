import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireAuth } from "@/lib/auth";
import { getCurrentDate } from "@/lib/time";
import { hit } from "@/lib/rateLimit";
import { logError } from "@/lib/logger";
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
    const checkedAt = getCurrentDate();
    // OJO: una sonda del panel NO es señal del agente. Antes esta
    // ruta escribía lastSeen = ahora e isActive = true al
    // comprobar, y la pestaña Equipos enseñaba «última conexión:
    // ahora» en PCs cuyo agente llevaba días caído. lastSeen solo
    // lo mueve el propio agente (ping y eventos); aquí se guarda
    // únicamente el resultado de la comprobación.
    //
    // Y la fila se busca POR IP, nunca se crea con la IP como
    // nombre: esta ruta hacía upsert con `name = ip` y así nació
    // la fila duplicada «por IP» junto a la fila por nombre de
    // la misma PC (con su credencial y su dueño en la otra). Si
    // ninguna fila tiene esta IP, la sonda se devuelve a la
    // vista pero no se inventa un equipo: el alta es del agente
    // al reportar, del escáner con nombre o del administrador.
    const existente = await db.computer.findFirst({
      where: { ipAddress: normalizedIp },
      select: { id: true },
    });
    if (existente) {
      await db.computer.update({
        where: { id: existente.id },
        data: {
          serviceInstalled,
          serviceRunning,
          lastServiceCheck: checkedAt,
          agentVersion: health?.serviceVersion ?? undefined,
        },
      });
    }
    const res = NextResponse.json({
      ip: normalizedIp,
      serviceInstalled,
      serviceRunning,
      agentVersion: health?.serviceVersion || null,
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
