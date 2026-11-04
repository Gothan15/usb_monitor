/**
 * Versiones del agente: comparación sencilla de versiones
 * «1.0.4» para saber si un equipo va por detrás del paquete
 * que sirve el panel. Sin dependencias y tolerante: ignora una
 * «v» inicial y trata lo no numérico como 0.
 */

function partesDe(version: string): number[] {
  return version
    .trim()
    .replace(/^v/i, "")
    .split(".")
    .map((parte) => {
      const numero = Number.parseInt(parte, 10);
      return Number.isFinite(numero) && numero > 0 ? numero : 0;
    });
}

/** -1 si a < b, 0 si son la misma, 1 si a > b. */
export function compararVersiones(a: string, b: string): number {
  const pa = partesDe(a);
  const pb = partesDe(b);
  const largo = Math.max(pa.length, pb.length);
  for (let i = 0; i < largo; i++) {
    const diferencia = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (diferencia !== 0) return diferencia < 0 ? -1 : 1;
  }
  return 0;
}

/**
 * ¿Necesita actualizarse? Solo si se conocen las dos
 * versiones y la del equipo es menor que la del paquete: un
 * agente más nuevo que el paquete no está desactualizado, y
 * sin versión conocida no se afirma nada.
 */
export function necesitaActualizacion(
  versionEquipo: string | null | undefined,
  versionPaquete: string | null | undefined,
): boolean {
  if (!versionEquipo || !versionPaquete) return false;
  return compararVersiones(versionEquipo, versionPaquete) < 0;
}
