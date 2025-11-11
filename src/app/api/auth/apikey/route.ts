import { NextRequest, NextResponse } from "next/server";
import { requireAuth, generateApiKey } from "@/lib/auth";
import { db } from "@/lib/db";
import { logError } from "@/lib/logger";

export async function POST(req: NextRequest) {
  try {
    const { userId } = await requireAuth(req);
    const apiKey = generateApiKey();
    await (db as any).user.update({ where: { id: userId }, data: { apiKey } });
    const res = NextResponse.json({ apiKey });
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
    logError("Error rotando API key", error, { path: "/api/auth/apikey" });
    return NextResponse.json({ error: "Error interno" }, { status: 500 });
  }
}

export const dynamic = "force-dynamic";
