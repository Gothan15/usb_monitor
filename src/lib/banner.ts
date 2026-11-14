/**
 * La portada de la consola al arrancar el panel.
 *
 * Tipografía y marco, sin iconos de relleno: un marco de doble
 * línea, el nombre del sistema en versalitas y las direcciones
 * útiles en filas ordenadas. El marco va en dorado cuando la
 * terminal admite color (la misma dorada de la marca); en una
 * terminal sin color sale el marco limpio, sin códigos raros.
 *
 * El ancho es UNA sola cuenta para todo: bordes y filas salen
 * de ANCHO (antes las filas se calculaban con otra resta y su
 * borde derecho caía dos columnas más allá que el de los
 * bordes: la caja se veía rota por la derecha). Y un valor que
 * no cabe ya no se corta a mitad de palabra: se parte en filas
 * de continuación alineadas con su etiqueta.
 */

const DORADO = "\x1b[33m";
const RESET = "\x1b[0m";
const NEGRITA = "\x1b[1m";

const admiteColor = Boolean(
  process.stdout?.isTTY && process.env.FORCE_COLOR !== "0",
);

/** Ancho total de la caja, bordes incluidos. */
const ANCHO = 68;
/** Espacios entre el borde y el texto, a cada lado. */
const MARGEN = 2;
/** Ancho útil del texto en cada fila: ANCHO − bordes − márgenes. */
const ANCHO_TEXTO = ANCHO - 2 - MARGEN * 2;
/** Columna de las etiquetas («Local», «Orígenes»…), espacios incluidos. */
const ETIQUETA = 11;

function fila(texto: string): string {
  // Red de seguridad: ni con un valor imposible de partir puede
  // una fila pasarse del ancho y romper el borde derecho.
  const limpio =
    texto.length > ANCHO_TEXTO ? texto.slice(0, ANCHO_TEXTO) : texto;
  return `║${" ".repeat(MARGEN)}${limpio.padEnd(ANCHO_TEXTO)}${" ".repeat(MARGEN)}║`;
}

/**
 * Parte un valor en líneas que caben en su columna, por palabras
 * (los orígenes vienen separados por «, » y cada uno queda entero
 * si cabe). Una palabra más larga que la columna va sola en su
 * línea y la corta la red de `fila`.
 */
function partirValor(valor: string, ancho: number): string[] {
  const lineas: string[] = [];
  let actual = "";
  for (const palabra of valor.split(" ")) {
    if (actual === "") {
      actual = palabra;
    } else if ((actual + " " + palabra).length <= ancho) {
      actual += " " + palabra;
    } else {
      lineas.push(actual);
      actual = palabra;
    }
  }
  if (actual !== "" || lineas.length === 0) lineas.push(actual);
  return lineas;
}

/** Las filas de una etiqueta y su valor, con las continuaciones alineadas. */
function filasEtiqueta(etiqueta: string, valor: string): string[] {
  return partirValor(valor, ANCHO_TEXTO - ETIQUETA).map((parte, i) =>
    fila(`${(i === 0 ? etiqueta : "").padEnd(ETIQUETA)}${parte}`),
  );
}

export interface DatosBanner {
  versionNext: string;
  local: string;
  red?: string;
  modo: string;
  socketLocal: string;
  socketRed?: string;
  origenes: string;
  /** Aviso que va DENTRO de la caja, al final (p. ej. sin TLS). */
  aviso?: string;
}

/** Imprime la portada completa, una sola vez al arrancar. */
export function imprimirBannerPanel(datos: DatosBanner): void {
  const marco = "═".repeat(ANCHO - 2);
  const filas = [
    `╔${marco}╗`,
    fila("USBMONITOR · SISTEMA DE MONITOREO USB"),
    fila("Panel de control — servidor en marcha"),
    `╠${marco}╣`,
    ...filasEtiqueta("Local", datos.local),
    ...(datos.red ? filasEtiqueta("Red", datos.red) : []),
    ...filasEtiqueta("Modo", `${datos.modo} · Next.js ${datos.versionNext}`),
    ...filasEtiqueta(
      "Socket",
      datos.socketRed
        ? `${datos.socketLocal} ${datos.socketRed}`
        : datos.socketLocal,
    ),
    ...filasEtiqueta("Orígenes", datos.origenes),
    ...(datos.aviso
      ? [`╠${marco}╣`, ...filasEtiqueta("Aviso", datos.aviso)]
      : []),
    `╚${marco}╝`,
  ];
  const texto = filas.join("\n");
  console.info(
    admiteColor ? `${DORADO}${NEGRITA}${texto}${RESET}` : texto,
  );
}
