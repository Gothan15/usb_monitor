// Apariencia del panel: la escala de la letra y el desenfoque
// de los diálogos. Son ajustes guardados del panel (los maneja
// la sección «Interfaz y Navegación» de Ajustes) que se aplican
// sobre el documento: la escala como tamaño de la raíz (todo el
// panel está en rem, así que crece entero y en proporción) y
// el desenfoque como las dos variables que leen el velo y la
// tarjeta de los diálogos. Los valores por defecto viven en
// globals.css (raíz al 112,5 % y desenfoques de siempre), así
// que sin aplicar nada — la pantalla de acceso, por ejemplo —
// el panel ya se ve con esos valores.

/** Límites del ajuste «Tamaño de la letra», en %. */
export const ESCALA_LETRA_MIN = 90;
export const ESCALA_LETRA_MAX = 130;
export const ESCALA_LETRA_DEFECTO = 112.5;

/** Deja una escala dentro de los límites; lo no numérico cae al defecto. */
export function escalaLetraValida(valor: unknown): number {
  const n = Number(valor);
  if (!Number.isFinite(n)) return ESCALA_LETRA_DEFECTO;
  return Math.min(ESCALA_LETRA_MAX, Math.max(ESCALA_LETRA_MIN, n));
}

export interface Apariencia {
  escalaLetra: number;
  desenfoqueDialogos: boolean;
}

/** La apariencia por defecto, la misma que pinta globals.css. */
export const APARIENCIA_DEFECTO: Apariencia = {
  escalaLetra: ESCALA_LETRA_DEFECTO,
  desenfoqueDialogos: true,
};

/**
 * Aplica la apariencia al documento, en vivo: la raíz toma la
 * escala (su estilo en línea pisa el 112,5 % de la hoja) y las
 * variables del desenfoque quedan en su valor o en 0.
 */
export function aplicarApariencia(apariencia: Apariencia): void {
  if (typeof document === "undefined") return;
  const raiz = document.documentElement;
  raiz.style.fontSize = `${escalaLetraValida(apariencia.escalaLetra)}%`;
  raiz.style.setProperty(
    "--desenfoque-velo",
    apariencia.desenfoqueDialogos ? "8px" : "0px",
  );
  raiz.style.setProperty(
    "--desenfoque-tarjeta",
    apariencia.desenfoqueDialogos ? "24px" : "0px",
  );
}
