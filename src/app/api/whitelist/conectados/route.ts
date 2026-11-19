import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireAuth } from "@/lib/auth";
import { readAppSettings } from "@/lib/appSettings";
import { getCurrentDate } from "@/lib/time";
import { logError } from "@/lib/logger";
import { dispositivosLocales } from "@/lib/usbLocal";

/**
 * GET /api/whitelist/conectados
 * Los dispositivos USB conectados AHORA MISMO en cualquier
 * equipo, para que el alta de la lista blanca ofrezca sus
 * seriales en un desplegable en vez de obligar a teclearlos
 * (como hacía la antigua herramienta del toolbox).
 *
 * «Conectado» con la misma regla de frescura que la ficha de
 * un equipo: la fila sigue marcada conectada y el agente la
 * ha reportado dentro del umbral de silencio (reporta cada
 * 30 s). Sin esa frescura, una fila que nunca se marcó
 * desconectada (agente caído, extracción sin reporte) se
 * ofrecería para siempre.
 *
 * Y además, los pinchados en la PROPIA PC del panel, leídos
 * en el momento por WMI (lib/usbLocal): la PC del servidor no
 * necesita agente para enseñar sus memorias, como ya hacía
 * la herramienta de seriales del toolbox cuando era un
 * programa aparte.
 *
 * Un asiento por serial: si el mismo serial constara en dos
 * equipos a la vez, manda el reporte más reciente; el leído
 * en casa solo entra si ningún agente lo reporta ya.
 */
export async function GET(req: NextRequest) {
  try {
    await requireAuth(req, { role: "admin" });

    const settings = await readAppSettings();
    const umbralMs =
      Math.max(2, settings.silenceThresholdMinutes || 5) * 60_000;
    const senalReciente = new Date(getCurrentDate().getTime() - umbralMs);

    const rows = await db.uSBConnection.findMany({
      where: { isConnected: true, lastSeen: { gte: senalReciente } },
      orderBy: { lastSeen: "desc" },
      take: 200,
    });

    const vistos = new Set<string>();
    const items: {
      serialNumber: string;
      pcName: string;
      driveLetter: string | null;
      volumeName: string;
      model: string;
    }[] = [];
    for (const r of rows) {
      const serial = (r.serialNumber || "").trim();
      if (!serial || vistos.has(serial)) continue;
      vistos.add(serial);
      items.push({
        serialNumber: serial,
        pcName: r.pcName,
        driveLetter: r.driveLetter,
        volumeName: r.volumeName,
        model: r.model,
      });
    }

    // Los de la propia PC del panel, leídos en casa por WMI.
    for (const local of await dispositivosLocales()) {
      if (vistos.has(local.serialNumber)) continue;
      vistos.add(local.serialNumber);
      items.push(local);
    }

    return NextResponse.json({ ok: true, items });
  } catch (error: any) {
    if (error?.message === "UNAUTHORIZED" || error?.message === "FORBIDDEN") {
      return NextResponse.json({ error: "No autorizado" }, { status: 401 });
    }
    logError("Error en GET /api/whitelist/conectados", error);
    return NextResponse.json(
      { error: "No se pudieron leer los dispositivos conectados" },
      { status: 500 },
    );
  }
}
