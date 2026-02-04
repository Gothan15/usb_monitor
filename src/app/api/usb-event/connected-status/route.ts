import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireServiceAuth } from "@/lib/auth";
import { getCurrentDate } from "@/lib/time";
import { hit } from "@/lib/rateLimit";
import { logError } from "@/lib/logger";
import { normalizeComputerName } from "@/lib/utils";

/**
 * POST /api/usb-event/connected-status
 * Recibe el estado actual de las unidades USB conectadas desde el servicio
 */
export async function POST(req: NextRequest) {
  try {
    const serviceAuth = await requireServiceAuth(req);

    const body = (await req.json().catch(() => null)) as any;

    if (!body || typeof body !== "object") {
      return NextResponse.json(
        { ok: false, error: "Cuerpo JSON inválido o ausente" },
        { status: 400 }
      );
    }

    const { pcName, connectedDrives } = body;

    if (
      typeof pcName !== "string" ||
      !pcName.trim() ||
      !Array.isArray(connectedDrives)
    ) {
      return NextResponse.json(
        { ok: false, error: "pcName y connectedDrives son requeridos" },
        { status: 400 }
      );
    }

    const normalizedPcName = normalizeComputerName(pcName);
    const clientIp =
      (req.headers.get("x-forwarded-for") || "").split(",")[0].trim() ||
      "unknown";
    const rl = await hit(
      "usb-connected-status",
      { windowMs: 5_000, max: 10 },
      {
        serviceId: serviceAuth.serviceId,
        ip: clientIp,
        identifier: normalizedPcName,
      }
    );
    if (!rl.allowed) {
      return NextResponse.json(
        { ok: false, error: "Rate limit" },
        { status: 429 }
      );
    }

    const now = getCurrentDate();

    const sanitizedDrives = Array.isArray(connectedDrives)
      ? connectedDrives
          .map((drive: any) => {
            const rawLetter =
              typeof drive?.driveLetter === "string"
                ? drive.driveLetter.trim()
                : "";
            const normalizedLetter = rawLetter || "SIN-LETRA";
            const rawSerial =
              typeof drive?.serialNumber === "string"
                ? drive.serialNumber.trim()
                : "";
            const fallbackSerial = `AUTO-${normalizedLetter}`;
            return {
              driveLetter: rawLetter || null,
              volumeName:
                typeof drive?.volumeName === "string" ? drive.volumeName : null,
              serialNumber: rawSerial || fallbackSerial,
              model: typeof drive?.model === "string" ? drive.model : null,
              size: Number.isFinite(drive?.size) ? Number(drive.size) : 0,
            };
          })
          .filter((drive) => drive.driveLetter)
      : [];

    const driveLetters = sanitizedDrives
      .map((drive) => drive.driveLetter)
      .filter((letter): letter is string => Boolean(letter));

    if (driveLetters.length) {
      // Batch mark stale connections as disconnected instead of looping updates per row.
      await (db as any).uSBConnection.updateMany({
        where: {
          pcName: normalizedPcName,
          isConnected: true,
          driveLetter: { notIn: driveLetters },
        },
        data: {
          isConnected: false,
          disconnectedAt: now,
        },
      });
    } else {
      await (db as any).uSBConnection.updateMany({
        where: {
          pcName: normalizedPcName,
          isConnected: true,
        },
        data: {
          isConnected: false,
          disconnectedAt: now,
        },
      });
    }

    const serials = sanitizedDrives
      .map((drive) => drive.serialNumber)
      .filter((serial): serial is string => Boolean(serial));

    // Fetch active rows for incoming serials once to avoid per-drive round trips.
    const existingConnections = serials.length
      ? await (db as any).uSBConnection.findMany({
          where: {
            pcName: normalizedPcName,
            isConnected: true,
            serialNumber: { in: serials },
          },
        })
      : [];

    const existingBySerial = new Map<string, any>();
    for (const connection of existingConnections) {
      if (connection.serialNumber) {
        existingBySerial.set(connection.serialNumber, connection);
      }
    }

    const operations = sanitizedDrives.map((drive) => {
      const existing = drive.serialNumber
        ? existingBySerial.get(drive.serialNumber)
        : undefined;
      if (existing) {
        return (db as any).uSBConnection.update({
          where: { id: existing.id },
          data: {
            lastSeen: now,
            driveLetter: drive.driveLetter,
            volumeName: drive.volumeName || existing.volumeName,
            size: BigInt(drive.size || Number(existing.size) || 0),
          },
        });
      }
      return (db as any).uSBConnection.create({
        data: {
          pcName: normalizedPcName,
          driveLetter: drive.driveLetter,
          volumeName: drive.volumeName || "Sin nombre",
          serialNumber: drive.serialNumber,
          model: drive.model || "Unknown",
          size: BigInt(drive.size || 0),
          connectedAt: now,
          lastSeen: now,
          isConnected: true,
        },
      });
    });

    if (operations.length) {
      await (db as any).$transaction(operations);
    }

    const res = NextResponse.json({
      ok: true,
      message: "Estado actualizado",
      connectedCount: connectedDrives.length,
    });
    res.headers.set("Cache-Control", "no-store");
    return res;
  } catch (error: any) {
    if (error?.message === "UNAUTHORIZED") {
      return NextResponse.json(
        { ok: false, error: "No autorizado" },
        { status: 401 }
      );
    }
    logError("Error en connected-status", error);
    return NextResponse.json(
      { ok: false, error: error.message },
      { status: 500 }
    );
  }
}

export const dynamic = "force-dynamic";
