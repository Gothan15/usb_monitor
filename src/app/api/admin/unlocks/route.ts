import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireAuth } from "@/lib/auth";
import { readAppSettings } from "@/lib/appSettings";
import { logError } from "@/lib/logger";

/**
 * GET /api/admin/unlocks?result=SUCCESS&pcName=PC-...
 * Fase 5: datos de la vista «Desbloqueos» — bloqueos en curso,
 * historial de intentos (auditoría del flujo 2FA y de la emergencia
 * sin red) y estado de silencio de los equipos (método 3). Solo
 * lectura: el admin mira; el flujo no se interviene desde aquí.
 */
export async function GET(req: NextRequest) {
  try {
    await requireAuth(req, { role: "admin" });

    const { searchParams } = new URL(req.url);
    const resultFilter = searchParams.get("result")?.trim() || null;
    const pcFilter = searchParams.get("pcName")?.trim() || null;

    const [blockedNow, activeUnlocked, attempts, computers, settings] =
      await Promise.all([
        db.pendingUnlock.findMany({
          where: { status: "BLOCKED" },
          orderBy: { createdAt: "desc" },
          take: 100,
          include: { unlockedBy: { select: { username: true, role: true } } },
        }),
        db.pendingUnlock.findMany({
          where: { status: "UNLOCKED" },
          orderBy: { unlockedAt: "desc" },
          take: 50,
          include: { unlockedBy: { select: { username: true, role: true } } },
        }),
        db.unlockAttempt.findMany({
          where: {
            ...(resultFilter ? { result: resultFilter } : {}),
            ...(pcFilter ? { pcName: { contains: pcFilter } } : {}),
          },
          orderBy: { createdAt: "desc" },
          take: 150,
          include: { user: { select: { username: true, role: true } } },
        }),
        db.computer.findMany({
          select: { id: true, name: true, ipAddress: true, lastSeen: true, isActive: true },
          orderBy: { name: "asc" },
        }),
        readAppSettings(),
      ]);

    // Método 3: silencio = sin señales desde hace más del umbral.
    // Si TODOS los equipos están en silencio, lo probable es que el
    // servidor estuviera caído, no que todos los agentes cayeran a la
    // vez: se marca como tal y no se acusa a ningún equipo.
    const thresholdMs = settings.silenceThresholdMinutes * 60 * 1000;
    const now = Date.now();
    const silenceComputers = computers.map((c) => {
      const lastSeenMs = c.lastSeen ? new Date(c.lastSeen).getTime() : null;
      const silent = lastSeenMs === null || now - lastSeenMs > thresholdMs;
      return {
        id: c.id,
        name: c.name,
        ipAddress: c.ipAddress,
        lastSeen: c.lastSeen,
        silent,
        silentSince: silent ? c.lastSeen : null,
      };
    });
    const freshest = silenceComputers.reduce<number | null>((acc, c) => {
      const t = c.lastSeen ? new Date(c.lastSeen).getTime() : null;
      return t !== null && (acc === null || t > acc) ? t : acc;
    }, null);
    const serverLikelyDown =
      silenceComputers.length > 0 &&
      silenceComputers.every((c) => c.silent) &&
      (freshest === null || now - freshest > thresholdMs);

    return NextResponse.json({
      ok: true,
      blockedNow,
      activeUnlocked,
      attempts: attempts.map((a) => ({
        ...a,
        // Destacar en la vista los desbloqueos hechos con cuenta admin.
        adminUnlock:
          (a.result === "SUCCESS" || a.result === "OFFLINE_OK") &&
          a.user?.role?.toLowerCase() === "admin",
      })),
      silence: {
        thresholdMinutes: settings.silenceThresholdMinutes,
        serverLikelyDown,
        computers: silenceComputers,
      },
    });
  } catch (error: any) {
    if (error?.message === "UNAUTHORIZED" || error?.message === "FORBIDDEN") {
      return NextResponse.json({ error: "No autorizado" }, { status: 401 });
    }
    logError("Error en /api/admin/unlocks", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
