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
 *
 * Segunda vuelta (2026-11-08, tras probar la v1.0.23 en su
 * Windows): la instalación remota SEGUÍA dejando la fila con
 * la IP como nombre y el enrolamiento sin emparejar. La
 * cadena: el destino de la tarea nace con la IP como nombre
 * (el escáner no resolvió el nombre de su VM), el ejecutor
 * crea la fila-marcador con ese nombre y el código de 12 h se
 * genera sobre ELLA; pero el agente, al enrolar, solo
 * presentaba su nombre real, y el panel emparejaba por nombre
 * o por la IP DE ORIGEN de la conexión — que en una VM con
 * varios adaptadores (o tras NAT) no tiene por qué ser la IP
 * del empuje. Sin emparejamiento no hay renombrado: la fila
 * se quedaba «por IP» para siempre y el código, rechazado
 * como «de otro equipo». Ahora el agente DECLARA todas sus
 * IPv4 al enrolar y el emparejamiento las prueba todas; la
 * fila dueña del código presentado, si es un marcador (nombre
 * = IP y sin credencial), entra además como candidata por el
 * propio código; y al reportar, la fila acreditada bautizada
 * con una IP se renombra sola al nombre real que trae el
 * agente (autocura en el primer contacto firmado).
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
 * nombre: devuelve LA fila del equipo, fusionando antes las
 * filas candidatas si son dos (o tres) filas distintas de la
 * misma PC. Las candidatas salen de:
 *   · el NOMBRE que el agente presenta (la vía de siempre);
 *   · sus IPs: la de origen de la conexión y TODAS las que el
 *     propio agente declara como suyas — la del empuje puede
 *     no ser la de origen si la VM tiene varios adaptadores;
 *   · la fila DUEÑA del código de enrolamiento presentado, si
 *     es un marcador (nombre = una IP y sin credencial): es la
 *     fila que la instalación remota creó para esta PC y el
 *     código la señala sin ambigüedad, así que al consumirse
 *     el código la fila resultante es ESA.
 * Si la sobreviviente no lleva el nombre real del agente, se
 * renombra (el nombre está libre: la fila que lo tuviera era
 * candidata y se acaba de fusionar). Devuelve null si no hay
 * ninguna fila que emparejar.
 */
export async function resolverEquipoParaAgente(datos: {
  nombre: string;
  ip?: string | null;
  ips?: string[] | null;
  filaDelCodigoId?: string | null;
}): Promise<{ id: string; name: string } | null> {
  const nombre = normalizeComputerName(datos.nombre);
  if (!nombre) return null;

  // IPs candidatas, en orden: primero la de origen de la
  // conexión (la que el panel ve) y después las que el agente
  // declara — el emparejamiento prueba cada una.
  const ipsCandidatas = [
    ...new Set(
      [datos.ip ?? "", ...(datos.ips ?? [])]
        .map((valor) => (valor ?? "").trim())
        .filter((valor) => valor.length > 0),
    ),
  ];

  const porNombre = await (db as any).computer.findUnique({
    where: { name: nombre },
    select: SELECCION_FILA,
  });
  let porIp: FilaEquipo | null = null;
  for (const ip of ipsCandidatas) {
    porIp = await (db as any).computer.findFirst({
      where: {
        ipAddress: ip,
        ...(porNombre ? { NOT: { id: porNombre.id } } : {}),
      },
      select: SELECCION_FILA,
      orderBy: { createdAt: "asc" },
    });
    if (porIp) break;
  }

  // La fila del código solo entra si es un MARCADOR: nombre =
  // una IP (la creó el escáner o la instalación remota como
  // comodín) y sin credencial registrada. Una fila con nombre
  // real NO se reclama por el código de otro: ese choque sigue
  // siendo «código de otro equipo», como hasta ahora.
  let porCodigo: FilaEquipo | null = null;
  if (
    datos.filaDelCodigoId &&
    datos.filaDelCodigoId !== porNombre?.id &&
    datos.filaDelCodigoId !== porIp?.id
  ) {
    const fila = await (db as any).computer.findUnique({
      where: { id: datos.filaDelCodigoId },
      select: SELECCION_FILA,
    });
    if (fila && esNombreIp(fila.name) && !fila.clavePublica) {
      porCodigo = fila;
    }
  }

  const candidatas: FilaEquipo[] = [];
  for (const fila of [porNombre, porIp, porCodigo]) {
    if (fila && !candidatas.some((c) => c.id === fila.id)) {
      candidatas.push(fila);
    }
  }

  if (candidatas.length >= 2) {
    // Sobreviviente: la que tenga la credencial del agente
    // manda (identidad criptográfica); si ninguna la tiene, la
    // fila del código — es la que el agente viene a reclamar y
    // la que la tarea de instalación está mirando —; y si no
    // hay código en juego, la puntuación de siempre.
    const sobreviviente =
      candidatas.find((c) => c.clavePublica) ??
      porCodigo ??
      candidatas.reduce((mejor, c) =>
        puntuarFila(c, Date.now()) > puntuarFila(mejor, Date.now())
          ? c
          : mejor,
      );
    for (const otra of candidatas) {
      if (otra.id !== sobreviviente.id) {
        await fusionarEquipos(sobreviviente.id, otra.id);
      }
    }
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
  const unica = candidatas[0] ?? null;
  if (!unica) return null;
  // Solo hay una fila y no es la del nombre presentado (se
  // emparejó por una IP o por el código): adopta el nombre
  // real del agente — su nombre guardado es un marcador o el
  // nombre viejo de esta misma PC, y el bueno está libre
  // porque ninguna otra fila lo tiene.
  if (!porNombre && unica.name !== nombre) {
    await (db as any).computer.update({
      where: { id: unica.id },
      data: { name: nombre },
    });
    return { id: unica.id, name: nombre };
  }
  return { id: unica.id, name: unica.name };
}

/**
 * Resolución al REPORTAR: el agente ya viene acreditado
 * (requireAgentAuth resolvió su fila por el id de la cabecera),
 * así que esa fila es la identidad. Si el nombre que reporta
 * existe como OTRA fila (la duplicada), se fusiona en la
 * acreditada. Y si la fila acreditada sigue bautizada con una
 * IP —la creó una instalación remota y el enrolamiento no la
 * renombró—, adopta el nombre real que el agente reporta:
 * autocura en el primer contacto firmado, sin esperar a que
 * nadie edite nada a mano. Best-effort: un fallo aquí no
 * tumba el reporte.
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
    if (!esNombreIp(nombre)) {
      const propia = await (db as any).computer.findUnique({
        where: { id: computerIdAutenticado },
        select: { id: true, name: true },
      });
      if (propia && propia.name !== nombre && esNombreIp(propia.name)) {
        await (db as any).computer.update({
          where: { id: propia.id },
          data: { name: nombre },
        });
        logInfo("Equipo renombrado al nombre real que reporta su agente", {
          antes: propia.name,
          ahora: nombre,
        });
      }
    }
  } catch (error) {
    logWarn("No se pudo fusionar el duplicado al reportar", {
      error: error instanceof Error ? error.message : String(error),
    });
  }
}
