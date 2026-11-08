import { promises as fs } from "fs";
import path from "path";

/**
 * Escritura de archivos «temporal + renombrar», endurecida para
 * Windows.
 *
 * El renombrado directo fallaba en producción con EPERM al
 * sustituir el ejecutable del paquete: en Windows, renombrar
 * sobre un archivo que el antivirus está escaneando en ese
 * momento (un exe de ~90 MB recién escrito es justo lo que
 * Defender mira con lupa) o que un agente está descargando es
 * una denegación breve, no un error de verdad. La escritura
 * ingenua lo daba por imposible a la primera.
 *
 * Defensa en dos pisos:
 *  1. El renombrado se reintenta con esperas crecientes (hasta
 *     ~10 s en total), que es lo que tarda en soltarse un bloqueo
 *     de escaneo.
 *  2. Si ni así, se aparta el archivo viejo a un nombre lateral,
 *     se coloca el nuevo y se borra el apartado. Apartar suele
 *     funcionar donde sustituir no, y si la colocación fallara
 *     se restaura el apartado: nunca se pierde el archivo bueno.
 *
 * Si todo falla, el error que sale dice qué pasa y qué hacer,
 * no un EPERM crudo.
 */

const ESPERAS_MS = [0, 300, 700, 1500, 3000, 5000];
const CODIGOS_BLOQUEO = new Set(["EPERM", "EEXIST", "EACCES", "EBUSY"]);

function esperar(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function renombrarConReintentos(
  origen: string,
  destino: string,
): Promise<void> {
  let ultimoError: unknown = null;
  for (const espera of ESPERAS_MS) {
    if (espera > 0) await esperar(espera);
    try {
      await fs.rename(origen, destino);
      return;
    } catch (error: any) {
      ultimoError = error;
      if (!CODIGOS_BLOQUEO.has(error?.code)) throw error;
    }
  }
  throw ultimoError;
}

/** Escribe `datos` en `destino` de forma atómica y paciente. */
export async function escribirAtomico(
  destino: string,
  datos: Uint8Array | string,
): Promise<void> {
  const temporal = `${destino}.tmp-${process.pid}-${Math.random()
    .toString(36)
    .slice(2, 10)}`;
  await fs.writeFile(temporal, datos);
  try {
    await renombrarConReintentos(temporal, destino);
    return;
  } catch {
    // Al plan B: apartar el viejo y colocar el nuevo.
  }

  const anterior = `${destino}.anterior-${Math.random()
    .toString(36)
    .slice(2, 10)}`;
  try {
    await renombrarConReintentos(destino, anterior);
  } catch {
    await fs.unlink(temporal).catch(() => {});
    throw new Error(
      `No se pudo sustituir ${path.basename(destino)}: el archivo está en uso ` +
        "(¿lo está descargando un agente o lo retiene el antivirus?). " +
        "Espera unos segundos e inténtalo de nuevo.",
    );
  }
  try {
    await renombrarConReintentos(temporal, destino);
  } catch (error) {
    // Restaurar el apartado: mejor el archivo viejo que ninguno.
    await fs.rename(anterior, destino).catch(() => {});
    await fs.unlink(temporal).catch(() => {});
    throw error;
  }
  await fs.unlink(anterior).catch(() => {});
}
