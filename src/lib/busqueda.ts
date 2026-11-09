/**
 * Lógica pura de la búsqueda de texto del panel (sin React).
 *
 * Vive separada del hook `useBusqueda` para poder probarla sin
 * montar componentes: la normalización y la coincidencia son el
 * contrato que comparten las pestañas que filtran en cliente
 * (Equipos y Lista blanca).
 *
 * La coincidencia es por SUBCADENA sobre los campos indicados,
 * insensible a mayúsculas y a acentos: en español se escribe
 * muchas veces sin acentuar («camara» por «cámara») y la búsqueda
 * tiene que encontrar el registro igualmente. La consulta con
 * acentos también funciona: ambos lados pasan por la misma
 * normalización.
 */

/**
 * Normaliza un texto para comparar: descompone los caracteres
 * acentuados (NFD), quita las marcas diacríticas y pasa a
 * minúsculas. «Cámara Ñandú» → «camara nandu».
 */
export function normalizarTexto(texto: string): string {
  return texto
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase();
}

/**
 * Normaliza la consulta del usuario: además de lo anterior,
 * recorta los espacios de los extremos (una búsqueda de solo
 * espacios equivale a no buscar).
 */
export function normalizarConsulta(consulta: string): string {
  return normalizarTexto(consulta.trim());
}

/**
 * Los textos buscables de un registro: el valor normalizado de
 * cada campo indicado. Los campos que no sean texto (nulos,
 * números…) aportan cadena vacía y nunca coinciden.
 */
export function textosBuscables<T>(
  registro: T,
  campos: readonly (keyof T)[],
): string[] {
  return campos.map((campo) => {
    const valor = registro[campo];
    return normalizarTexto(typeof valor === "string" ? valor : "");
  });
}

/**
 * ¿Coincide el registro con la aguja ya normalizada? Con la
 * aguja vacía coincide todo (es el estado «sin búsqueda»).
 */
export function textosCoinciden(
  textos: readonly string[],
  aguja: string,
): boolean {
  if (!aguja) return true;
  return textos.some((texto) => texto.includes(aguja));
}

/**
 * Filtra una lista por texto en una sola pasada. Es la versión
 * sin memoria del mismo algoritmo que usa `useBusqueda`; el hook
 * añade el índice memoizado y el valor diferido.
 */
export function filtrarRegistros<T>(
  registros: readonly T[],
  consulta: string,
  campos: readonly (keyof T)[],
): T[] {
  const aguja = normalizarConsulta(consulta);
  if (!aguja) return [...registros];
  return registros.filter((registro) =>
    textosCoinciden(textosBuscables(registro, campos), aguja),
  );
}
