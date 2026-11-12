import { db } from "@/lib/db";
import { broadcastUSBEvent } from "@/lib/socket";
import { getCurrentDate } from "@/lib/time";

/**
 * Intentos de desbloqueo fallidos: su evento en el registro y
 * el freno a la fuerza bruta por equipo.
 *
 * Hasta ahora un intento fallido solo quedaba en la auditoría
 * de Desbloqueos (UnlockAttempt): había que ir a mirar. Pero un
 * intento fallido es una señal de seguridad — alguien está
 * probando contraseñas contra una memoria bloqueada — y merece
 * el mismo escaparate que un bloqueo: fila en Eventos y aviso
 * en vivo en el panel.
 *
 * Y la fuerza bruta: el bloqueo que ya existía es por CUENTA
 * (5 fallos y la cuenta duerme 15 min), pero no frena a quien
 * rota usuarios o prueba contra la misma PC sin parar — los
 * intentos con usuario inexistente ni siquiera sumaban a
 * ninguna cuenta. Aquí va la segunda capa: por EQUIPO. Si una
 * PC acumula demasiados fallos en la ventana, el panel deja de
 * evaluar contraseñas para esa PC hasta que la ventana se
 * enfríe, acierte quien acierte.
 */

/** Código del evento que se crea en el registro por cada señal. */
export const EVENTO_INTENTO_FALLIDO = "UNLOCK_ATTEMPT_FAILED";

/** Resultado que se anota cuando la pausa por equipo deniega. */
export const RESULTADO_PC_EN_PAUSA = "PC_LOCKED";

/**
 * Resultados de intento que merecen evento propio en el
 * registro. Quedan fuera los de rutina o contexto (sin bloqueo
 * activo, fuera de la whitelist — ese dispositivo ya genera
 * sus eventos de conexión y bloqueo — o la función apagada).
 */
export const RESULTADOS_CON_EVENTO: ReadonlySet<string> = new Set([
  "BAD_PASSWORD",
  "NOT_OWNER",
  "LOCKED",
  RESULTADO_PC_EN_PAUSA,
  "OFFLINE_FAIL",
]);

export function debeCrearEventoIntento(result: string): boolean {
  return RESULTADOS_CON_EVENTO.has(result);
}

/**
 * Resultados que suman para la pausa por equipo. Incluye los
 * de usuario inexistente (se anotan como BAD_PASSWORD) y los
 * NO_PENDING (probar sin bloqueo también es sondear). Los
 * PC_LOCKED no suman: si sumaran, cada intento durante la
 * pausa la extendería y la PC no saldría nunca.
 */
export const RESULTADOS_QUE_CUENTAN_PC: readonly string[] = [
  "BAD_PASSWORD",
  "NOT_OWNER",
  "NO_PENDING",
  "LOCKED",
];

/** Fallos de una PC en la ventana que disparan su pausa. */
export const UMBRAL_FALLOS_PC = Number(
  process.env.USB_MONITOR_PC_MAX_FAILED_ATTEMPTS || 10,
);

/** Minutos que mira hacia atrás la ventana de la pausa. */
export const VENTANA_PAUSA_PC_MIN = Number(
  process.env.USB_MONITOR_PC_LOCK_MINUTES || 15,
);

/** ¿Con tantos fallos en la ventana, la PC debe estar en pausa? */
export function debePausarPc(
  fallosEnVentana: number,
  umbral: number = UMBRAL_FALLOS_PC,
): boolean {
  return fallosEnVentana >= umbral;
}

/**
 * La pausa se anuncia UNA vez: cuando la denegación anterior
 * de la PC no fue ya una de pausa. Si cada intento denegado
 * creara su evento, un ataque llenaría el registro de ruido y
 * taparía la señal, que es el primer aviso.
 */
export function esActivacionPausa(
  ultimoResultado: string | null | undefined,
): boolean {
  return ultimoResultado !== RESULTADO_PC_EN_PAUSA;
}

export interface DatosIntentoFallido {
  pcName: string;
  /** La cuenta que se intentó usar (no la contraseña, jamás). */
  usernameTried: string;
  serialNumber?: string | null;
  driveLetter?: string | null;
  whitelisted?: boolean;
  /** Solo para intentos sin conexión sincronizados tarde. */
  cuando?: Date;
}

/**
 * Crea el evento del intento fallido en el registro y lo emite
 * en vivo, como cualquier evento USB. En este evento el campo
 * pcUser lleva la cuenta intentada: es «el usuario» de la
 * acción que se audita. Nunca debe tumbar la verificación que
 * lo invoca: cualquier fallo aquí se traga.
 */
export async function crearEventoIntentoFallido(
  datos: DatosIntentoFallido,
): Promise<void> {
  try {
    const computer = await db.computer.findUnique({
      where: { name: datos.pcName },
      select: { ipAddress: true },
    });
    const ahora = datos.cuando ?? getCurrentDate();
    const evento = await db.uSBEvent.create({
      data: {
        pcName: datos.pcName,
        pcIp: computer?.ipAddress ?? "",
        pcUser: datos.usernameTried,
        event: EVENTO_INTENTO_FALLIDO,
        driveLetter: datos.driveLetter ?? null,
        serialNumber: datos.serialNumber ?? null,
        whitelisted: datos.whitelisted ?? false,
        timestamp: ahora,
      },
    });
    broadcastUSBEvent({
      id: evento.id,
      pcName: evento.pcName,
      pcIp: evento.pcIp,
      pcUser: evento.pcUser,
      unlockedBy: null,
      event: evento.event,
      driveLetter: evento.driveLetter,
      serialNumber: evento.serialNumber,
      readonlyStatus: evento.readonlyStatus,
      whitelisted: evento.whitelisted,
      timestamp: evento.timestamp.toISOString(),
      createdAt: evento.createdAt.toISOString(),
    });
  } catch (error) {
    console.error("No se pudo crear el evento del intento fallido:", error);
  }
}
