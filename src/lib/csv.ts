/**
 * CSV para exportar desde el panel (Eventos, Desbloqueos).
 *
 * Pensado para abrirse en Excel en español: separador «;» y
 * marca BOM al principio, para que las tildes se lean bien.
 * Una celda se entrecomilla si lleva el separador, comillas o
 * saltos de línea, y las comillas internas se doblan.
 */
export function celdaCsv(valor: unknown): string {
  const texto =
    valor === null || valor === undefined ? "" : String(valor);
  return /[";\n\r]/.test(texto)
    ? `"${texto.replace(/"/g, '""')}"`
    : texto;
}

/** Filas (objetos por nombre de columna) → texto CSV completo. */
export function aCsv(
  columnas: string[],
  filas: Array<Record<string, unknown>>,
): string {
  const lineas = [columnas.map(celdaCsv).join(";")];
  for (const fila of filas) {
    lineas.push(columnas.map((c) => celdaCsv(fila[c])).join(";"));
  }
  return "\uFEFF" + lineas.join("\r\n") + "\r\n";
}

/**
 * Rango de fechas de una exportación: lo que pidan los
 * parámetros «desde»/«hasta» (ISO) o, sin ellos, los últimos
 * 30 días. Un «hasta» sin hora se entiende al final de su día.
 * Devuelve null si alguna fecha no se entiende.
 */
export function rangoExportacion(
  desdeParam: string | null,
  hastaParam: string | null,
  ahora = new Date(),
): { desde: Date; hasta: Date } | null {
  const desde = desdeParam
    ? new Date(desdeParam)
    : new Date(ahora.getTime() - 30 * 24 * 60 * 60 * 1000);
  let hasta = hastaParam ? new Date(hastaParam) : ahora;
  if (Number.isNaN(desde.getTime()) || Number.isNaN(hasta.getTime())) {
    return null;
  }
  if (hastaParam && /^\d{4}-\d{2}-\d{2}$/.test(hastaParam)) {
    hasta = new Date(hasta.getTime() + 24 * 60 * 60 * 1000 - 1);
  }
  return { desde, hasta };
}
