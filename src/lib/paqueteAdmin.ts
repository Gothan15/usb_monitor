import { promises as fs } from "fs";
import path from "path";
import { unzipSync } from "fflate";

import {
  NOMBRE_EXE_PAQUETE,
  carpetaPaquete,
  manifiestoPaquete,
} from "@/lib/paqueteAgente";
import { rutaEmpujador } from "@/lib/empujador";
import { versionPeDesdeBuffer } from "@/lib/peVersion";
import { escribirAtomico } from "@/lib/escribirAtomico";

/**
 * Gestión del paquete del agente desde Ajustes.
 *
 * Hasta ahora el administrador colocaba a mano el ejecutable del
 * agente en `paquete-agente/` (con su manifiesto.json) y el
 * empujador en `empujador/`. Con esta pieza sube el zip de la
 * Release del agente (desde la v1.0.11 trae los dos ejecutables)
 * y el panel lo descomprime y deja cada pieza en su sitio, lista
 * para el canal de actualización y para las tareas de
 * instalación en remoto. Leer y servir el paquete sigue siendo
 * cosa de `paqueteAgente.ts`; aquí solo se coloca.
 */

export const NOMBRE_EXE_EMPUJADOR = "USBMonitorEmpujador.exe";

/** Tope del zip subido: la Release vigente pesa ~95 MB. */
export const LIMITE_PAQUETE_BYTES = 250 * 1024 * 1024;

/** El zip no es válido o no trae lo imprescindible: es un 400. */
export class ErrorPaqueteInvalido extends Error {}

export interface EstadoPaqueteAgente {
  version: string | null;
  sha256: string | null;
  agente: { presente: boolean; tamano: number };
  empujador: { presente: boolean; tamano: number };
}

async function tamanoSiExiste(ruta: string): Promise<number> {
  try {
    const info = await fs.stat(ruta);
    return info.isFile() ? info.size : 0;
  } catch {
    return 0;
  }
}

/**
 * Estado del paquete colocado: versión y huella del manifiesto
 * que sirve `paqueteAgente` (su caché se invalida sola al cambiar
 * el exe) y presencia del empujador en su carpeta.
 */
export async function estadoPaqueteAgente(): Promise<EstadoPaqueteAgente> {
  const manifiesto = await manifiestoPaquete();
  const tamanoEmpujador = await tamanoSiExiste(rutaEmpujador());
  return {
    version: manifiesto?.version ?? null,
    sha256: manifiesto?.sha256 ?? null,
    agente: {
      presente: manifiesto !== null,
      tamano: manifiesto?.tamano ?? 0,
    },
    empujador: {
      presente: tamanoEmpujador > 0,
      tamano: tamanoEmpujador,
    },
  };
}

/**
 * Versión deducida del nombre del zip de la Release
 * («USBMonitorService-agente-v1.0.11.zip» → «1.0.11»); null si el
 * nombre no lleva tres números con pinta de versión.
 */
export function versionDesdeNombre(nombreArchivo: string): string | null {
  const nombre = path.basename(nombreArchivo || "");
  const conV = nombre.match(/v(\d+)\.(\d+)\.(\d+)/i);
  if (conV) return `${conV[1]}.${conV[2]}.${conV[3]}`;
  const sinV = nombre.match(/(\d+)\.(\d+)\.(\d+)/);
  if (sinV) return `${sinV[1]}.${sinV[2]}.${sinV[3]}`;
  return null;
}

/**
 * La versión del agente DENTRO del zip subido, leída del recurso
 * VERSIONINFO del propio ejecutable: es la fuente que manda desde
 * ahora (el nombre del zip y el campo manual quedan de reserva).
 * Null si el zip no se puede leer o el exe no declara versión.
 */
export function versionPeDesdeZip(zipBytes: Uint8Array): string | null {
  try {
    const entradas = unzipSync(zipBytes);
    const elegidas = elegirEntradas(Object.keys(entradas));
    if (!elegidas.agente) return null;
    return versionPeDesdeBuffer(Buffer.from(entradas[elegidas.agente]));
  } catch {
    return null;
  }
}

/**
 * Normaliza una versión escrita a mano: solo vale «X.Y.Z»
 * (recortada, máximo 32 caracteres, como el resto del sistema).
 * Devuelve la versión limpia o null.
 */
export function validarVersion(valor: unknown): string | null {
  if (typeof valor !== "string") return null;
  const limpia = valor.trim().slice(0, 32);
  return /^\d+\.\d+\.\d+$/.test(limpia) ? limpia : null;
}

