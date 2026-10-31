import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireServiceAuth } from "@/lib/auth";
import { logError } from "@/lib/logger";

/**
 * POST /api/agent/offline-attempts
 * Fase 4: al recuperar la red, el agente sube los intentos de
 * desbloqueo hechos sin conexión contra el hash local (emergencia).
 * Se guardan como auditoría con origin OFFLINE_LOCAL; un OFFLINE_OK
 * marca su bloqueo como desbloqueado y ejecutado (ya se aplicó en la
 * PC en su momento), para que la historia quede completa.
 */
export async function POST(req: Request) {
  try {
    await requireServiceAuth(req);

    const body = await req.json();
    const pcName = typeof body?.pcName === "string" ? body.pcName.trim() : "";
    const attempts = Array.isArray(body?.attempts) ? body.attempts : [];
    if (!pcName || attempts.length === 0) {
      return NextResponse.json(
        { ok: false, error: "pcName y attempts requeridos" },
        { status: 400 }
      );
    }

    let recorded = 0;
    for (const raw of attempts.slice(0, 100)) {
      const usernameTried =
        typeof raw?.usernameTried === "string" ? raw.usernameTried.trim() : "";
      const result = raw?.result === "OFFLINE_OK" ? "OFFLINE_OK" : "OFFLINE_FAIL";
      const driveLetter =
        typeof raw?.driveLetter === "string" ? raw.driveLetter.trim() : null;
      const serialNumber =
        typeof raw?.serialNumber === "string" ? raw.serialNumber.trim() : null;
      const when =
        typeof raw?.createdAt === "string" && !Number.isNaN(Date.parse(raw.createdAt))
          ? new Date(raw.createdAt)
          : new Date();
      if (!usernameTried) continue;

      const user = await db.user.findUnique({
        where: { username: usernameTried },
        select: { id: true },
      });

      const pending = await db.pendingUnlock.findFirst({
        where: {
          pcName,
          ...(driveLetter ? { driveLetter } : {}),
          status: { in: ["BLOCKED", "UNLOCKED", "CLOSED"] },
        },
        orderBy: { createdAt: "desc" },
        select: { id: true, status: true },
      });

      await db.unlockAttempt.create({
        data: {
          pendingId: pending?.id ?? null,
          pcName,
          usernameTried,
          userId: user?.id ?? null,
          serialNumber,
          result,
          origin: "OFFLINE_LOCAL",
          createdAt: when,
        },
      });
      recorded++;

      if (result === "OFFLINE_OK" && pending?.status === "BLOCKED") {
        await db.pendingUnlock.update({
          where: { id: pending.id },
          data: {
            status: "UNLOCKED",
            unlockedById: user?.id ?? null,
            unlockedAt: when,
            executedAt: when,
          },
        });
      }
    }

    const res = NextResponse.json({ ok: true, recorded });
    res.headers.set("Cache-Control", "no-store");
    return res;
  } catch (error: any) {
    if (error?.message === "UNAUTHORIZED") {
      return NextResponse.json(
        { ok: false, error: "No autorizado" },
        { status: 401 }
      );
    }
    logError("Error registrando intentos offline", error);
    return NextResponse.json(
      { ok: false, error: error.message },
      { status: 500 }
    );
  }
}
