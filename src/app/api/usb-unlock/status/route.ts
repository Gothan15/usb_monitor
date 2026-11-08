import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getCurrentDate } from "@/lib/time";
import { requireAgentAuth } from "@/lib/agentAuth";
import { hit } from "@/lib/rateLimit";
import { registrarContactoAgente } from "@/lib/agentDebug";
import { logError } from "@/lib/logger";
import { broadcastUnlockChange } from "@/lib/socket";

/**
 * GET /api/usb-unlock/status?pcName=XXX&check=true
 * Polling del agente: devuelve los dispositivos de esa PC que ya fueron
 * desbloqueados con contraseña (vía /api/usb-auth) y aún no se aplicaron
 * en la PC. Con check=true los marca como ejecutados (executedAt) para
 * no entregarlos dos veces; el registro NO se borra: queda la auditoría.
 *
 * El antiguo POST de esta ruta (un usuario con sesión marcaba el
 * desbloqueo) desaparece: en el flujo 2FA nadie autoriza a mano; la
 * contraseña se verifica automáticamente en /api/usb-auth.
 */
export async function GET(req: Request) {
  // Se lee antes del try solo para registrar el contacto también
  // cuando la autenticación falla (401).
  const pcNameQuery = new URL(req.url).searchParams.get("pcName");
  try {
    const auth = await requireAgentAuth(req);
    const { searchParams } = new URL(req.url);
    const pcName = searchParams.get("pcName");
    const checkInterval = searchParams.get("check") === "true";

    if (!pcName || !pcName.trim()) {
      return NextResponse.json(
        { ok: false, error: "pcName requerido" },
        { status: 400 }
      );
    }

    const normalizedPcName = pcName.trim();

    const clientIp =
      (req.headers.get("x-forwarded-for") || "").split(",")[0].trim() ||
      "unknown";
    const rl = await hit(
      "usb-unlock-status",
      { windowMs: 2000, max: 15 },
      { serviceId: auth.serviceId, identifier: normalizedPcName, ip: clientIp }
    );
    if (!rl.allowed) {
      return NextResponse.json(
        { ok: false, error: "Rate limit" },
        { status: 429 }
      );
    }

    const candidates = await db.pendingUnlock.findMany({
      where: {
        pcName: normalizedPcName,
        status: "UNLOCKED",
        executedAt: null,
        expiresAt: { gte: getCurrentDate() },
      },
      orderBy: { unlockedAt: "asc" },
      select: {
        id: true,
        driveLetter: true,
        serialNumber: true,
      },
    });

    // Reclamo atómico por fila: cada desbloqueo se entrega UNA sola
    // vez aunque dos sondeos coincidan en el tiempo. El UPDATE lleva
    // la condición executedAt: null, así que de cada fila solo gana
    // un llamante (antes leer y marcar eran dos pasos separados y
    // dos agentes podían recibir —y ejecutar— el mismo desbloqueo).
    let pendings = candidates;
    if (checkInterval && candidates.length > 0) {
      pendings = [];
      for (const candidate of candidates) {
        const claim = await db.pendingUnlock.updateMany({
          where: { id: candidate.id, executedAt: null },
          data: { executedAt: getCurrentDate() },
        });
        if (claim.count === 1) {
          pendings.push(candidate);
        }
      }
    }

    // Solo se avisa cuando una entrega se reclamó de verdad:
    // esta ruta se sondea cada pocos segundos y avisar en cada
    // sondeo recrearía el problema que se está quitando.
    if (pendings.length > 0) broadcastUnlockChange();
    registrarContactoAgente(normalizedPcName, "/api/usb-unlock/status", 200);
    const res = NextResponse.json({
      ok: true,
      unlocked: pendings.length > 0,
      driveLetter: pendings[0]?.driveLetter,
      pendings,
    });
    res.headers.set("Cache-Control", "no-store");
    return res;
  } catch (error: any) {
    if (error?.message === "UNAUTHORIZED") {
      registrarContactoAgente(pcNameQuery, "/api/usb-unlock/status", 401);
      return NextResponse.json(
        { ok: false, error: "No autorizado" },
        { status: 401 }
      );
    }
    logError("Error en usb-unlock status", error);
    return NextResponse.json(
      { ok: false, error: error.message },
      { status: 500 }
    );
  }
}
