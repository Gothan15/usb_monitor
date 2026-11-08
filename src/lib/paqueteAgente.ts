import { createHash } from "crypto";

import { versionPeDesdeArchivo } from "@/lib/peVersion";
import { promises as fs, createReadStream } from "fs";
import path from "path";

/**
 * Paquete de actualización del agente que sirve el propio panel.
 *
 * El exe vigente se deja a mano en la carpeta del paquete (por
 * defecto `paquete-agente/` junto al panel; otra ruta con la
 * variable AGENT_PACKAGE_DIR) junto a un `manifiesto.json` opcional
 * con { "version": "1.0.4" }. El panel calcula el SHA-256 del exe y
 * lo sirve en el manifiesto: el agente descarga, verifica el hash
 * antes de tocar nada y solo entonces se sustituye.
 *
 * Servirlo desde el panel evita depender de GitHub desde la LAN del
 * cliente: la Release sigue siendo el origen, la carpeta es la copia
 * local que se deja al actualizar el panel.
 */

export const NOMBRE_EXE_PAQUETE = "USBMonitorService.exe";

export function carpetaPaquete(): string {
  return (
    process.env.AGENT_PACKAGE_DIR ||
    path.join(process.cwd(), "paquete-agente")
  );
}

export function rutaExePaquete(): string {
  return path.join(carpetaPaquete(), NOMBRE_EXE_PAQUETE);
}

export interface ManifiestoPaquete {
  version: string | null;
  sha256: string;
  tamano: number;
  nombreArchivo: string;
}

let cache: {
  clave: string;
  manifiesto: ManifiestoPaquete;
} | null = null;

function sha256DeArchivo(ruta: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = createHash("sha256");
    const flujo = createReadStream(ruta);
    flujo.on("data", (trozo) => hash.update(trozo));
    flujo.on("end", () => resolve(hash.digest("hex")));
    flujo.on("error", reject);
  });
}

/**
 * Manifiesto del paquete presente, o null si no hay exe en la
 * carpeta. El hash se cachea por tamaño+fecha del archivo: un exe
 * de ~140 MB no se relee en cada llamada, pero sustituirlo
 * invalida la caché en la siguiente consulta.
 */
export async function manifiestoPaquete(): Promise<ManifiestoPaquete | null> {
  const ruta = rutaExePaquete();
  let stat;
  try {
    stat = await fs.stat(ruta);
  } catch {
    return null;
  }
  if (!stat.isFile() || stat.size === 0) return null;

  const clave = `${ruta}|${stat.size}|${stat.mtimeMs}`;
  if (cache && cache.clave === clave) return cache.manifiesto;

  let version: string | null = null;
  try {
    const crudo = await fs.readFile(
      path.join(carpetaPaquete(), "manifiesto.json"),
      "utf-8",
    );
    const parsed = JSON.parse(crudo);
    if (typeof parsed?.version === "string" && parsed.version.trim()) {
      version = parsed.version.trim().slice(0, 32);
    }
  } catch {
    // Sin manifiesto.json se sigue con la reserva del PE.
  }
  if (!version) {
    // Reserva: la versión que el propio exe declara en su PE.
    // Cubre los paquetes colocados a mano sin manifiesto: el
    // panel ya no depende de que nadie escriba la versión.
    version = await versionPeDesdeArchivo(ruta);
  }

  const manifiesto: ManifiestoPaquete = {
    version,
    sha256: await sha256DeArchivo(ruta),
    tamano: stat.size,
    nombreArchivo: NOMBRE_EXE_PAQUETE,
  };
  cache = { clave, manifiesto };
  return manifiesto;
}
