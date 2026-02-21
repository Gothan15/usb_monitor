import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
import {
  remoteStatus,
  remoteStart,
  remoteStop,
  remoteInstall,
  remoteUninstall,
  summarize,
} from "@/lib/winrmService";

type ServiceAction = "install" | "uninstall" | "start" | "stop" | "status";

const actionMap: Record<
  ServiceAction,
  (ip: string) => ReturnType<typeof remoteStatus>
> = {
  status: remoteStatus,
  start: remoteStart,
  stop: remoteStop,
  install: remoteInstall,
  uninstall: remoteUninstall,
};

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ action: ServiceAction }> }
) {
  try {
    await requireAuth(req, { role: "admin" });
    const { ip } = await req.json();
    if (typeof ip !== "string" || !ip.trim()) {
      return NextResponse.json({ error: "Falta ip" }, { status: 400 });
    }
    const { action } = await params;
    const fn = actionMap[action];
    if (!fn) {
      return NextResponse.json({ error: "Acción inválida" }, { status: 400 });
    }
    const result = await fn(ip.trim());
    const summary = summarize(result, action);
    return NextResponse.json(summary, { status: summary.success ? 200 : 502 });
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
