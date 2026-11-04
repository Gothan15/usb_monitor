import { NextResponse } from "next/server";

import { requireAdminUser } from "@/lib/admin";
import { db } from "@/lib/db";
import { logError } from "@/lib/logger";
import { normalizeComputerName } from "@/lib/utils";
import { lanzarTarea } from "@/lib/installExecutor";

/**
 * Tareas de instalación (fase D, capa de Kaspersky).
 *
 * POST (admin): crea la tarea con sus destinos y la pone en
 *   marcha en segundo plano. La contraseña llega aquí una vez y
 *   vive solo en la memoria del ejecutor: ni se guarda en la
 *   base de datos ni vuelve en ninguna respuesta.
 *   { destinos: [{pcName, ip}], usuario, clave,
 *     omitirSiInstalado?, intentosMaximos? }
 * GET (admin): las tareas recientes con sus destinos.
 */

interface DestinoEntrada {
  pcName: string;
  ipAddress: string;
}

function leerDestinos(body: any): DestinoEntrada[] | null {
  if (!Array.isArray(body?.destinos) || body.destinos.length === 0) {
    return null;
  }
  const vistos = new Set<string>();
  const destinos: DestinoEntrada[] = [];
  for (const entrada of body.destinos) {
    const pcName = normalizeComputerName(
      typeof entrada?.pcName === "string" ? entrada.pcName : "",
    );
    const ipAddress =
      typeof entrada?.ip === "string"
        ? entrada.ip.trim()
        : typeof entrada?.ipAddress === "string"
          ? entrada.ipAddress.trim()
          : "";
    if (!pcName || !ipAddress) return null;
    const claveVista = `${pcName}|${ipAddress}`;
    if (vistos.has(claveVista)) continue;
    vistos.add(claveVista);
    destinos.push({ pcName, ipAddress });
    if (destinos.length > 50) return null;
  }
  return destinos.length > 0 ? destinos : null;
}

export async function POST(req: Request) {
  const admin = await requireAdminUser(req);
  if (!admin) {
    return NextResponse.json(
      { ok: false, error: "No autorizado" },
      { status: 401 },
    );
  }
  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(
      { ok: false, error: "Cuerpo inválido" },
      { status: 400 },
    );
  }
  const destinos = leerDestinos(body);
  if (!destinos) {
    return NextResponse.json(
      {
        ok: false,
        error: "Destinos requeridos: una lista de {pcName, ip} (máx. 50).",
      },
      { status: 400 },
    );
  }
  const usuario =
    typeof body?.usuario === "string" ? body.usuario.trim() : "";
  const clave = typeof body?.clave === "string" ? body.clave : "";
  if (!usuario || !clave) {
    return NextResponse.json(
      {
        ok: false,
        error:
          "La cuenta administradora de los destinos y su clave son requeridas (la clave no se guarda: vive solo en memoria mientras la tarea corre).",
      },
      { status: 400 },
    );
  }
  const omitIfInstalled = body?.omitirSiInstalado !== false;
  const maxAttempts = Math.min(
    5,
    Math.max(1, Number(body?.intentosMaximos) || 2),
  );

  try {
    // Enlaza cada destino con su equipo si el panel ya lo conoce.
    const enlazados = await Promise.all(
      destinos.map(async (destino) => {
        const computer = await db.computer.findUnique({
          where: { name: destino.pcName },
          select: { id: true },
        });
        return { ...destino, computerId: computer?.id ?? null };
      }),
    );
    const tarea = await db.installTask.create({
      data: {
        username: usuario,
        omitIfInstalled,
        maxAttempts,
        createdBy: admin.username,
        targets: {
          create: enlazados.map((destino) => ({
            pcName: destino.pcName,
            ipAddress: destino.ipAddress,
            computerId: destino.computerId,
          })),
        },
      },
      include: { targets: true },
    });
    lanzarTarea(tarea.id, clave);
    const res = NextResponse.json({ ok: true, tarea });
    res.headers.set("Cache-Control", "no-store");
    return res;
  } catch (error: any) {
    logError("Error creando tarea de instalación", error);
    return NextResponse.json(
      { ok: false, error: error.message },
      { status: 500 },
    );
  }
}

export async function GET(req: Request) {
  const admin = await requireAdminUser(req);
  if (!admin) {
    return NextResponse.json(
      { ok: false, error: "No autorizado" },
      { status: 401 },
    );
  }
  try {
    const tareas = await db.installTask.findMany({
      orderBy: { createdAt: "desc" },
      take: 20,
      include: { targets: { orderBy: { createdAt: "asc" } } },
    });
    const res = NextResponse.json({ ok: true, tareas });
    res.headers.set("Cache-Control", "no-store");
    return res;
  } catch (error: any) {
    logError("Error listando tareas de instalación", error);
    return NextResponse.json(
      { ok: false, error: error.message },
      { status: 500 },
    );
  }
}
