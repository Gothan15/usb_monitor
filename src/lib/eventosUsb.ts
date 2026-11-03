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
  BLOCK_REAPPLIED: "Bloqueo reaplicado",
  UNLOCK_RELEASE_FAILED: "Fallo al liberar",
  EMERGENCY_UNLOCK: "Desbloqueo de emergencia",
  SERVICE_START: "Servicio iniciado",
  SERVICE_STOP: "Servicio detenido",
  SHUTDOWN_ARMED: "Apagado programado",
  SHUTDOWN_CANCELLED: "Apagado cancelado",
};

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
