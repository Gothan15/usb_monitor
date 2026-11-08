/**
 * La portada de la consola al arrancar el panel.
 *
 * Tipografía y marco, sin iconos de relleno: un marco de doble
 * línea, el nombre del sistema en versalitas y las direcciones
 * útiles en filas ordenadas. El marco va en dorado cuando la
 * terminal admite color (la misma dorada de la marca); en una
 * terminal sin color sale el marco limpio, sin códigos raros.
 */

const DORADO = "\x1b[33m";
const RESET = "\x1b[0m";
const NEGRITA = "\x1b[1m";

const admiteColor = Boolean(
  process.stdout?.isTTY && process.env.FORCE_COLOR !== "0",
);

const ANCHO = 66;

function fila(texto: string): string {
  const limpio = texto.length > ANCHO - 4 ? texto.slice(0, ANCHO - 4) : texto;
  return `║  ${limpio.padEnd(ANCHO - 4)}  ║`;
}

export interface DatosBanner {
  versionNext: string;
  local: string;
  red?: string;
  modo: string;
  socketLocal: string;
  socketRed?: string;
  origenes: string;
}

/** Imprime la portada completa, una sola vez al arrancar. */
export function imprimirBannerPanel(datos: DatosBanner): void {
  const marco = "═".repeat(ANCHO - 2);
  const filas = [
    `╔${marco}╗`,
    fila("USBMONITOR · SISTEMA DE MONITOREO USB"),
    fila("Panel de control — servidor en marcha"),
    `╠${marco}╣`,
    fila(`Local      ${datos.local}`),
    ...(datos.red ? [fila(`Red        ${datos.red}`)] : []),
    fila(`Modo       ${datos.modo} · Next.js ${datos.versionNext}`),
    fila(`Socket     ${datos.socketLocal}`),
    ...(datos.socketRed ? [fila(`           ${datos.socketRed}`)] : []),
    fila(`Orígenes   ${datos.origenes}`),
    `╚${marco}╝`,
  ];
  const texto = filas.join("\n");
  console.info(
    admiteColor ? `${DORADO}${NEGRITA}${texto}${RESET}` : texto,
  );
}
