import { NextRequest, NextResponse } from "next/server";
import { remoteInstallAndStart } from "@/lib/networkScanner";
import { hit } from "@/lib/rateLimit";
import { requireAuth } from "@/lib/auth";
import { logError } from "@/lib/logger";

export async function POST(req: NextRequest) {
  try {
    const auth = await requireAuth(req, { role: "admin" });
    const ipClient =
      (req.headers.get("x-forwarded-for") || "").split(",")[0].trim() ||
      "unknown";
    const rl = await hit(
      `remote-install`,
      {
        windowMs: 10 * 60_000,
        max: 10,
      },
      { userId: auth.userId, ip: ipClient }
    );
    if (!rl.allowed) {
      return NextResponse.json({ error: "Rate limit" }, { status: 429 });
    }
    const body = await req.json();
    const ip = body.ip as string;
    if (typeof ip !== "string" || !ip.trim())
      return NextResponse.json({ error: "Falta ip" }, { status: 400 });
    const result = await remoteInstallAndStart(ip.trim());
    const res = NextResponse.json(result, {
      status: result.success ? 200 : 501,
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
    logError("Error en remote install", error);
    return NextResponse.json(
      { error: error.message || "Error" },
      { status: 500 }
    );
  }
}

export const dynamic = "force-dynamic";
