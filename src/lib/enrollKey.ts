import { createHash, randomBytes } from "crypto";
import { promises as fs } from "fs";
import path from "path";

import { escribirAtomico } from "@/lib/escribirAtomico";

/**
 * Clave de enrolamiento de la flota.
 *
 * Antes, dar de alta el token de un equipo era un trabajo manual
 * por PC: el administrador generaba el token de ESE equipo en el
 * panel y lo llevaba a mano hasta el asistente de la máquina.
 * Con muchos equipos eso no escala y cada token perdido obligaba
 * a repetir el viaje.
 *
 * Ahora hay UNA clave de enrolamiento para toda la flota: el
 * administrador la genera una vez aquí, la escribe en el asistente
 * de cualquier equipo nuevo (o la usa el instalador) y el agente
 * se presenta con ella a /api/agent/enroll, que le emite SU token
 * propio automáticamente. La clave es un secreto compartido de
 * despliegue (como la clave de un paquete de instalación): se
 * guarda solo su hash SHA-256, vive en un archivo propio del
 * servidor que ninguna ruta pública expone, y revocarla deja
 * fuera a los enrolamientos futuros sin tocar los tokens ya
 * emitidos (cada equipo conserva el suyo).
 */

const ENROLL_PATH = path.join(process.cwd(), "config", "enroll-key.json");

interface EnrollKeyData {
  hash: string;
  createdAt: string;
}

export function hashEnrollKey(key: string): string {
  return createHash("sha256").update(key, "utf8").digest("hex");
}

export function generateEnrollKey(): string {
  return randomBytes(24).toString("hex");
}

async function readEnrollKeyData(): Promise<EnrollKeyData | null> {
  try {
    const raw = await fs.readFile(ENROLL_PATH, "utf-8");
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed.hash === "string") {
      return { hash: parsed.hash, createdAt: String(parsed.createdAt ?? "") };
    }
    return null;
  } catch {
    return null;
  }
}

export async function enrollKeyStatus(): Promise<{
  configured: boolean;
  createdAt: string | null;
}> {
  const data = await readEnrollKeyData();
  return {
    configured: data !== null,
    createdAt: data?.createdAt || null,
  };
}

/** Guarda el hash de una clave recién generada (sustituye a la anterior). */
export async function saveEnrollKeyHash(hash: string): Promise<void> {
  await fs.mkdir(path.dirname(ENROLL_PATH), { recursive: true });
  const data: EnrollKeyData = { hash, createdAt: new Date().toISOString() };
  await escribirAtomico(ENROLL_PATH, JSON.stringify(data, null, 2));
}

export async function deleteEnrollKey(): Promise<void> {
  try {
    await fs.unlink(ENROLL_PATH);
  } catch {
    // No había clave: revocar es idempotente.
  }
}

/** ¿La clave presentada es la vigente? Comparación de hashes. */
export async function verifyEnrollKey(candidate: string): Promise<boolean> {
  if (!candidate) return false;
  const data = await readEnrollKeyData();
  if (!data) return false;
  return hashEnrollKey(candidate) === data.hash;
}
