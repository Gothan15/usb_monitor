import { db } from "@/lib/db";
import { logInfo, logWarn } from "@/lib/logger";
import { normalizeComputerName } from "@/lib/utils";

/**
 * Identidad única de un equipo (arreglo de los duplicados,
 * 2026-11-08).
 *
 * El síntoma: la misma PC aparecía DOS veces en Equipos, una
 * fila por su nombre y otra «por su IP». La causa no era una
 * sola: convivían varias vías de alta que no compartían clave
 * de identidad —
 *   · el agente (ping y eventos) daba de alta por NOMBRE;
 *   · el escáner persistía por nombre, pero cuando no lograba
 *     el nombre del host usaba la IP COMO nombre;
 *   · «refrescar host» (service/refresh-host) hacía upsert
 *     directamente con `name = ip`.
 * Como `Computer.name` es único, la fila-IP y la fila-nombre
 * nunca se encontraban, y todo lo demás (código de
 * enrolamiento, versión, dueño) podía quedar atado a la fila
 * equivocada: el agente enrolaba presentando su nombre real y
 * el código vivía en la fila de la IP → «código no aceptado».
 *
 * Aquí vive LA resolución de identidad: emparejar por
 * credencial/id de agente, nombre normalizado o IP actual, y
 * FUSIONAR las filas duplicadas reapuntando sus relaciones,
 * en vez de crear otra fila. Se invoca al enrolar, al
 * reportar (ping/eventos) y al persistir el escaneo.
 */

// ── Parte pura (probable sin base de datos) ─────────────────

/** ¿El «nombre» de una fila es en realidad una IPv4? */
export function esNombreIp(nombre: string): boolean {
  const partes = (nombre ?? "").trim().split(".");
  if (partes.length !== 4) return false;
  return partes.every((p) => {
    if (!/^\d{1,3}$/.test(p)) return false;
    const n = Number(p);
    return n >= 0 && n <= 255;
  });
}

/** Datos mínimos de una fila para decidir cuál sobrevive. */
export interface FilaEquipo {
  id: string;
  name: string;
  ipAddress: string;
  clavePublica?: string | null;
  credencialAt?: Date | string | null;
  codigoEnrolamientoHash?: string | null;
  codigoEnrolamientoExpira?: Date | string | null;
  lastSeen?: Date | string | null;
  createdAt?: Date | string | null;
}

function tiempo(valor: Date | string | null | undefined): number {
  if (!valor) return 0;
  const t = new Date(valor).getTime();
  return Number.isNaN(t) ? 0 : t;
}

/**
 * Puntuación de «verdad» de una fila: la que tiene la
 * credencial del agente manda (es la identidad criptográfica);
 * después, la que tiene un código de enrolamiento vivo; la que
 * tiene nombre de verdad gana a la fila bautizada con una IP;
 * y a igualdad, la más antigua (la original).
 */
export function puntuarFila(fila: FilaEquipo, ahoraMs: number): number {
  let puntos = 0;
  if (fila.clavePublica) puntos += 100;
  if (fila.credencialAt) puntos += 40;
  if (
    fila.codigoEnrolamientoHash &&
    tiempo(fila.codigoEnrolamientoExpira) > ahoraMs
  ) {
    puntos += 30;
  }
  if (!esNombreIp(fila.name)) puntos += 20;
  if (fila.lastSeen) puntos += 5;
  // Antigüedad: hasta 10 puntos, más para la fila más vieja.
  const creada = tiempo(fila.createdAt);
  if (creada > 0) {
    const edadDias = Math.max(0, (ahoraMs - creada) / 86_400_000);
    puntos += Math.min(10, edadDias / 3);
  }
  return puntos;
}

/** De dos filas del mismo equipo, cuál debe sobrevivir. */
export function elegirSobreviviente<T extends FilaEquipo>(
  a: T,
  b: T,
  ahoraMs: number = Date.now(),
): T {
  return puntuarFila(a, ahoraMs) >= puntuarFila(b, ahoraMs) ? a : b;
}

