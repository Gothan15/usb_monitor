import { NextRequest, NextResponse } from "next/server";
import { getAllLocalNetworks } from "@/lib/networkScanner";
import { requireAuth } from "@/lib/auth";

export async function GET(req: NextRequest) {
  try {
    await requireAuth(req, { role: "admin", enforceCsrf: false });
  } catch (e: any) {
    if (e.message === "UNAUTHORIZED")
      return NextResponse.json({ error: "No autorizado" }, { status: 401 });
    if (e.message === "FORBIDDEN")
      return NextResponse.json({ error: "Acceso denegado" }, { status: 403 });
  }

  const interfaces = getAllLocalNetworks();
  const res = NextResponse.json({ interfaces });
  res.headers.set("Cache-Control", "no-store");
  return res;
}

export const dynamic = "force-dynamic";
