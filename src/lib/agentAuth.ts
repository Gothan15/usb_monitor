import { createHash, createPublicKey, verify } from "crypto";

import type { ServiceAuthIdentity } from "@/lib/auth";
import { ipClienteDe } from "@/lib/auth";
import { db } from "@/lib/db";
import { revocarCredencial } from "@/lib/credenciales";
import { logError } from "@/lib/logger";

/**
 * Autenticación del agente tras el overhaul de 2026-11-08.
 *
 * Ya no hay token portador: cada equipo firma cada petición con
 * la clave privada que nació en su PC, y el servidor verifica
 * con la pública registrada. La cadena firmada es:
 *
 *   METODO \n RUTA+QUERY \n MARCA_DE_TIEMPO \n NONCE \n SHA256(CUERPO)
 *
 * Cabeceras: X-Agente-Id (el id del equipo), X-Agente-Ts
 * (segundos Unix), X-Agente-Nonce (único por petición) y
 * X-Agente-Firma (ECDSA P-256/SHA-256 en formato P1363,
 * base64url). Ventana de validez de la marca: ±300 s; un nonce
 * repetido dentro de la ventana se rechaza (anti-repetición).
 *
 * Vigilancia (K): si la MISMA credencial firma desde dos IP
 * distintas dentro de 10 minutos, casi seguro la clave salió de
 * la PC: se revoca al momento y queda la alerta en el equipo.
 *
 * Desde la 2.0 es la ÚNICA vía: el puente con el token antiguo
 * y la ruta de migración desaparecieron; un equipo sin clave
 * registrada solo puede enrolarse con un código de un solo uso.
 */

const VENTANA_TS_SEG = 300;
const VENTANA_NONCE_MS = 2 * VENTANA_TS_SEG * 1000;
const VENTANA_AVISTAMIENTO_MS = 10 * 60 * 1000;

// ── Piezas puras (las usa también la verificación cruzada) ────

export function construirCadenaCanonica(
  metodo: string,
  rutaConQuery: string,
  ts: string,
  nonce: string,
  cuerpo: string,
): string {
  const hashCuerpo = createHash("sha256").update(cuerpo, "utf8").digest("hex");
  return [metodo.toUpperCase(), rutaConQuery, ts, nonce, hashCuerpo].join("\n");
}

export function verificarFirma(
  clavePublicaB64: string,
  cadenaCanonica: string,
  firmaB64Url: string,
): boolean {
  try {
    const clave = createPublicKey({
      key: Buffer.from(clavePublicaB64, "base64"),
      format: "der",
      type: "spki",
    });
    return verify(
      "sha256",
      Buffer.from(cadenaCanonica, "utf8"),
      { key: clave, dsaEncoding: "ieee-p1363" },
      Buffer.from(firmaB64Url, "base64url"),
    );
  } catch {
    return false;
  }
}

// ── Anti-repetición y avistamientos (en memoria del proceso) ──

const noncesVistos = new Map<string, Map<string, number>>();

function nonceRepetido(computerId: string, nonce: string): boolean {
  const ahora = Date.now();
  let porPc = noncesVistos.get(computerId);
  if (!porPc) {
    porPc = new Map();
    noncesVistos.set(computerId, porPc);
  }
  for (const [n, expira] of porPc) {
    if (expira < ahora) porPc.delete(n);
  }
  if (porPc.has(nonce)) return true;
  porPc.set(nonce, ahora + VENTANA_NONCE_MS);
  return false;
}

const avistamientos = new Map<string, Map<string, number>>();

function ipNormalizada(ip: string): string {
  const limpia = ip.trim().toLowerCase();
  if (limpia === "::1" || limpia === "127.0.0.1" || limpia === "::ffff:127.0.0.1") {
    return "local";
  }
  return limpia;
}

/** Registra la IP de una petición válida; true si hay OTRA IP viva a la vez. */
function registrarAvistamiento(computerId: string, ipCruda: string): boolean {
  const ahora = Date.now();
  const ip = ipNormalizada(ipCruda);
  let porPc = avistamientos.get(computerId);
  if (!porPc) {
    porPc = new Map();
    avistamientos.set(computerId, porPc);
  }
  for (const [otra, vista] of porPc) {
    if (ahora - vista > VENTANA_AVISTAMIENTO_MS) porPc.delete(otra);
  }
  porPc.set(ip, ahora);
  return porPc.size > 1;
}

// ── Verificación principal ────────────────────────────────────

async function contarIntentoFallido(computerId: string): Promise<void> {
  try {
    await (db as any).computer.update({
      where: { id: computerId },
      data: { intentosFallidosCredencial: { increment: 1 } },
    });
  } catch {
    // El contador es vigilancia, nunca un bloqueo del camino.
  }
}

export async function autenticarAgenteFirmado(
  req: Request,
): Promise<ServiceAuthIdentity | null> {
  const computerId = req.headers.get("x-agente-id");
  const ts = req.headers.get("x-agente-ts");
  const nonce = req.headers.get("x-agente-nonce");
  const firma = req.headers.get("x-agente-firma");
  if (!computerId || !ts || !nonce || !firma) return null;

  const computer = await (db as any).computer.findUnique({
    where: { id: computerId },
    select: { id: true, name: true, clavePublica: true },
  });
  if (!computer?.clavePublica) return null;

  const tsNumero = Number(ts);
  if (!Number.isFinite(tsNumero)) return null;
  if (Math.abs(Date.now() / 1000 - tsNumero) > VENTANA_TS_SEG) {
    await contarIntentoFallido(computer.id);
    return null;
  }

  const url = new URL(req.url);
  const rutaConQuery = url.pathname + url.search;
  const metodo = req.method.toUpperCase();
  const cuerpo =
    metodo === "GET" || metodo === "HEAD" ? "" : await req.clone().text();
  const canonica = construirCadenaCanonica(metodo, rutaConQuery, ts, nonce, cuerpo);
  if (!verificarFirma(computer.clavePublica, canonica, firma)) {
    await contarIntentoFallido(computer.id);
    return null;
  }
  if (nonceRepetido(computer.id, nonce)) {
    await contarIntentoFallido(computer.id);
    return null;
  }

  // Vigilancia K: la misma credencial viva desde dos IP.
  if (registrarAvistamiento(computer.id, ipClienteDe(req))) {
    const motivo =
      "La misma credencial firmó desde dos direcciones IP a la vez: " +
      "revocada automáticamente (posible copia de la clave fuera de la PC).";
    logError(`Credencial revocada por doble IP: ${computer.name}`, new Error(motivo));
    await revocarCredencial(computer.id, motivo).catch(() => {});
    return null;
  }

  return { type: "service", serviceId: computer.name, token: "", computerId: computer.id };
}

/** Como requireServiceAuth, pero solo admite la firma del equipo. */
export async function requireAgentAuth(
  req: Request,
): Promise<ServiceAuthIdentity> {
  const auth = await autenticarAgenteFirmado(req);
  if (!auth) throw new Error("UNAUTHORIZED");
  return auth;
}
