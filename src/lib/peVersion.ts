import { promises as fs } from "fs";

/**
 * Versión de un ejecutable de Windows leída de su propio PE.
 *
 * Hasta ahora la versión del paquete del agente salía del nombre
 * del zip de la Release («...-agente-v1.0.19.zip») o de un campo
 * escrito a mano: dos sitios donde equivocarse y que el panel
 * creyera que servía una versión que no era. La verdad está
 * dentro del exe: al compilar, la versión queda estampada en el
 * recurso VERSIONINFO del PE (ProductVersion / FileVersion), y
 * este lector la extrae sin ejecutar nada.
 *
 * Qué hace: localiza la sección `.rsrc`, camina el directorio de
 * recursos hasta la entrada RT_VERSION y lee las cadenas de su
 * StringFileInfo. Si no hay cadenas, cae a los números del
 * VS_FIXEDFILEINFO. Normaliza a «X.Y.Z» (el PE suele traer un
 * cuarto número, «1.0.19.0») y descarta sufijos («1.0.19+hash»).
 */

const RT_VERSION = 16;

function normalizarVersion(cruda: string | null): string | null {
  if (!cruda) return null;
  const limpia = cruda.split("+")[0].trim();
  const m = limpia.match(/^(\d+)\.(\d+)\.(\d+)(?:\.\d+)?$/);
  return m ? `${m[1]}.${m[2]}.${m[3]}` : null;
}

/** Alineación de 4 bytes que usa VERSIONINFO, relativa al bloque. */
function alinear4(n: number): number {
  return (n + 3) & ~3;
}

/**
 * Lee las cadenas de un bloque VS_VERSIONINFO (ProductVersion y
 * FileVersion) recorriendo StringFileInfo → StringTable → String.
 */
function cadenasDeVersionInfo(bloque: Buffer): Map<string, string> {
  const cadenas = new Map<string, string>();
  const leerClave = (o: number): { clave: string; siguiente: number } => {
    let fin = o;
    while (fin + 1 < bloque.length && bloque.readUInt16LE(fin) !== 0) fin += 2;
    return { clave: bloque.toString("utf16le", o, fin), siguiente: fin + 2 };
  };
  // Recorrido recursivo: raíz (0) → StringFileInfo (1) →
  // StringTable (2) → String (3, hoja con el valor). Cada nodo:
  // longitud, longitud del valor, tipo, clave UTF-16 con nulo,
  // relleno a 4 bytes, valor e hijos hasta agotar su longitud.
  // Todas las alineaciones son relativas al inicio del bloque.
  const procesar = (inicio: number, profundidad: number): void => {
    if (inicio + 6 > bloque.length) return;
    const longitud = bloque.readUInt16LE(inicio);
    if (longitud < 6) return;
    const longitudValor = bloque.readUInt16LE(inicio + 2);
    const { clave, siguiente } = leerClave(inicio + 6);
    const offsetValor = alinear4(siguiente);
    const finNodo = Math.min(inicio + longitud, bloque.length);
    if (profundidad === 3) {
      if (longitudValor > 0 && offsetValor < finNodo) {
        const bytes = Math.min(longitudValor * 2, finNodo - offsetValor);
        cadenas.set(
          clave,
          bloque
            .toString("utf16le", offsetValor, offsetValor + bytes)
            .replace(/\0+$/, ""),
        );
      }
      return;
    }
    // Valor propio antes de los hijos: solo la raíz lo tiene (el
    // VS_FIXEDFILEINFO, 52 bytes; su wValueLength va en bytes).
    // En StringFileInfo y StringTable vale cero.
    const tamValor = profundidad === 0 ? longitudValor : 0;
    let hijo = alinear4(offsetValor + tamValor);
    while (hijo + 6 <= finNodo) {
      const lonHijo = bloque.readUInt16LE(hijo);
      if (lonHijo < 6) break;
      procesar(hijo, profundidad + 1);
      hijo += alinear4(lonHijo);
    }
  };
  procesar(0, 0);
  return cadenas;
}

/** Versión desde el VS_FIXEDFILEINFO (dwFileVersionMS/LS). */
function versionFijaDeVersionInfo(bloque: Buffer): string | null {
  // La firma 0xFEEF04BD aparece a 40 bytes del inicio en la
  // práctica; se busca en los primeros 64 bytes por seguridad.
  for (let o = 0; o + 4 <= Math.min(64, bloque.length); o += 4) {
    if (bloque.readUInt32LE(o) === 0xfeef04bd) {
      const ms = bloque.readUInt32LE(o + 4);
      const ls = bloque.readUInt32LE(o + 8);
      return `${ms >>> 16}.${ms & 0xffff}.${ls >>> 16}`;
    }
  }
  return null;
}

/**
 * Extrae el bloque VS_VERSIONINFO de un PE completo en memoria.
 * Devuelve null si el archivo no es un PE o no trae versión.
 */
