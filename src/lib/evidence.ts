/**
 * Captura de evidencia (foto del momento de un bloqueo de un
 * dispositivo no autorizado). Aquí vive la validación del paquete
 * que sube el agente a POST /api/usb-event/evidence, separada de la
 * ruta para poder probarla: el agente es quien captura, pero el
 * panel no se fía de lo que llega — todo campo se acota antes de
 * tocar la base de datos, y la imagen se acepta solo si es JPEG o
 * PNG de verdad y no pasa de 4 MB.
 */

export const MAX_IMAGEN_EVIDENCIA_BYTES = 4 * 1024 * 1024;
const MAX_PROCESOS = 200;
const MAX_PESTANAS = 200;

export interface ProcesoEvidencia {
  proceso: string;
  titulo?: string;
}

export interface PestanaEvidencia {
  navegador: string;
  titulo: string;
  url?: string;
}

export interface DatosEvidencia {
  pendingUnlockId: string;
  serialNumber: string | null;
  capturedAt: Date;
  foregroundProcess: string | null;
  foregroundTitle: string | null;
  processes: ProcesoEvidencia[];
  browserTabs: PestanaEvidencia[];
  tabsComplete: boolean;
  nota: string | null;
  image: Buffer | null;
  imageMime: string | null;
}

export type ResultadoValidacionEvidencia =
  | { ok: true; datos: DatosEvidencia }
  | { ok: false; error: string };

function textoAcotado(valor: unknown, maximo: number): string | null {
  if (typeof valor !== "string") return null;
  const limpio = valor.replace(/[\u0000-\u001f\u007f]/g, "").trim();
  return limpio ? limpio.slice(0, maximo) : null;
}

function listaProcesos(valor: unknown): ProcesoEvidencia[] {
  if (!Array.isArray(valor)) return [];
  const salida: ProcesoEvidencia[] = [];
  for (const item of valor) {
    if (salida.length >= MAX_PROCESOS) break;
    if (!item || typeof item !== "object") continue;
    const registro = item as Record<string, unknown>;
    const proceso = textoAcotado(registro.proceso, 200);
    if (!proceso) continue;
    const titulo = textoAcotado(registro.titulo, 500);
    salida.push(titulo ? { proceso, titulo } : { proceso });
  }
  return salida;
}

function listaPestanas(valor: unknown): PestanaEvidencia[] {
  if (!Array.isArray(valor)) return [];
  const salida: PestanaEvidencia[] = [];
  for (const item of valor) {
    if (salida.length >= MAX_PESTANAS) break;
    if (!item || typeof item !== "object") continue;
    const registro = item as Record<string, unknown>;
    const navegador = textoAcotado(registro.navegador, 100);
    const titulo = textoAcotado(registro.titulo, 500);
    if (!navegador || !titulo) continue;
    const url = textoAcotado(registro.url, 1000);
    salida.push(url ? { navegador, titulo, url } : { navegador, titulo });
  }
  return salida;
}

/** JPEG empieza por FF D8 FF; PNG por 89 50 4E 47. */
function mimeDeImagen(bytes: Buffer): string | null {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return "image/jpeg";
  }
  if (
    bytes.length >= 4 &&
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47
  ) {
    return "image/png";
  }
  return null;
}

/**
 * Valida el cuerpo de POST /api/usb-event/evidence. Devuelve los
 * datos listos para guardar o el motivo del rechazo (400).
 */
export function validarPaqueteEvidencia(
  body: unknown,
): ResultadoValidacionEvidencia {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return { ok: false, error: "Cuerpo de la petición inválido" };
  }
  const datos = body as Record<string, unknown>;

  const pendingUnlockId = textoAcotado(datos.pendingUnlockId, 64);
  if (!pendingUnlockId) {
    return { ok: false, error: "pendingUnlockId requerido" };
  }

  const capturedAt =
    typeof datos.capturedAt === "string" ? new Date(datos.capturedAt) : null;
  if (!capturedAt || Number.isNaN(capturedAt.getTime())) {
    return { ok: false, error: "capturedAt debe ser una fecha ISO válida" };
  }

  let image: Buffer | null = null;
  let imageMime: string | null = null;
  if (datos.imagenBase64 !== undefined && datos.imagenBase64 !== null) {
    if (typeof datos.imagenBase64 !== "string" || !datos.imagenBase64) {
      return { ok: false, error: "imagenBase64 debe ser una cadena base64" };
    }
    // Chequeo barato antes de decodificar: 4 MB de imagen son
    // ~5,6 MB de base64; una cadena más larga ni se decodifica.
    if (datos.imagenBase64.length > Math.ceil(MAX_IMAGEN_EVIDENCIA_BYTES / 3) * 4 + 1024) {
      return { ok: false, error: "La imagen supera el máximo de 4 MB" };
    }
    image = Buffer.from(datos.imagenBase64, "base64");
    if (image.length === 0 || image.length > MAX_IMAGEN_EVIDENCIA_BYTES) {
      return { ok: false, error: "La imagen supera el máximo de 4 MB" };
    }
    imageMime = mimeDeImagen(image);
    if (!imageMime) {
      return { ok: false, error: "La imagen no es JPEG ni PNG" };
    }
  }

  return {
    ok: true,
    datos: {
      pendingUnlockId,
      serialNumber: textoAcotado(datos.serialNumber, 128),
      capturedAt,
      foregroundProcess: textoAcotado(datos.foregroundProcess, 200),
      foregroundTitle: textoAcotado(datos.foregroundTitle, 500),
      processes: listaProcesos(datos.processes),
      browserTabs: listaPestanas(datos.browserTabs),
      tabsComplete: datos.tabsComplete === true,
      nota: textoAcotado(datos.nota, 1000),
      image,
      imageMime,
    },
  };
}
