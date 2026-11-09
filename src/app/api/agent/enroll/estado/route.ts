import { NextResponse } from "next/server";

import { ipClienteDe } from "@/lib/auth";
import { db } from "@/lib/db";
import { hashCodigoEnrolamiento } from "@/lib/credenciales";
import { diagnosticarCodigo } from "@/lib/diagnosticoEnrolamiento";
import { resolverEquipoParaAgente } from "@/lib/identidadEquipo";
import { logError } from "@/lib/logger";
import { hit } from "@/lib/rateLimit";
import { normalizeComputerName } from "@/lib/utils";

/**
 * GET /api/agent/enroll/estado?pcName=...&codigo=...
 *
 * Consulta de SOLO LECTURA del estado de un código de
 * enrolamiento: existe, de qué equipo es, si caducó. NO lo
 * gasta ni registra nada — es el paso 3 de la prueba de
 * enrolamiento paso a paso del agente, que necesita poder
 * enseñar «este código vale / no vale por ESTO» ANTES de
 * presentarlo de verdad.
 *
 * La respuesta distingue motivos (vigente, caducado, de otro
 * equipo, no coincide, sin código, sin equipo) con la frase
 * lista para enseñar. El único secreto en juego es el propio
 * código, que quien consulta ya posee; y la ruta va limitada
 * por equipo igual que la de enrolar.
 */
export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const pcName = normalizeComputerName(searchParams.get("pcName") || "");
    const codigo = searchParams.get("codigo") || "";
    if (!pcName || !codigo) {
      return NextResponse.json(
        { ok: false, error: "pcName y codigo requeridos" },
        { status: 400 }
      );
    }

    const clientIp = ipClienteDe(req) || "unknown";
    const rl = await hit(
      "agent-enroll-estado",
      { windowMs: 60_000, max: 10 },
      { identifier: `${clientIp}|${pcName}` }
    );
    if (!rl.allowed) {
      return NextResponse.json(
        { ok: false, error: "Demasiadas consultas: espera un minuto" },
        { status: 429 }
      );
    }

    const hash = hashCodigoEnrolamiento(codigo);
    const resuelto = await resolverEquipoParaAgente({
      nombre: pcName,
      ip: clientIp !== "unknown" ? clientIp : null,
    }).catch(() => null);
    const fila = resuelto
      ? await (db as any).computer.findUnique({
          where: { id: resuelto.id },
          select: {
            name: true,
            codigoEnrolamientoHash: true,
            codigoEnrolamientoExpira: true,
          },
        })
      : null;
    const dueno = await (db as any).computer.findFirst({
      where: { codigoEnrolamientoHash: hash },
      select: { name: true },
    });

    const diagnostico = diagnosticarCodigo({
      fila,
      coincideConLaFila: !!fila && fila.codigoEnrolamientoHash === hash,
      duenoDelCodigo: dueno,
      ahoraMs: Date.now(),
    });

    const res = NextResponse.json({
      ok: true,
      estado: diagnostico.estado,
      detalle: diagnostico.detalle,
      expira: diagnostico.expira,
    });
    res.headers.set("Cache-Control", "no-store");
    return res;
  } catch (error) {
    logError("Error en GET /api/agent/enroll/estado", error);
    return NextResponse.json(
      { ok: false, error: "Error al consultar el código" },
      { status: 500 }
    );
  }
}
