import { db } from "@/lib/db";

// ────────────────────────────────────────────────────────────────
// ¿Quién desbloqueó? — el nombre que acompaña a un evento de
// desbloqueo en el registro de Eventos.
//
// El dato nace en el bloqueo: cuando una cuenta autoriza con su
// contraseña, PendingUnlock guarda unlockedById (+ unlockedAt),
// y los intentos quedan en UnlockAttempt. Pero el EVENTO que el
// agente reporta («UNLOCKED») no trae ese dato: solo trae el
// usuario de sesión de la PC (pcUser), que es otra persona a
// menudo. Aquí se cruza el evento con los bloqueos de su equipo
// para estampar el nombre de la cuenta que autorizó.
//
// Se invoca en dos momentos:
//   · al INGESTAR el evento (el bloqueo ya está marcado como
//     desbloqueado, porque la autorización precede a la
//     ejecución en la PC y a su reporte);
//   · al LEER el registro, para rellenar eventos que llegaron
//     sin sello (p. ej. desbloqueos sin conexión, cuyo intento
//     se sincroniza después de que el evento ya entró).
// ────────────────────────────────────────────────────────────────

/** Tipos de evento que representan un desbloqueo consumado. */
export const EVENTOS_DESBLOQUEO = ["UNLOCKED", "EMERGENCY_UNLOCK"] as const;

/** Holgura al comparar horas: el sello del bloqueo y la llegada
 *  del evento no comparten reloj al segundo. */
const HOLGURA_MS = 5 * 60 * 1000;

/** Ventana hacia atrás en la que un bloqueo desbloqueado puede
 *  corresponder a un evento: cubre la sincronización tardía de
 *  los desbloqueos sin conexión sin pescar desbloqueos viejos
 *  de otro día para el mismo equipo. */
const VENTANA_MS = 7 * 24 * 60 * 60 * 1000;

/** Un bloqueo ya desbloqueado, candidato a ser «el» del evento. */
export interface CandidatoDesbloqueo {
  serialNumber: string | null;
  driveLetter: string | null;
  unlockedAt: Date;
  /** Nombre de la cuenta que autorizó (User.username). */
  nombre: string;
}

/** Lo mínimo de un evento para poder cruzarlo. */
export interface EventoParaCruce {
  pcName: string;
  event: string;
  serialNumber: string | null;
  driveLetter: string | null;
  /** Cuándo ocurrió (o llegó) el evento. */
  cuando: Date;
}

/** ¿Es este evento un desbloqueo que debería llevar nombre? */
export function esEventoDesbloqueo(tipo: string): boolean {
  return (EVENTOS_DESBLOQUEO as readonly string[]).includes(tipo);
}

/**
 * Pieza pura: elige el nombre del desbloqueador entre los
 * bloqueos candidatos de UN equipo.
 *
 * Reglas, en orden:
 *   1. El desbloqueo no puede ser posterior al evento (más la
 *      holgura): autorizar después de ejecutado no existe.
 *   2. Manda la coincidencia de dispositivo: primero el serial,
 *      luego la letra de unidad; sin ninguna, el desbloqueo
 *      válido más reciente.
 *   3. Dentro del grupo elegido, el más reciente.
 * Sin candidato válido, null (el evento queda sin sello, como
 * los históricos).
 */
export function elegirDesbloqueador(
  candidatos: CandidatoDesbloqueo[],
  evento: Pick<EventoParaCruce, "serialNumber" | "driveLetter" | "cuando">,
): string | null {
  const limite = evento.cuando.getTime() + HOLGURA_MS;
  const validos = candidatos.filter(
    (c) => c.unlockedAt.getTime() <= limite,
  );
  if (validos.length === 0) return null;

  const porSerial = evento.serialNumber
    ? validos.filter(
        (c) => c.serialNumber && c.serialNumber === evento.serialNumber,
      )
    : [];
  const porLetra =
    porSerial.length === 0 && evento.driveLetter
      ? validos.filter(
          (c) => c.driveLetter && c.driveLetter === evento.driveLetter,
        )
      : [];
  const grupo =
    porSerial.length > 0 ? porSerial : porLetra.length > 0 ? porLetra : validos;

  let elegido = grupo[0];
  for (const c of grupo) {
    if (c.unlockedAt.getTime() > elegido.unlockedAt.getTime()) elegido = c;
  }
  return elegido.nombre;
}

/** Trae los bloqueos desbloqueados de un equipo dentro de la
 *  ventana útil, ya en forma de candidatos. */
async function candidatosDeEquipo(
  pcName: string,
  desde: Date,
  hasta: Date,
): Promise<CandidatoDesbloqueo[]> {
  const filas = await db.pendingUnlock.findMany({
    where: {
      pcName,
      status: "UNLOCKED",
      unlockedById: { not: null },
      unlockedAt: { gte: desde, lte: hasta },
    },
    orderBy: { unlockedAt: "desc" },
    take: 25,
    select: {
      serialNumber: true,
      driveLetter: true,
      unlockedAt: true,
      unlockedBy: { select: { username: true } },
    },
  });
  return filas
    .filter((f) => f.unlockedBy && f.unlockedAt)
    .map((f) => ({
      serialNumber: f.serialNumber,
      driveLetter: f.driveLetter,
      unlockedAt: f.unlockedAt as Date,
      nombre: (f.unlockedBy as { username: string }).username,
    }));
}

/**
 * Resuelve el nombre para UN evento recién llegado. Devuelve
 * null si no es un desbloqueo o si aún no hay bloqueo que lo
 * respalde (la lectura posterior lo reintentará).
 */
export async function resolverNombreDesbloqueador(
  evento: EventoParaCruce,
): Promise<string | null> {
  if (!esEventoDesbloqueo(evento.event)) return null;
  const desde = new Date(evento.cuando.getTime() - VENTANA_MS);
  const hasta = new Date(evento.cuando.getTime() + HOLGURA_MS);
  const candidatos = await candidatosDeEquipo(evento.pcName, desde, hasta);
  return elegirDesbloqueador(candidatos, evento);
}

/**
 * Rellena, en una sola pasada de consultas, los nombres que
 * falten en una lista de eventos (los que ya traen nombre o no
 * son desbloqueos se devuelven como null en su posición: el
 * llamador conserva el suyo). Pensado para la lectura del
 * registro: una consulta de candidatos por equipo implicado.
 */
export async function completarDesbloqueadores(
  eventos: (EventoParaCruce & { unlockedBy: string | null })[],
): Promise<(string | null)[]> {
  const resultado: (string | null)[] = eventos.map(() => null);
  const porEquipo = new Map<string, number[]>();
  eventos.forEach((e, i) => {
    if (esEventoDesbloqueo(e.event) && !e.unlockedBy) {
      const lista = porEquipo.get(e.pcName) ?? [];
      lista.push(i);
      porEquipo.set(e.pcName, lista);
    }
  });
  if (porEquipo.size === 0) return resultado;

  for (const [pcName, indices] of porEquipo) {
    const tiempos = indices.map((i) => eventos[i].cuando.getTime());
    const desde = new Date(Math.min(...tiempos) - VENTANA_MS);
    const hasta = new Date(Math.max(...tiempos) + HOLGURA_MS);
    const candidatos = await candidatosDeEquipo(pcName, desde, hasta);
    if (candidatos.length === 0) continue;
    for (const i of indices) {
      resultado[i] = elegirDesbloqueador(candidatos, eventos[i]);
    }
  }
  return resultado;
}