// ── Parte con base de datos ─────────────────────────────────

const SELECCION_FILA = {
  id: true,
  name: true,
  ipAddress: true,
  clavePublica: true,
  credencialAt: true,
  codigoEnrolamientoHash: true,
  codigoEnrolamientoExpira: true,
  lastSeen: true,
  createdAt: true,
} as const;

/**
 * Fusiona la fila duplicada EN la sobreviviente y borra la
 * duplicada. Reapunta todo lo que cuelga de un equipo:
 * usuarios asignados (dueño), bloqueos, órdenes del agente y
 * destinos de tareas de instalación; y unifica el historial
 * por nombre (eventos USB, bloqueos e intentos guardan el
 * nombre como texto). Los campos de credencial no se pisan:
 * la sobreviviente conserva los suyos y solo hereda de la
 * duplicada lo que le falte. Sin migración de esquema: son
 * actualizaciones de datos dentro de una transacción.
 */
export async function fusionarEquipos(
  sobrevivienteId: string,
  duplicadoId: string,
): Promise<void> {
  if (sobrevivienteId === duplicadoId) return;
  const [sobreviviente, duplicado] = await Promise.all([
    (db as any).computer.findUnique({
      where: { id: sobrevivienteId },
      select: {
        ...SELECCION_FILA,
        serviceInstalled: true,
        serviceRunning: true,
        agentVersion: true,
        agentTokenHash: true,
      },
    }),
    (db as any).computer.findUnique({
      where: { id: duplicadoId },
      select: {
        ...SELECCION_FILA,
        serviceInstalled: true,
        serviceRunning: true,
        agentVersion: true,
        agentTokenHash: true,
      },
    }),
  ]);
  if (!sobreviviente || !duplicado) return;

  const ultimaSenal =
    tiempo(duplicado.lastSeen) > tiempo(sobreviviente.lastSeen)
      ? duplicado.lastSeen
      : sobreviviente.lastSeen;

  await (db as any).$transaction(async (tx: any) => {
    // Relaciones por id: pasan a colgar de la sobreviviente.
    await tx.user.updateMany({
      where: { computerId: duplicadoId },
      data: { computerId: sobrevivienteId },
    });
    await tx.pendingUnlock.updateMany({
      where: { computerId: duplicadoId },
      data: { computerId: sobrevivienteId, pcName: sobreviviente.name },
    });
    // Las órdenes cuelgan con onDelete: Cascade: sin reapuntar,
    // borrar la duplicada se llevaría las órdenes por delante.
    await tx.agentCommand.updateMany({
      where: { computerId: duplicadoId },
      data: { computerId: sobrevivienteId },
    });
    await tx.installTaskTarget.updateMany({
      where: { computerId: duplicadoId },
      data: { computerId: sobrevivienteId },
    });
    // Historial por nombre (texto): se unifica al nombre bueno.
    if (duplicado.name !== sobreviviente.name) {
      await tx.uSBEvent.updateMany({
        where: { pcName: duplicado.name },
        data: { pcName: sobreviviente.name },
      });
      await tx.unlockAttempt.updateMany({
        where: { pcName: duplicado.name },
        data: { pcName: sobreviviente.name },
      });
    }
    // La sobreviviente hereda lo que le falte; nada se pisa.
    await tx.computer.update({
      where: { id: sobrevivienteId },
      data: {
        lastSeen: ultimaSenal ?? sobreviviente.lastSeen,
        serviceInstalled:
          sobreviviente.serviceInstalled || duplicado.serviceInstalled,
        serviceRunning:
          sobreviviente.serviceRunning || duplicado.serviceRunning,
        agentVersion: sobreviviente.agentVersion ?? duplicado.agentVersion,
        clavePublica: sobreviviente.clavePublica ?? duplicado.clavePublica,
        credencialAt: sobreviviente.credencialAt ?? duplicado.credencialAt,
        codigoEnrolamientoHash:
          sobreviviente.codigoEnrolamientoHash ??
          duplicado.codigoEnrolamientoHash,
        codigoEnrolamientoExpira:
          sobreviviente.codigoEnrolamientoExpira ??
          duplicado.codigoEnrolamientoExpira,
        agentTokenHash:
          sobreviviente.agentTokenHash ?? duplicado.agentTokenHash,
        ipAddress:
          sobreviviente.ipAddress && sobreviviente.ipAddress.trim() !== ""
            ? sobreviviente.ipAddress
            : duplicado.ipAddress,
      },
    });
    await tx.computer.delete({ where: { id: duplicadoId } });
  });
  logInfo("Equipos duplicados fusionados", {
    sobreviviente: sobreviviente.name,
    duplicado: duplicado.name,
  });
}

