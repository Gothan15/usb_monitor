import { NextResponse } from "next/server";

import { requireAdminUser } from "@/lib/admin";
import { db } from "@/lib/db";
import { logError } from "@/lib/logger";
import { normalizeComputerName } from "@/lib/utils";
import { lanzarTarea, tareaEnEjecucion } from "@/lib/installExecutor";
import { ESTADO_TAREA, tareaPuedeBorrarse } from "@/lib/installTasks";

/**
 * Tareas de instalación (fase D, capa de Kaspersky).
 *
 * POST (admin): crea la tarea con sus destinos y la pone en
 *   marcha en segundo plano. La contraseña llega aquí una vez y
 *   vive solo en la memoria del ejecutor: ni se guarda en la
 *   base de datos ni vuelve en ninguna respuesta.
 *   { destinos: [{pcName, ip}], usuario, clave,
 *     omitirSiInstalado?, intentosMaximos?,
 *     credenciales?: [{pcName, ip, usuario?, clave}] }
 *   `credenciales` trae la credencial PROPIA de los destinos
 *   que no usan la general (equipos con otra contraseña de
 *   administrador); manda sobre la general solo en su equipo.
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

interface CredencialEntrada {
  destinoKey: string;
  usuario?: string;
  clave: string;
}

/**
 * Las credenciales propias de destinos concretos, si vienen:
 * cada entrada debe corresponder a un destino de la tarea y
 * traer su clave (el usuario es opcional: si falta, se usa el
 * general). Devuelve undefined si no vienen, null si vienen
 * mal, y la lista si vienen bien.
 */
function leerCredenciales(
  body: any,
  destinos: DestinoEntrada[],
): CredencialEntrada[] | null | undefined {
  if (body?.credenciales === undefined) return undefined;
  if (!Array.isArray(body.credenciales)) return null;
  const validos = new Set(
    destinos.map((d) => `${d.pcName}|${d.ipAddress}`),
  );
  const entradas: CredencialEntrada[] = [];
  for (const entrada of body.credenciales) {
    const pcName = normalizeComputerName(
      typeof entrada?.pcName === "string" ? entrada.pcName : "",
    );
    const ip =
      typeof entrada?.ip === "string"
        ? entrada.ip.trim()
        : typeof entrada?.ipAddress === "string"
          ? entrada.ipAddress.trim()
          : "";
    const clave = typeof entrada?.clave === "string" ? entrada.clave : "";
    const usuario =
      typeof entrada?.usuario === "string" ? entrada.usuario.trim() : "";
    const destinoKey = `${pcName}|${ip}`;
    if (!pcName || !ip || !clave || !validos.has(destinoKey)) return null;
    entradas.push({
      destinoKey,
      usuario: usuario || undefined,
      clave,
    });
  }
  return entradas;
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
  const credenciales = leerCredenciales(body, destinos);
  if (credenciales === null) {
    return NextResponse.json(
      {
        ok: false,
        error:
          "Credenciales por destino inválidas: cada entrada debe ser de un destino de la tarea y traer su clave.",
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
    // Los ajustes por destino se enlazan con la fila creada:
    // el ejecutor los busca por el id del destino.
    const porDestino = new Map<
      string,
      { usuario?: string; clave: string }
    >();
    for (const entrada of credenciales ?? []) {
      const destino = tarea.targets.find(
        (t) => `${t.pcName}|${t.ipAddress}` === entrada.destinoKey,
      );
      if (destino) {
        porDestino.set(destino.id, {
          ...(entrada.usuario ? { usuario: entrada.usuario } : {}),
          clave: entrada.clave,
        });
      }
    }
    lanzarTarea(tarea.id, { general: clave, porDestino });
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

/**
 * DELETE (admin): «limpiar terminadas» — borra de una vez
 * todas las tareas que ya acabaron (COMPLETADA o CON_ERRORES)
 * y cumplen la misma regla del borrado individual. Las que
 * sigan en curso se quedan. Devuelve cuántas se borraron.
 */
export async function DELETE(req: Request) {
  const admin = await requireAdminUser(req);
  if (!admin) {
    return NextResponse.json(
      { ok: false, error: "No autorizado" },
      { status: 401 },
    );
  }
  try {
    const candidatas = await db.installTask.findMany({
      where: { status: { not: ESTADO_TAREA.EN_CURSO } },
      select: {
        id: true,
        status: true,
        targets: { select: { status: true } },
      },
    });
    const borrables = candidatas.filter((tarea) =>
      tareaPuedeBorrarse({
        status: tarea.status,
        estadosDestinos: tarea.targets.map((t) => t.status),
        enEjecucion: tareaEnEjecucion(tarea.id),
      }),
    );
    if (borrables.length > 0) {
      await db.installTask.deleteMany({
        where: { id: { in: borrables.map((t) => t.id) } },
      });
    }
    const res = NextResponse.json({ ok: true, eliminadas: borrables.length });
    res.headers.set("Cache-Control", "no-store");
    return res;
  } catch (error: any) {
    logError("Error limpiando tareas de instalación", error);
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
