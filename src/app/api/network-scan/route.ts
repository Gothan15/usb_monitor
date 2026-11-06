import { NextRequest, NextResponse } from "next/server";
import { scanNetwork } from "@/lib/networkScanner";
import { hit } from "@/lib/rateLimit";
import { requireAuth } from "@/lib/auth";
import { logError } from "@/lib/logger";

export async function POST(req: NextRequest) {
  try {
    const auth = await requireAuth(req, { role: "admin" });
    const ip =
      (req.headers.get("x-forwarded-for") || "").split(",")[0].trim() ||
      "unknown";
    const rl = await hit(
      "net-scan",
      { windowMs: 60_000, max: 5 },
      { userId: auth.userId, ip }
    );
    if (!rl.allowed) {
      return NextResponse.json({ error: "Rate limit" }, { status: 429 });
    }
    const body = await req.json().catch(() => ({}));
    const cidr = body.cidr as string | undefined;
    const force = !!body.force;
    // Un solo motor de escaneo: el síncrono. El antiguo modo por
    // «trabajos» (async) no lo llamaba nadie y divergía de este.
    const { results, cached, limitado, cidrEscaneado } = await scanNetwork(
      cidr,
      { force }
    );
    const res = NextResponse.json({
      // El CIDR efectivamente escaneado: si la red pedida era mayor
      // que el tope, es la ventana /24 alrededor de la IP propia y
      // «limitado» va a true para que la interfaz lo avise (no es un
      // error: el escaneo se hizo, sobre un tramo).
      cidr: cidrEscaneado,
      redSolicitada: cidr || "auto",
      limitado,
      cached,
      count: results.length,
      results,
    });
    res.headers.set("Cache-Control", "no-store");
    return res;
  } catch (error: any) {
    if (error?.message === "UNAUTHORIZED")
      return NextResponse.json({ error: "No autorizado" }, { status: 401 });
    if (error?.message === "FORBIDDEN")
      return NextResponse.json({ error: "Acceso denegado" }, { status: 403 });
    if (error?.code === "CSRF_INVALID" || error?.code === "CSRF_MISSING") {
      return NextResponse.json({ error: "CSRF inválido" }, { status: 403 });
    }
    logError("Error en escaneo de red", error);
    return NextResponse.json(
      { error: error.message || "Error al escanear red" },
      { status: 500 }
    );
  }
}

export const dynamic = "force-dynamic";
