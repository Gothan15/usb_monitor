import { NextResponse } from "next/server";

import { ipClienteDe } from "@/lib/auth";
import { db } from "@/lib/db";
import {
  codigoEnrolamientoValido,
  hashCodigoEnrolamiento,
  registrarClavePublica,
} from "@/lib/credenciales";
import { diagnosticarCodigo } from "@/lib/diagnosticoEnrolamiento";
import { resolverEquipoParaAgente } from "@/lib/identidadEquipo";
import { logError, logWarn } from "@/lib/logger";
import { hit } from "@/lib/rateLimit";
import { normalizeComputerName } from "@/lib/utils";

/**
 * POST /api/agent/enroll  { pcName, codigo, clavePublica }
 *
 * Enrolamiento con código de UN SOLO USO (overhaul de
 * credenciales de 2026-11-08, en sustitución de la clave de
 * flota compartida): el administrador genera el código atado a
 * ESTE equipo en Equipos, el agente lo presenta junto con la
 * clave pública que acaba de nacer en su PC, y el servidor la
 * registra como su credencial y le devuelve su id. El código
 * muere en este acto; la clave privada nunca sale de la PC.
 *
 * Si el código no vale, la respuesta es un 401 con MOTIVO
 * distinguible (caducado, de otro equipo, no coincide, sin
 * código, sin equipo) y la frase lista para enseñar en el
 * agente: es la materia prima de la prueba de enrolamiento
 * paso a paso. El motivo también queda en el registro del
 * servidor.
 *
 * Antes de validar se resuelve la identidad del equipo
 * (nombre normalizado o IP de origen, fusionando duplicados):
 * el código pudo generarse sobre la fila «por IP» que creaban
 * el escáner o el refresco de host, mientras el agente se
 * presenta con el nombre real de su PC. Sin esta resolución,
 * ese código válido era rechazado siempre.
 */
export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => null);
    const pcName = normalizeComputerName(
      typeof body?.pcName === "string" ? body.pcName : ""
    );
    const codigo = typeof body?.codigo === "string" ? body.codigo : "";
    const clavePublica =
      typeof body?.clavePublica === "string" ? body.clavePublica : "";
    if (!pcName || !codigo || !clavePublica) {
      return NextResponse.json(
        { ok: false, error: "pcName, codigo y clavePublica requeridos" },
        { status: 400 }
      );
    }

    // El límite es POR EQUIPO (IP de origen + nombre), no una
    // bolsa común: antes todas las peticiones sin cabecera de
    // proxy caían en el mismo cubo «unknown» y diez intentos
    // entre TODAS las PCs cerraban el enrolamiento de cualquiera.
    const clientIp = ipClienteDe(req) || "unknown";
    const rl = await hit(
      "agent-enroll",
      { windowMs: 60_000, max: 10 },
      { identifier: `${clientIp}|${pcName}` }
    );
    if (!rl.allowed) {
      return NextResponse.json(
        { ok: false, error: "Demasiados intentos: espera un minuto" },
        { status: 429 }
      );
    }

    const resuelto = await resolverEquipoParaAgente({
      nombre: pcName,
      ip: clientIp !== "unknown" ? clientIp : null,
    }).catch(() => null);
    const computer = resuelto
      ? await (db as any).computer.findUnique({
          where: { id: resuelto.id },
          select: {
            id: true,
            name: true,
            codigoEnrolamientoHash: true,
            codigoEnrolamientoExpira: true,
          },
        })
      : null;

    if (!computer || !codigoEnrolamientoValido(computer, codigo)) {
      // El rechazo lleva MOTIVO distinguible (caducado, de otro
      // equipo, no coincide, sin código, sin equipo) y la frase
      // lista para enseñar: es lo que la prueba paso a paso del
      // agente muestra tal cual, y lo que queda en el registro.
      // Antes era un 401 genérico que no decía nada en ningún
      // sitio y el fallo real solo se podía adivinar. El código
      // sigue siendo de un solo uso y su hash, lo único guardado.
      const hash = hashCodigoEnrolamiento(codigo);
      const dueno = await (db as any).computer
        .findFirst({
          where: { codigoEnrolamientoHash: hash },
          select: { name: true },
        })
        .catch(() => null);
      const diagnostico = diagnosticarCodigo({
        fila: computer,
        coincideConLaFila:
          !!computer && computer.codigoEnrolamientoHash === hash,
        duenoDelCodigo: dueno,
        ahoraMs: Date.now(),
      });
      logWarn("Enrolamiento rechazado", {
        pcName,
        ip: clientIp,
        motivo: diagnostico.estado,
      });
      return NextResponse.json(
        {
          ok: false,
          motivo: diagnostico.estado,
          error: diagnostico.detalle,
        },
        { status: 401 }
      );
    }

    let huella: string;
    try {
      huella = await registrarClavePublica(computer.id, clavePublica);
    } catch {
      return NextResponse.json(
        { ok: false, error: "La clave pública no es válida" },
        { status: 400 }
      );
    }

    return NextResponse.json({ ok: true, equipoId: computer.id, huella });
  } catch (error) {
    logError("Error en POST /api/agent/enroll", error);
    return NextResponse.json(
      { ok: false, error: "Error al enrolar el equipo" },
      { status: 500 }
    );
  }
}
