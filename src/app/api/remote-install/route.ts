import { NextRequest, NextResponse } from "next/server";
import { remoteInstallAndStart } from "@/lib/networkScanner";
import { hit } from "@/lib/rateLimit";
import { requireAuth } from "@/lib/auth";

export async function POST(req: NextRequest) {
  try {
    await requireAuth(req);
    const ipClient =
      (req.headers.get("x-forwarded-for") || "").split(",")[0].trim() ||
      "unknown";
    const rl = hit(`remote-install:${ipClient}`, {
      windowMs: 10 * 60_000,
      max: 10,
    });
    if (!rl.allowed) {
      return NextResponse.json({ error: "Rate limit" }, { status: 429 });
    }
    const body = await req.json();
    const ip = body.ip as string;
    if (!ip) return NextResponse.json({ error: "Falta ip" }, { status: 400 });
    const result = await remoteInstallAndStart(ip);
    return NextResponse.json(result, { status: result.success ? 200 : 501 });
  } catch (error: any) {
    console.error("Error en remote install:", error);
    return NextResponse.json(
      { error: error.message || "Error" },
      { status: 500 }
    );
  }
}

export const dynamic = "force-dynamic";
