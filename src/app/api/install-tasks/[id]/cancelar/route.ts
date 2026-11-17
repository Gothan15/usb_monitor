import { NextResponse } from "next/server";

import { requireAdminUser } from "@/lib/admin";
import { db } from "@/lib/db";
import { logError } from "@/lib/logger";
import { getCurrentDate } from "@/lib/time";
import { broadcastInstallChange } from "@/lib/socket";
import { descartarClavesTarea } from "@/lib/installExecutor";
import { anularCodigoEnrolamiento } from "@/lib/credenciales";
import {
  ESTADO_DESTINO,
  ESTADO_TAREA,
  ESTADOS_DESTINO_FINALES,
  METODO,
} from "@/lib/installTasks";

/**
 * POST (admin): cancela una tarea de instalación remota EN
 * CURSO. Hasta ahora una tarea lanzada no se podía parar:
 * si el admin veía que iba a fallar, le tocaba esperar a que
 * terminara sola.
 *
 * La cancelación es cooperativa y se escribe aquí, en la
 * base de datos: la tarea queda CANCELADA y cada destino no
 * final queda CANCELADO, con su mensaje y su finishedAt. El
 * ejecutor se entera en sus puntos de control (antes de cada
 * destino, tras el empuje y en los sondeos de las esperas de
 * señal/versión) y sale sin pisar esos estados. Si el
 * empujador está a mitad de copia SMB, la copia no se parte:
 * la cancelación surte efecto en el siguiente punto de
 * control, al terminar el empuje.
 *
 * Caso especial: un destino en ESPERANDO_SENAL por empuje ya
 * tiene el agente instalado en su PC, esperando enrolarse
 * con el código de este intento. Cancelarlo sin más dejaría
 * que se enrolara solo minutos después, contra lo que el
 * admin acaba de decidir: por eso se ANULA el código vigente
 * de su equipo (hash y caducidad fuera) y el mensaje del
 * destino lo dice. Para enrolarlo luego, código nuevo en
 * Equipos → «Credencial del equipo».
 */
export async function POST(
  req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const admin = await requireAdminUser(req);
  if (!admin) {
    return NextResponse.json(
      { ok: false, error: "No autorizado" },
      { status: 401 },
    );
  }
  const { id } = await ctx.params;
  try {
    const tarea = await db.installTask.findUnique({
      where: { id },
      select: {
        id: true,
        status: true,
        targets: {
          select: {
            id: true,
            status: true,
            method: true,
            computerId: true,
          },
        },
      },
    });
    if (!tarea) {
      return NextResponse.json(
        { ok: false, error: "Tarea no encontrada" },
        { status: 404 },
      );
    }
    if (tarea.status !== ESTADO_TAREA.EN_CURSO) {
      return NextResponse.json(
        {
          ok: false,
          error: "Esta tarea ya terminó: solo se puede cancelar una en curso.",
        },
        { status: 409 },
      );
    }

    const ahora = getCurrentDate();
    // Cada destino no final pasa a CANCELADO con el mensaje
    // que le corresponde según dónde estaba parado.
    for (const destino of tarea.targets) {
      if (
        (ESTADOS_DESTINO_FINALES as string[]).includes(destino.status)
      ) {
        continue;
      }
      let mensaje: string;
      if (
        destino.status === ESTADO_DESTINO.ESPERANDO_SENAL &&
        destino.method === METODO.EMPUJE
      ) {
        // El agente ya está instalado en esa PC: se anula el
        // código de enrolamiento de su equipo para que no se
        // enrole solo después de cancelada la tarea.
        if (destino.computerId) {
          await anularCodigoEnrolamiento(String(destino.computerId));
        }
        mensaje =
          "Cancelado desde el panel. El agente quedó instalado en esta PC, pero su código de enrolamiento fue anulado: no se enrolará solo. Para enrolarlo luego, genera un código en Equipos → «Credencial del equipo» y escríbelo en el asistente de esa PC.";
      } else if (destino.status === ESTADO_DESTINO.ESPERANDO_SENAL) {
        mensaje =
          "Cancelado desde el panel mientras se esperaba la confirmación del agente.";
      } else if (destino.status === ESTADO_DESTINO.EN_COLA) {
        mensaje =
          "Cancelado desde el panel: este destino no llegó a instalarse.";
      } else {
        mensaje =
          "Cancelado desde el panel a mitad de la instalación: el ejecutor se detiene en su siguiente punto de control.";
      }
      await db.installTaskTarget.update({
        where: { id: destino.id },
        data: {
          status: ESTADO_DESTINO.CANCELADO,
          message: mensaje,
          finishedAt: ahora,
        },
      });
    }

    await db.installTask.update({
      where: { id },
      data: { status: ESTADO_TAREA.CANCELADA, finishedAt: ahora },
    });
    // Las claves en memoria de una tarea cancelada sobran.
    descartarClavesTarea(id);
    broadcastInstallChange();
    const res = NextResponse.json({ ok: true });
    res.headers.set("Cache-Control", "no-store");
    return res;
  } catch (error: any) {
    logError("Error cancelando tarea de instalación", error);
    return NextResponse.json(
      { ok: false, error: error.message },
      { status: 500 },
    );
  }
}
