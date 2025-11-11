import { NextRequest, NextResponse } from "next/server";
import { scanNetwork, startScanJob, getScanJob } from "@/lib/networkScanner";
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
    const asyncMode = !!body.async;
    if (asyncMode) {
      const job = startScanJob(cidr);
      return NextResponse.json({
        jobId: job.id,
        cidr: job.cidr,
        status: job.status,
        progress: job.progress,
      });
    }
    const results = await scanNetwork(cidr, { force });
    const res = NextResponse.json({
      cidr: cidr || "auto",
      cached: !force,
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

export async function GET(req: NextRequest) {
  try {
    const auth = await requireAuth(req, { role: "admin", enforceCsrf: false });
  } catch (e: any) {
    if (e.message === "UNAUTHORIZED")
      return NextResponse.json({ error: "No autorizado" }, { status: 401 });
    if (e.message === "FORBIDDEN")
      return NextResponse.json({ error: "Acceso denegado" }, { status: 403 });
  }
  const { searchParams } = new URL(req.url);
  const jobId = searchParams.get("jobId");
  if (!jobId)
    return NextResponse.json({ error: "jobId requerido" }, { status: 400 });
  const job = getScanJob(jobId);
  if (!job)
    return NextResponse.json({ error: "job no encontrado" }, { status: 404 });
  const res = NextResponse.json({
    id: job.id,
    status: job.status,
    progress: job.progress,
    results: job.results,
    cidr: job.cidr,
  });
  res.headers.set("Cache-Control", "no-store");
  return res;
}

export const dynamic = "force-dynamic";
