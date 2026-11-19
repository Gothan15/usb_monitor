/**
 * Etiquetas en español para los códigos de evento que manda el
 * agente. Los códigos se guardan en inglés en la base de datos
 * (CONNECTED, BLOCKED…) y el panel los pintaba tal cual: la
 * traducción vive aquí, al presentar, sin tocar lo ya guardado.
 */
const ETIQUETAS_EVENTO: Record<string, string> = {
  CONNECTED: "Conectado",
  DISCONNECTED: "Desconectado",
  BLOCKED: "Bloqueado",
  UNLOCKED: "Desbloqueado",
  UNLOCK_ATTEMPT_FAILED: "Intento de desbloqueo fallido",
  BLOCK_REAPPLIED: "Bloqueo reaplicado",
  UNLOCK_RELEASE_FAILED: "Fallo al liberar",
  EMERGENCY_UNLOCK: "Desbloqueo de emergencia",
  SERVICE_START: "Servicio iniciado",
  SERVICE_STOP: "Servicio detenido",
  SHUTDOWN_ARMED: "Apagado programado",
  SHUTDOWN_CANCELLED: "Apagado cancelado",
  SHUTDOWN_RECOVERED: "Apagado recuperado",
  SHUTDOWN_ORPHANED: "Apagado sin el agente",
  ESCALATION_WARNING: "Escalera: aviso",
  ESCALATION_LOCK: "Escalera: sesión bloqueada",
  // No lo manda el agente: lo deja el propio panel cuando una
  // cuenta queda bloqueada por intentos fallidos de inicio de
  // sesión (la fila lleva el panel como equipo, la IP de quien
  // lo intentó y la cuenta como usuario).
  LOGIN_BLOCKED: "Cuenta bloqueada (inicio de sesión)",
};

/** La familia de eventos que abre o cierra una cuenta atrás de apagado. */
export const EVENTOS_APAGADO = [
  "SHUTDOWN_ARMED",
  "SHUTDOWN_RECOVERED",
  "SHUTDOWN_CANCELLED",
  "SHUTDOWN_ORPHANED",
] as const;

/**
 * ¿Sigue en curso la cuenta atrás de un equipo, según su
 * ÚLTIMO evento de la familia del apagado? La arma o la
 * recupera → en curso; la cancela o quedó huérfana → no. Sin
 * evento conocido, no.
 */
export function apagadoEnCursoDesdeEvento(
  ultimoEvento: string | null | undefined,
): boolean {
  const codigo = (ultimoEvento ?? "").trim().toUpperCase();
  return codigo === "SHUTDOWN_ARMED" || codigo === "SHUTDOWN_RECOVERED";
}

export function etiquetaEventoUsb(codigo: string | null | undefined): string {
  if (!codigo) return "Evento";
  return ETIQUETAS_EVENTO[codigo.trim().toUpperCase()] ?? codigo;
}

const ETIQUETAS_CAPA: Record<string, string> = {
  PNP: "PnP",
  VOLUMEN: "Volumen",
  SOLO_LECTURA: "Solo lectura",
};

/** Capa de bloqueo del agente (PNP / VOLUMEN / SOLO_LECTURA) en español. */
export function etiquetaCapaBloqueo(valor: string | null | undefined): string {
  if (!valor) return "";
  const limpio = valor.trim();
  const degradado = /\(degradado\)/i.test(limpio);
  const base = limpio.replace(/\(degradado\)/i, "").trim().toUpperCase();
  const etiqueta = ETIQUETAS_CAPA[base] ?? limpio;
  return degradado ? `${etiqueta} (degradado)` : etiqueta;
}
