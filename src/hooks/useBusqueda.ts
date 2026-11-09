"use client";

import { useDeferredValue, useMemo } from "react";

import {
  normalizarConsulta,
  textosBuscables,
  textosCoinciden,
} from "@/lib/busqueda";

/**
 * Filtra en cliente una lista por texto (Equipos, Lista blanca)
 * sin rehacer el trabajo caro en cada pulsación.
 *
 * Antes, cada pestaña repetía el mismo patrón: en cada tecla se
 * volvía a pasar `toLowerCase()` por TODOS los campos de TODOS
 * los registros. Aquí, en cambio:
 *
 * - Los textos normalizados de cada registro se calculan UNA
 *   vez por dataset (el índice) y se reutilizan entre teclas.
 *   Por eso `campos` debe ser una constante estable (los
 *   llamantes la definen a nivel de módulo): si cambiara en
 *   cada render, el índice se recalcularía igual.
 * - La aguja se normaliza una sola vez por cambio.
 * - La consulta pasa por `useDeferredValue`: la pulsación nunca
 *   espera al filtrado, que se aplica un instante después (el
 *   mismo patrón que ya usa la búsqueda de Usuarios contra el
 *   servidor).
 *
 * La semántica es la de `filtrarRegistros` (ver src/lib/busqueda):
 * subcadena sobre los campos dados, sin distinguir mayúsculas
 * ni acentos; consulta vacía → la lista entera.
 */
export function useBusqueda<T>(
  registros: T[],
  consulta: string,
  campos: readonly (keyof T)[],
): T[] {
  const consultaDiferida = useDeferredValue(consulta);

  const aguja = useMemo(
    () => normalizarConsulta(consultaDiferida),
    [consultaDiferida],
  );

  const indice = useMemo(
    () => registros.map((registro) => textosBuscables(registro, campos)),
    [registros, campos],
  );

  return useMemo(() => {
    if (!aguja) return registros;
    return registros.filter((_, i) => textosCoinciden(indice[i], aguja));
  }, [registros, indice, aguja]);
}