export interface EntradasPaquete {
  /** Clave de la entrada del ejecutable del agente, o null. */
  agente: string | null;
  /** Clave de la entrada del empujador, o null si no viene. */
  empujador: string | null;
}

/**
 * Elige qué entradas del zip son el agente y el empujador,
 * comparando por nombre base (las Releases los traen en la raíz,
 * pero una entrada en subcarpeta vale igual). El agente es
 * obligatorio; el empujador, opcional (los zips anteriores a la
 * v1.0.11 no lo traen). El resto de entradas se ignora.
 */
export function elegirEntradas(nombres: string[]): EntradasPaquete {
  let agente: string | null = null;
  let empujador: string | null = null;
  for (const nombre of nombres) {
    if (nombre.endsWith("/")) continue;
    const base = path.basename(nombre).toLowerCase();
    if (base === NOMBRE_EXE_PAQUETE.toLowerCase() && agente === null) {
      agente = nombre;
    } else if (
      base === NOMBRE_EXE_EMPUJADOR.toLowerCase() &&
      empujador === null
    ) {
      empujador = nombre;
    }
  }
  return { agente, empujador };
}

export interface RaicesPaquete {
  /** Carpeta del paquete del agente (la de `carpetaPaquete()`). */
  carpetaPaquete?: string;
  /** Ruta completa del empujador (la de `rutaEmpujador()`). */
  rutaEmpujador?: string;
}

export interface ResultadoColocacion {
  estado: EstadoPaqueteAgente;
  avisos: string[];
}

/**
 * Descomprime el zip subido y coloca cada ejecutable en su
 * carpeta, escribiendo el manifiesto con la versión dada. Las
 * raíces se pueden inyectar para probar sin tocar las carpetas
 * de verdad. Lanza `ErrorPaqueteInvalido` si el contenido no es
 * un zip o si no trae el ejecutable del agente.
 */
export async function colocarPaquete(
  zipBytes: Uint8Array,
  version: string,
  raices: RaicesPaquete = {},
): Promise<ResultadoColocacion> {
  const carpeta = raices.carpetaPaquete ?? carpetaPaquete();
  const destinoEmpujador = raices.rutaEmpujador ?? rutaEmpujador();
  const conRaicesPropias =
    raices.carpetaPaquete !== undefined || raices.rutaEmpujador !== undefined;

  let entradas: ReturnType<typeof unzipSync>;
  try {
    entradas = unzipSync(zipBytes);
  } catch {
    throw new ErrorPaqueteInvalido(
      "El archivo no es un zip válido: sube el zip de la Release del agente tal como se descarga.",
    );
  }

  const elegidas = elegirEntradas(Object.keys(entradas));
  if (!elegidas.agente) {
    throw new ErrorPaqueteInvalido(
      `El zip no trae ${NOMBRE_EXE_PAQUETE}: no es el zip de la Release del agente.`,
    );
  }

  const avisos: string[] = [];
  await fs.mkdir(carpeta, { recursive: true });
  await fs.mkdir(path.dirname(destinoEmpujador), { recursive: true });

  await escribirAtomico(
    path.join(carpeta, NOMBRE_EXE_PAQUETE),
    entradas[elegidas.agente],
  );

  if (elegidas.empujador) {
    await escribirAtomico(destinoEmpujador, entradas[elegidas.empujador]);
  } else {
    avisos.push(
      "El zip no traía el empujador: la carpeta del empujador queda como estaba. Para las instalaciones en remoto hace falta un zip que lo traiga (desde la v1.0.11).",
    );
  }

  const manifiesto = JSON.stringify({ version }, null, 2) + "\n";
  await escribirAtomico(
    path.join(carpeta, "manifiesto.json"),
    new TextEncoder().encode(manifiesto),
  );

  // Con las raíces de verdad, el estado sale del manifiesto que
  // sirve el panel (huella incluida); con raíces inyectadas se
  // compone de lo que acaba de quedar en disco.
  const estado: EstadoPaqueteAgente = conRaicesPropias
    ? {
        version,
        sha256: null,
        agente: {
          presente: true,
          tamano: await tamanoSiExiste(path.join(carpeta, NOMBRE_EXE_PAQUETE)),
        },
        empujador: {
          presente: (await tamanoSiExiste(destinoEmpujador)) > 0,
          tamano: await tamanoSiExiste(destinoEmpujador),
        },
      }
    : await estadoPaqueteAgente();

  return { estado, avisos };
}
