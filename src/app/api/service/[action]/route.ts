import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
import { isValidIPv4 } from "@/lib/validators";

type ServiceAction = "install" | "uninstall" | "start" | "stop" | "status";

export async function POST(
  req: NextRequest,
  { params }: { params: { action: ServiceAction } }
) {
  try {
    await requireAuth(req, { role: "admin" });
    const { ip } = await req.json();
    if (typeof ip !== "string" || !ip.trim()) {
      return NextResponse.json({ error: "Falta ip" }, { status: 400 });
    }
    if (!isValidIPv4(ip.trim())) {
      return NextResponse.json({ error: "IP inválida" }, { status: 400 });
    }

    return NextResponse.json(
      {
        error: "El control remoto del agente está deshabilitado temporalmente",
        action: params.action,
        ip: ip.trim(),
      },
      { status: 503 }
    );
  } catch (error: any) {
    if (error?.message === "UNAUTHORIZED")
      return NextResponse.json({ error: "No autorizado" }, { status: 401 });
    if (error?.message === "FORBIDDEN")
      return NextResponse.json({ error: "Acceso denegado" }, { status: 403 });
    if (error?.code === "CSRF_INVALID" || error?.code === "CSRF_MISSING") {
      return NextResponse.json({ error: "CSRF inválido" }, { status: 403 });
    }
    return NextResponse.json(
      { error: error.message || "Error" },
      { status: 500 }
    );
  }
}

export const dynamic = "force-dynamic";
