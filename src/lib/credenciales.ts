import { createHash, createPublicKey, randomBytes, timingSafeEqual } from "crypto";

import { db } from "@/lib/db";

/**
 * Credencial del agente tras el overhaul de 2026-11-08.
 *
 * Cada equipo tiene un par de claves ECDSA P-256 que NACE en la
 * propia PC: el servidor guarda solo la clave pública (SPKI en
 * base64) y su huella, y la privada jamás sale de la máquina.
 * Aquí viven las piezas del servidor: validar y registrar la
 * pública, los códigos de enrolamiento de un solo uso que
 * sustituyen a la antigua clave de flota compartida, y la
 * revocación.
 */

const ALFABETO_CODIGO = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";

function hashTexto(texto: string): string {
  return createHash("sha256").update(texto, "utf8").digest("hex");
}

/** Huella de una clave pública: SHA-256 de su SPKI (DER). */
export function huellaClavePublica(clavePublicaB64: string): string {
  return createHash("sha256")
    .update(Buffer.from(clavePublicaB64, "base64"))
    .digest("hex");
}

/**
 * Comprueba que lo recibido es una clave pública ECDSA P-256 en
 * formato SPKI. Devuelve la huella o null si no vale: registrar
 * una clave que no se puede verificar dejaría al equipo fuera
 * para siempre, así que la validación es parte del registro.
 */
export function validarClavePublica(clavePublicaB64: string): string | null {
  try {
    const clave = createPublicKey({
      key: Buffer.from(clavePublicaB64, "base64"),
      format: "der",
      type: "spki",
    });
    const detalles = clave.asymmetricKeyDetails;
    if (clave.asymmetricKeyType !== "ec") return null;
    if (detalles?.namedCurve !== "prime256v1") return null;
    return huellaClavePublica(clavePublicaB64);
  } catch {
    return null;
  }
}

/**
 * Registra la clave pública de un equipo: queda como su
 * credencial, se consume cualquier código pendiente, muere el
 * token legado si lo hubiera y se limpia su vigilancia.
 */
export async function registrarClavePublica(
  computerId: string,
  clavePublicaB64: string,
): Promise<string> {
  const huella = validarClavePublica(clavePublicaB64);
  if (!huella) {
    throw new Error("La clave pública no es una ECDSA P-256 válida.");
  }
  await (db as any).computer.update({
    where: { id: computerId },
    data: {
      clavePublica: clavePublicaB64,
      clavePublicaHuella: huella,
      credencialAt: new Date(),
      codigoEnrolamientoHash: null,
      codigoEnrolamientoExpira: null,
      agentTokenHash: null,
      intentosFallidosCredencial: 0,
      alertaCredencial: null,
      credencialRevocadaAt: null,
    },
  });
  return huella;
}

/**
 * Revoca la credencial de un equipo: sin clave ni token legado
 * no puede firmar ni migrar; solo le queda enrolarse de nuevo
 * con un código. El motivo queda como alerta visible en Equipos.
 */
export async function revocarCredencial(
  computerId: string,
  motivo: string,
): Promise<void> {
  await (db as any).computer.update({
    where: { id: computerId },
    data: {
      clavePublica: null,
      clavePublicaHuella: null,
      credencialAt: null,
      codigoEnrolamientoHash: null,
      codigoEnrolamientoExpira: null,
      agentTokenHash: null,
      alertaCredencial: motivo,
      credencialRevocadaAt: new Date(),
    },
  });
}

// ── Códigos de enrolamiento ────────────────────────────────────

function normalizarCodigo(codigo: string): string {
  return codigo.replace(/[^a-zA-Z0-9]/g, "").toUpperCase();
}

/**
 * Genera un código de enrolamiento de UN SOLO USO para un
 * equipo (12 caracteres en tres grupos, sin caracteres
 * ambiguos). Se enseña una vez; el servidor guarda solo su
 * hash. Generar otro invalida el anterior.
 */
export async function generarCodigoEnrolamiento(
  computerId: string,
  ttlMinutos: number,
): Promise<{ codigo: string; expira: Date }> {
  const bytes = randomBytes(12);
  let crudo = "";
  for (let i = 0; i < 12; i++) {
    crudo += ALFABETO_CODIGO[bytes[i] % ALFABETO_CODIGO.length];
  }
  const codigo = `${crudo.slice(0, 4)}-${crudo.slice(4, 8)}-${crudo.slice(8, 12)}`;
  const expira = new Date(Date.now() + ttlMinutos * 60_000);
  await (db as any).computer.update({
    where: { id: computerId },
    data: {
      codigoEnrolamientoHash: hashTexto(normalizarCodigo(codigo)),
      codigoEnrolamientoExpira: expira,
    },
  });
  return { codigo, expira };
}

/** ¿El código presentado es el vigente de este equipo y no ha caducado? */
export function codigoEnrolamientoValido(
  computer: { codigoEnrolamientoHash: string | null; codigoEnrolamientoExpira: Date | null },
  codigo: string,
): boolean {
  if (!computer.codigoEnrolamientoHash || !computer.codigoEnrolamientoExpira) {
    return false;
  }
  if (new Date(computer.codigoEnrolamientoExpira).getTime() < Date.now()) {
    return false;
  }
  const presentado = Buffer.from(hashTexto(normalizarCodigo(codigo)), "hex");
  const guardado = Buffer.from(computer.codigoEnrolamientoHash, "hex");
  return (
    presentado.length === guardado.length &&
    timingSafeEqual(presentado, guardado)
  );
}