/**
 * Resolución de identidad cuando un agente se presenta por
 * nombre (y, si se conoce, desde una IP): devuelve LA fila del
 * equipo, fusionando antes la fila-nombre y la fila-IP si son
 * dos filas distintas de la misma PC. Si la sobreviviente es
 * la fila-IP y el nombre bueno está libre, la fila se renombra
 * al nombre real del agente. Devuelve null si no hay ninguna
 * fila que emparejar.
 */
export async function resolverEquipoParaAgente(datos: {
  nombre: string;
  ip?: string | null;
}): Promise<{ id: string; name: string } | null> {
  const nombre = normalizeComputerName(datos.nombre);
  if (!nombre) return null;
  const ip = (datos.ip ?? "").trim();

  const porNombre = await (db as any).computer.findUnique({
    where: { name: nombre },
    select: SELECCION_FILA,
  });
  let porIp: FilaEquipo | null = null;
  if (ip) {
    porIp = await (db as any).computer.findFirst({
      where: {
        ipAddress: ip,
        ...(porNombre ? { NOT: { id: porNombre.id } } : {}),
      },
      select: SELECCION_FILA,
      orderBy: { createdAt: "asc" },
    });
  }

  if (porNombre && porIp) {
    const sobreviviente = elegirSobreviviente(porNombre, porIp);
    const duplicado =
      sobreviviente.id === porNombre.id ? porIp : porNombre;
    await fusionarEquipos(sobreviviente.id, duplicado.id);
    // Si sobrevivió la fila bautizada con la IP, adopta el
    // nombre real del agente (está libre: la otra fila ya no
    // existe y el nombre pedido no lo tiene nadie más).
    if (sobreviviente.name !== nombre) {
      await (db as any).computer.update({
        where: { id: sobreviviente.id },
        data: { name: nombre },
      });
      return { id: sobreviviente.id, name: nombre };
    }
    return { id: sobreviviente.id, name: sobreviviente.name };
  }
  const unica = porNombre ?? porIp;
  if (!unica) return null;
  // Solo hay fila-IP y su nombre no es el del agente: se
  // renombra si ese nombre está libre (ella era la única).
  if (!porNombre && porIp && porIp.name !== nombre) {
    await (db as any).computer.update({
      where: { id: porIp.id },
      data: { name: nombre },
    });
    return { id: porIp.id, name: nombre };
  }
  return { id: unica.id, name: unica.name };
}

/**
 * Resolución al REPORTAR: el agente ya viene acreditado
 * (requireAgentAuth resolvió su fila por el id de la cabecera),
 * así que esa fila es la identidad. Si el nombre que reporta
 * existe como OTRA fila (la duplicada), se fusiona en la
 * acreditada. Best-effort: un fallo aquí no tumba el reporte.
 */
export async function fusionarDuplicadoDeReporte(
  computerIdAutenticado: string,
  nombreReportado: string,
): Promise<void> {
  try {
    const nombre = normalizeComputerName(nombreReportado);
    if (!nombre) return;
    const otra = await (db as any).computer.findUnique({
      where: { name: nombre },
      select: { id: true },
    });
    if (otra && otra.id !== computerIdAutenticado) {
      await fusionarEquipos(computerIdAutenticado, otra.id);
    }
  } catch (error) {
    logWarn("No se pudo fusionar el duplicado al reportar", {
      error: error instanceof Error ? error.message : String(error),
    });
  }
}