export function versionPeDesdeBuffer(pe: Buffer): string | null {
  try {
    if (pe.length < 0x40 || pe.toString("latin1", 0, 2) !== "MZ") return null;
    const peOff = pe.readUInt32LE(0x3c);
    if (pe.toString("latin1", peOff, peOff + 4) !== "PE\0\0") return null;
    const numSecciones = pe.readUInt16LE(peOff + 6);
    const tamOpcional = pe.readUInt16LE(peOff + 20);
    const seccionesOff = peOff + 24 + tamOpcional;

    let rsrc: { va: number; raw: number; rawTam: number } | null = null;
    for (let i = 0; i < numSecciones; i++) {
      const o = seccionesOff + i * 40;
      const nombre = pe.toString("latin1", o, o + 8).replace(/\0.*$/, "");
      if (nombre === ".rsrc") {
        rsrc = {
          va: pe.readUInt32LE(o + 12),
          raw: pe.readUInt32LE(o + 20),
          rawTam: pe.readUInt32LE(o + 16),
        };
        break;
      }
    }
    if (!rsrc) return null;
    const { va, raw } = rsrc;
    const rvaAOffset = (rva: number) => raw + (rva - va);

    // Directorio de recursos: nivel raíz → tipo (RT_VERSION) →
    // nombre → idioma → entrada de datos.
    const buscarDatos = (dirOff: number, nivel: number): number | null => {
      const total = pe.readUInt16LE(dirOff + 12) + pe.readUInt16LE(dirOff + 14);
      for (let i = 0; i < total; i++) {
        const e = dirOff + 16 + i * 8;
        const id = pe.readUInt32LE(e);
        const destino = pe.readUInt32LE(e + 4);
        if (nivel === 0 && id !== RT_VERSION) continue;
        if (destino & 0x80000000) {
          const sub = buscarDatos(rvaAOffset(va + (destino & 0x7fffffff)), nivel + 1);
          if (sub !== null) return sub;
        } else {
          // Hoja: offset de la entrada de datos (RVA + tamaño).
          return rvaAOffset(va + destino);
        }
      }
      return null;
    };
    const datosOff = buscarDatos(raw, 0);
    if (datosOff === null) return null;
    // La entrada de datos: RVA y tamaño del bloque de versión.
    // (buscarDatos devolvió el offset de la entrada; se relee.)
    const entradaOff = datosOff;
    const bloqueOff = rvaAOffset(pe.readUInt32LE(entradaOff));
    const bloqueTam = pe.readUInt32LE(entradaOff + 4);
    if (bloqueOff < 0 || bloqueOff + bloqueTam > pe.length) return null;
    const bloque = pe.subarray(bloqueOff, bloqueOff + bloqueTam);

    const cadenas = cadenasDeVersionInfo(bloque);
    return (
      normalizarVersion(cadenas.get("ProductVersion") ?? null) ??
      normalizarVersion(cadenas.get("FileVersion") ?? null) ??
      normalizarVersion(versionFijaDeVersionInfo(bloque))
    );
  } catch {
    return null;
  }
}

/**
 * Igual, pero leyendo del disco solo lo necesario: las cabeceras
 * y la sección `.rsrc` (el exe del agente pesa ~90 MB y su
 * manifiesto se consulta a menudo; la caché de arriba evita
 * repetir ni siquiera esto).
 */
export async function versionPeDesdeArchivo(ruta: string): Promise<string | null> {
  let archivo: fs.FileHandle | null = null;
  try {
    archivo = await fs.open(ruta, "r");
    const cabecera = Buffer.alloc(64 * 1024);
    const leidos = await archivo.read(cabecera, 0, cabecera.length, 0);
    const cab = cabecera.subarray(0, leidos.bytesRead);
    if (cab.length < 0x40 || cab.toString("latin1", 0, 2) !== "MZ") return null;
    const peOff = cab.readUInt32LE(0x3c);
    const numSecciones = cab.readUInt16LE(peOff + 6);
    const tamOpcional = cab.readUInt16LE(peOff + 20);
    const seccionesOff = peOff + 24 + tamOpcional;
    let raw = -1;
    let rawTam = 0;
    for (let i = 0; i < numSecciones; i++) {
      const o = seccionesOff + i * 40;
      const nombre = cab.toString("latin1", o, o + 8).replace(/\0.*$/, "");
      if (nombre === ".rsrc") {
        rawTam = cab.readUInt32LE(o + 16);
        raw = cab.readUInt32LE(o + 20);
        break;
      }
    }
    if (raw < 0 || rawTam === 0 || rawTam > 32 * 1024 * 1024) return null;
    // Buffer sintético con las cabeceras en su sitio y la sección
    // .rsrc en su offset bruto: el parser de memoria trabaja
    // sobre offsets de archivo, así que basta componer esto.
    const compuesto = Buffer.alloc(raw + rawTam);
    cab.copy(compuesto, 0);
    await archivo.read(compuesto, raw, rawTam, raw);
    return versionPeDesdeBuffer(compuesto);
  } catch {
    return null;
  } finally {
    await archivo?.close().catch(() => {});
  }
}
