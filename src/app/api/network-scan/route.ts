import { NextRequest, NextResponse } from "next/server";
import { scanNetwork, startScanJob, getScanJob } from "@/lib/networkScanner";
import { hit } from "@/lib/rateLimit";
import { requireAuth } from "@/lib/auth";

export async function POST(req: NextRequest) {
  try {
    await requireAuth(req);
    const ip =
      (req.headers.get("x-forwarded-for") || "").split(",")[0].trim() ||
      "unknown";
    const rl = hit(`net-scan:${ip}`, { windowMs: 60_000, max: 5 });
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
    return NextResponse.json({
      cidr: cidr || "auto",
      cached: !force,
      count: results.length,
      results,
    });
  } catch (error: any) {
    console.error("Error en escaneo de red:", error);
    return NextResponse.json(
      { error: error.message || "Error al escanear red" },
      { status: 500 }
    );
  }
}

export async function GET(req: NextRequest) {
  try {
    await requireAuth(req); // JWT en Authorization: Bearer <token>
  } catch (e: any) {
    if (e.message === "UNAUTHORIZED")
      return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  }
  const { searchParams } = new URL(req.url);
  const jobId = searchParams.get("jobId");
  if (!jobId)
    return NextResponse.json({ error: "jobId requerido" }, { status: 400 });
  const job = getScanJob(jobId);
  if (!job)
    return NextResponse.json({ error: "job no encontrado" }, { status: 404 });
  return NextResponse.json({
    id: job.id,
    status: job.status,
    progress: job.progress,
    results: job.results,
    cidr: job.cidr,
  });
}

export const dynamic = "force-dynamic";
