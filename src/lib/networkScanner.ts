import os from "os";
import { execFile } from "child_process";
import { promises as fs } from "fs";
import dgram from "dgram";
import net from "net";
import util from "util";
import { db } from "@/lib/db";
import { resolverEquipoParaAgente } from "@/lib/identidadEquipo";
import { checkServiceHealth } from "@/lib/serviceNotifier";
import { getCurrentDate, getCurrentTimestamp } from "@/lib/time";
import { normalizeComputerName } from "@/lib/utils";

const execFileAsync = util.promisify(execFile);

// ════════════════════════════════════════════════════════════════
// Interfaces de red del equipo donde corre el panel
// ════════════════════════════════════════════════════════════════

export interface NetworkInterfaceInfo {
  name: string;
  address: string;
  cidr: string;
  mac: string;
  netmask: string;
  /** Heuristic type based on interface name */
  type: "wifi" | "ethernet" | "vpn" | "other";
}

function guessInterfaceType(name: string): NetworkInterfaceInfo["type"] {
  const lower = name.toLowerCase();
  if (lower.includes("wi-fi") || lower.includes("wifi") || lower.includes("wlan") || lower.includes("wireless")) return "wifi";
  if (lower.includes("ethernet") || lower.includes("eth") || lower.includes("local area")) return "ethernet";
  if (lower.includes("vpn") || lower.includes("tun") || lower.includes("tap") || lower.includes("wg")) return "vpn";
  return "other";
}

/**
 * Adaptadores virtuales (VMware, VirtualBox, Hyper-V, Docker/WSL…):
 * suelen traer subredes enormes o ajenas a la LAN real. No se
 * descartan —pueden ser la única red—, pero quedan los últimos al
 * elegir interfaz automáticamente.
 */
function nombrePareceVirtual(name: string): boolean {
  const lower = name.toLowerCase();
  return (
    lower.includes("vmware") ||
    lower.includes("virtualbox") ||
    lower.includes("virtual") ||
    lower.includes("hyper-v") ||
    lower.includes("vethernet") ||
    lower.includes("docker") ||
    lower.includes("wsl") ||
    lower.includes("loopback") ||
    lower.includes("npcap")
  );
}

const RANGO_TIPO_INTERFAZ: Record<NetworkInterfaceInfo["type"], number> = {
  ethernet: 0,
  wifi: 1,
  other: 2,
  vpn: 3,
};

/**
 * Orden de preferencia al elegir interfaz sin que el usuario diga
 * cuál: primero la Ethernet/Wi-Fi física, después el resto y al
 * final VPN y adaptadores virtuales. Orden estable: a igual rango
 * se conserva el orden del sistema.
 */
export function ordenarRedesPorPreferencia(
  redes: NetworkInterfaceInfo[]
): NetworkInterfaceInfo[] {
  return redes
    .map((red, indice) => ({ red, indice }))
    .sort((a, b) => {
      const rangoA =
        (nombrePareceVirtual(a.red.name) ? 10 : 0) +
        RANGO_TIPO_INTERFAZ[a.red.type];
      const rangoB =
        (nombrePareceVirtual(b.red.name) ? 10 : 0) +
        RANGO_TIPO_INTERFAZ[b.red.type];
      return rangoA - rangoB || a.indice - b.indice;
    })
    .map(({ red }) => red);
}

function cidrFromAddressNetmask(address: string, netmask: string): string {
  const ones = netmask
    .split(".")
    .map((o) => (Number(o) >>> 0).toString(2))
    .join("")
    .split("")
    .filter((c) => c === "1").length;
  return `${address}/${ones || 24}`;
}

export function getAllLocalNetworks(): NetworkInterfaceInfo[] {
  const ifaces = os.networkInterfaces();
  const results: NetworkInterfaceInfo[] = [];
  for (const [name, entries] of Object.entries(ifaces)) {
    if (!entries) continue;
    for (const net of entries) {
      if (net.family !== "IPv4" || net.internal) continue;
      // Skip link-local addresses (169.254.x.x)
      if (net.address.startsWith("169.254.")) continue;
      results.push({
        name,
        address: net.address,
        // La CIDR real de la interfaz (Node la expone); antes se asumía
        // /24 siempre, también en redes /16 o /23.
        cidr: net.cidr || cidrFromAddressNetmask(net.address, net.netmask || "255.255.255.0"),
        mac: net.mac || "",
        netmask: net.netmask || "255.255.255.0",
        type: guessInterfaceType(name),
      });
    }
  }
  // La lista sale ordenada por preferencia: quien tome la primera
  // (red automática, selector de interfaces) coge la interfaz real
  // y no un adaptador virtual con una subred enorme.
  return ordenarRedesPorPreferencia(results);
}

// ════════════════════════════════════════════════════════════════
// Utilidades IPv4
// ════════════════════════════════════════════════════════════════

export function ipANumero(ip: string): number {
  const octetos = ip.split(".").map(Number);
  if (
    octetos.length !== 4 ||
    octetos.some((o) => Number.isNaN(o) || o < 0 || o > 255)
  ) {
    return NaN;
  }
  return (
    ((octetos[0] << 24) >>> 0) + (octetos[1] << 16) + (octetos[2] << 8) + octetos[3]
  );
}

export function numeroAIp(n: number): string {
  return `${(n >>> 24) & 255}.${(n >>> 16) & 255}.${(n >>> 8) & 255}.${n & 255}`;
}

function esMulticast(ip: string): boolean {
  const primero = Number(ip.split(".")[0]);
  return primero >= 224 && primero <= 239;
}

interface RedAnalizada {
  /** Número de la dirección de red. */
  red: number;
  mascara: number;
  /** Primera y última dirección «útil» (sin red ni difusión). */
  primeraUtil: number;
  ultimaUtil: number;
  totalUtiles: number;
}

/** Analiza un CIDR IPv4; devuelve null si está mal formado. */
export function analizarCidr(cidr: string): RedAnalizada | null {
  const [base, maskStr] = (cidr || "").split("/");
  const mascara = parseInt(maskStr, 10);
  const ipNum = ipANumero(base || "");
  if (Number.isNaN(ipNum) || Number.isNaN(mascara) || mascara < 0 || mascara > 32) {
    return null;
  }
  const hostBits = 32 - mascara;
  // Ojo: los operadores de bits de JS devuelven enteros CON signo;
  // sin el «>>> 0» final, las redes con primer octeto ≥ 128 darían
  // una dirección de red negativa que no casaría con ipANumero.
  const red =
    hostBits === 32 ? ipNum : (((ipNum >>> hostBits) << hostBits) >>> 0);
  const difusion = red + Math.pow(2, hostBits) - 1;
  // En /31 los dos extremos son direcciones de host (enlace punto a
  // punto) y en /32 la única dirección es el host mismo.
  const primeraUtil = mascara >= 31 ? red : red + 1;
  const ultimaUtil = mascara >= 31 ? difusion : difusion - 1;
  return {
    red,
    mascara,
    primeraUtil,
    ultimaUtil,
    totalUtiles: Math.max(0, ultimaUtil - primeraUtil + 1),
  };
}

// ════════════════════════════════════════════════════════════════
// Fase 0 — Tabla de vecinos (ARP) del sistema operativo
// ════════════════════════════════════════════════════════════════

export interface VecinoRed {
  ip: string;
  mac: string;
}

const MAC_DIFUSION = "ff:ff:ff:ff:ff:ff";

function normalizarMac(mac: string): string {
  return mac
    .replace(/-/g, ":")
    .toLowerCase()
    .split(":")
    .map((parte) => parte.padStart(2, "0"))
    .join(":");
}

/**
 * Analiza la salida de `arp -a` de Windows: bloques por interfaz
 * («Interface: 192.168.1.50 --- 0x6») con líneas
 * «IP  MAC-con-guiones  dynamic/static». El análisis es por
 * expresión regular sobre IP y MAC, sin depender de los textos de
 * cabecera (que van en el idioma del Windows instalado). Se
 * descartan la MAC de difusión y las direcciones multicast: no son
 * equipos.
 */
export function parsearVecinosArpWindows(texto: string): VecinoRed[] {
  const vecinos: VecinoRed[] = [];
  const re =
    /^\s*(\d{1,3}(?:\.\d{1,3}){3})\s+([0-9a-fA-F]{2}(?:-[0-9a-fA-F]{2}){5})\s+\S+/;
  for (const linea of texto.split(/\r?\n/)) {
    const m = re.exec(linea);
    if (!m) continue;
    const [, ip, macCruda] = m;
    const mac = normalizarMac(macCruda);
    if (mac === MAC_DIFUSION || esMulticast(ip) || ip === "255.255.255.255") {
      continue;
    }
    vecinos.push({ ip, mac });
  }
  return vecinos;
}

const ESTADOS_VECINO = new Set([
  "REACHABLE",
  "STALE",
  "DELAY",
  "PROBE",
  "PERMANENT",
  "NOARP",
  "FAILED",
  "INCOMPLETE",
  "NONE",
]);

/**
 * Analiza la salida de `ip neigh show` de Linux: líneas
 * «IP dev interfaz lladdr MAC ESTADO» (puede colarse un «router»
 * entre la MAC y el estado). Sin «lladdr» no hay vecino resuelto, y
 * los estados FAILED/INCOMPLETE son intentos sin respuesta: fuera.
 * Las líneas IPv6 se ignoran (este escáner es IPv4).
 */
export function parsearVecinosIpNeigh(texto: string): VecinoRed[] {
  const vecinos: VecinoRed[] = [];
  for (const linea of texto.split(/\r?\n/)) {
    const tokens = linea.trim().split(/\s+/);
    if (tokens.length < 2) continue;
    const ip = tokens[0];
    if (Number.isNaN(ipANumero(ip)) || esMulticast(ip)) continue;
    const idxLladdr = tokens.indexOf("lladdr");
    if (idxLladdr < 0 || !tokens[idxLladdr + 1]) continue;
    const ultimo = tokens[tokens.length - 1].toUpperCase();
    const estado = ESTADOS_VECINO.has(ultimo) ? ultimo : null;
    if (estado === "FAILED" || estado === "INCOMPLETE") continue;
    const mac = normalizarMac(tokens[idxLladdr + 1]);
    if (mac === MAC_DIFUSION) continue;
    vecinos.push({ ip, mac });
  }
  return vecinos;
}

/**
 * Analiza `/proc/net/arp` de Linux: columnas «IP, tipo HW, flags,
 * MAC, máscara, dispositivo». Un flags 0x0 es una entrada
 * incompleta (sin respuesta) y la MAC a ceros tampoco es un vecino.
 */
export function parsearVecinosProcNetArp(texto: string): VecinoRed[] {
  const vecinos: VecinoRed[] = [];
  const lineas = texto.split(/\r?\n/).slice(1); // la primera es la cabecera
  for (const linea of lineas) {
    const tokens = linea.trim().split(/\s+/);
    if (tokens.length < 4) continue;
    const [ip, , flags, macCruda] = tokens;
    if (Number.isNaN(ipANumero(ip)) || esMulticast(ip)) continue;
    if (flags === "0x0") continue;
    const mac = normalizarMac(macCruda);
    if (mac === "00:00:00:00:00:00" || mac === MAC_DIFUSION) continue;
    vecinos.push({ ip, mac });
  }
  return vecinos;
}

/**
 * Analiza la salida de `arp -a` de macOS: líneas
 * «nombre (IP) at MAC on interfaz …», con «at (incomplete)» cuando
 * no hubo respuesta (sin MAC válida, la expresión no casa).
 */
export function parsearVecinosArpUnix(texto: string): VecinoRed[] {
  const vecinos: VecinoRed[] = [];
  const re = /\((\d{1,3}(?:\.\d{1,3}){3})\)\s+at\s+([0-9a-fA-F]{1,2}(?::[0-9a-fA-F]{1,2}){5})\b/;
  for (const linea of texto.split(/\r?\n/)) {
    const m = re.exec(linea);
    if (!m) continue;
    const [, ip, macCruda] = m;
    const mac = normalizarMac(macCruda);
    if (mac === MAC_DIFUSION || esMulticast(ip)) continue;
    vecinos.push({ ip, mac });
  }
  return vecinos;
}

const OPCIONES_LECTURA_VECINOS = {
  timeout: 8_000,
  // Tras barrer una /16 la tabla puede tener decenas de miles de
  // entradas: el búfer por defecto de execFile (1 MB) se quedaría
  // corto y la lectura fallaría justo cuando más falta hace.
  maxBuffer: 32 * 1024 * 1024,
} as const;

/**
 * Lee la tabla de vecinos del sistema. Devuelve la lista (posible-
 * mente vacía) o null si no hubo manera de leerla en esta
 * plataforma: ese null es lo que activa el barrido TCP de reserva.
 * Leer la tabla no genera tráfico ni necesita permisos elevados.
 */
export async function leerTablaVecinos(): Promise<VecinoRed[] | null> {
  try {
    if (process.platform === "win32") {
      const { stdout } = await execFileAsync("arp", ["-a"], OPCIONES_LECTURA_VECINOS);
      return parsearVecinosArpWindows(stdout);
    }
    if (process.platform === "darwin") {
      const { stdout } = await execFileAsync("arp", ["-a"], OPCIONES_LECTURA_VECINOS);
      return parsearVecinosArpUnix(stdout);
    }
    // Linux: `ip neigh` y, si el comando no existe en el sistema,
    // el fichero del núcleo /proc/net/arp dice lo mismo.
    try {
      const { stdout } = await execFileAsync("ip", ["neigh", "show"], OPCIONES_LECTURA_VECINOS);
      return parsearVecinosIpNeigh(stdout);
    } catch {
      const texto = await fs.readFile("/proc/net/arp", "utf8");
      return parsearVecinosProcNetArp(texto);
    }
  } catch {
    return null;
  }
}

/** Une varias listas de vecinos sin duplicar IPs (gana la primera MAC conocida). */
export function unirVecinos(
  ...listas: Array<VecinoRed[] | null | undefined>
): VecinoRed[] {
  const porIp = new Map<string, VecinoRed>();
  for (const lista of listas) {
    if (!lista) continue;
    for (const vecino of lista) {
      if (vecino.mac === MAC_DIFUSION) continue;
      if (!porIp.has(vecino.ip)) porIp.set(vecino.ip, vecino);
    }
  }
  return [...porIp.values()];
}

// ════════════════════════════════════════════════════════════════
// Plan de cobertura: qué se barre de cada red conectada
// ════════════════════════════════════════════════════════════════

/**
 * Una /16 entera (65.534 direcciones útiles) es lo máximo que se
 * barre sin recortar: con datagramas UDP pautados son unos pocos
 * segundos y la tabla de vecinos de un sistema normal lo aguanta.
 * Por encima de eso la red ya no es una LAN al uso y se recurre a
 * ventanas /24 alrededor de lo conocido.
 */
export const MAX_DIRECCIONES_BARRIDO = 65_534;

export interface ObjetivoRed {
  /** CIDR normalizado de la red (dirección de red/máscara). */
  cidr: string;
  /** Nombre de la interfaz que aporta la red. */
  interfaz: string;
  /** IP propia del panel en esta red. */
  direccionPropia: string;
  /** true si se barre la red entera; false si solo ventanas /24. */
  coberturaCompleta: boolean;
  /** Motivo de la cobertura parcial (solo si coberturaCompleta es false). */
  motivoParcial?: string;
  /** Extremos numéricos de la subred completa (para acotar vecinos). */
  desdeRed: number;
  hastaRed: number;
  /** Intervalos numéricos a barrer con UDP (o a sondear en la reserva TCP). */
  intervalos: Array<{ desde: number; hasta: number }>;
  /** Direcciones útiles totales de la red. */
  totalDirecciones: number;
}

function fusionarIntervalos(
  intervalos: Array<{ desde: number; hasta: number }>
): Array<{ desde: number; hasta: number }> {
  const ordenados = [...intervalos].sort((a, b) => a.desde - b.desde);
  const fusionados: Array<{ desde: number; hasta: number }> = [];
  for (const intervalo of ordenados) {
    const ultimo = fusionados[fusionados.length - 1];
    if (ultimo && intervalo.desde <= ultimo.hasta + 1) {
      ultimo.hasta = Math.max(ultimo.hasta, intervalo.hasta);
    } else {
      fusionados.push({ ...intervalo });
    }
  }
  return fusionados;
}

/**
 * Decide, para cada red conectada, qué intervalos se barren:
 * - Hasta una /16 incluida: la red entera.
 * - Mayor que una /16: ventanas /24 alrededor de la IP propia y de
 *   cada vecino ya conocido de esa red, y la red queda marcada
 *   como cobertura parcial (nunca como error: el escaneo sigue).
 * Dos interfaces sobre la misma red producen un solo objetivo.
 */
export function planificarCobertura(
  redes: NetworkInterfaceInfo[],
  conocidos: VecinoRed[] = []
): ObjetivoRed[] {
  const objetivos: ObjetivoRed[] = [];
  const vistos = new Set<string>();
  for (const red of redes) {
    const analisis = analizarCidr(red.cidr);
    if (!analisis) continue;
    const cidrNormalizado = `${numeroAIp(analisis.red)}/${analisis.mascara}`;
    if (vistos.has(cidrNormalizado)) continue;
    vistos.add(cidrNormalizado);
    const base: ObjetivoRed = {
      cidr: cidrNormalizado,
      interfaz: red.name,
      direccionPropia: red.address,
      coberturaCompleta: true,
      desdeRed: analisis.red,
      hastaRed: analisis.ultimaUtil + (analisis.mascara >= 31 ? 0 : 1),
      intervalos: [],
      totalDirecciones: analisis.totalUtiles,
    };
    if (analisis.totalUtiles <= MAX_DIRECCIONES_BARRIDO) {
      base.intervalos = [
        { desde: analisis.primeraUtil, hasta: analisis.ultimaUtil },
      ];
    } else {
      base.coberturaCompleta = false;
      base.motivoParcial =
        "la red es mayor que una /16: se barrió solo alrededor de las direcciones conocidas";
      // Ventanas /24 de la IP propia y de cada vecino conocido que
      // caiga dentro de esta red, recortadas a las direcciones
      // útiles de la propia red.
      const centros = new Set<number>();
      const propia = ipANumero(red.address);
      if (!Number.isNaN(propia)) centros.add(propia);
      for (const vecino of conocidos) {
        const n = ipANumero(vecino.ip);
        if (!Number.isNaN(n) && n >= analisis.red && n <= base.hastaRed) {
          centros.add(n);
        }
      }
      const ventanas: Array<{ desde: number; hasta: number }> = [];
      for (const centro of centros) {
        const baseVentana = (centro & 0xffffff00) >>> 0;
        ventanas.push({
          desde: Math.max(baseVentana, analisis.primeraUtil),
          hasta: Math.min(baseVentana + 255, analisis.ultimaUtil),
        });
      }
      base.intervalos = fusionarIntervalos(ventanas);
    }
    objetivos.push(base);
  }
  return objetivos;
}

/**
 * Vecinos que pertenecen a alguna de las redes escaneadas. Lo que
 * la tabla traiga de otras redes (la puerta de enlace de una VPN,
 * por ejemplo) no es un hallazgo de este escaneo.
 */
export function filtrarVecinosPorRedes(
  vecinos: VecinoRed[],
  objetivos: ObjetivoRed[]
): VecinoRed[] {
  return vecinos.filter((vecino) => {
    const n = ipANumero(vecino.ip);
    if (Number.isNaN(n) || esMulticast(vecino.ip)) return false;
    return objetivos.some((o) => n >= o.desdeRed && n <= o.hastaRed);
  });
}

// ════════════════════════════════════════════════════════════════
// Fase 1 — Barrido UDP que induce resolución ARP
// ════════════════════════════════════════════════════════════════

/**
 * Puerto destino del barrido: alto y sin servicio conocido. El
 * datagrama no busca respuesta —de hecho lo normal es que el host
 * conteste «puerto inalcanzable» por ICMP—; su único trabajo es
 * obligar al núcleo a resolver la MAC del destino por ARP antes de
 * enviarlo, y esa resolución es lo que deja al host en la tabla de
 * vecinos. ARP es capa 2: el cortafuegos del host no lo filtra,
 * a diferencia del eco ICMP que el motor anterior usaba.
 */
export const PUERTO_DESCUBRIMIENTO_UDP = 40125;

/** Envíos por bloque antes de hacer una pausa breve de ritmo. */
const TAMANO_BLOQUE_UDP = 512;
const PAUSA_ENTRE_BLOQUES_MS = 5;

/** Espera a que las resoluciones ARP inducidas se asienten en la tabla. */
export const ESPERA_ASENTAMIENTO_MS = 2_000;

async function barrerUdp(
  objetivos: ObjetivoRed[],
  excluir: Set<string>
): Promise<void> {
  const socket = dgram.createSocket("udp4");
  // Un error del socket (red caída a mitad de barrido) no debe
  // tumbar el escaneo: lo ya resuelto sigue en la tabla.
  socket.on("error", () => {});
  const carga = Buffer.from([0]);
  let enBloque = 0;
  try {
    for (const objetivo of objetivos) {
      for (const { desde, hasta } of objetivo.intervalos) {
        for (let n = desde; n <= hasta; n++) {
          const ip = numeroAIp(n);
          if (excluir.has(ip)) continue;
          try {
            socket.send(carga, PUERTO_DESCUBRIMIENTO_UDP, ip);
          } catch {
            // Dirección no alcanzable desde ninguna interfaz: seguir.
          }
          if (++enBloque >= TAMANO_BLOQUE_UDP) {
            enBloque = 0;
            // Ritmo pautado: ceder unos milisegundos por bloque para
            // no monopolizar el proceso ni desbordar la tabla.
            await new Promise((r) => setTimeout(r, PAUSA_ENTRE_BLOQUES_MS));
          }
        }
      }
    }
  } finally {
    socket.close();
  }
}

// ════════════════════════════════════════════════════════════════
// Reserva — Barrido TCP en proceso cuando no hay tabla de vecinos
// ════════════════════════════════════════════════════════════════

const TIMEOUT_TCP_RESERVA_MS = 350;
const CONCURRENCIA_TCP_RESERVA = 128;

/**
 * Intenta abrir una conexión TCP contra cada IP y devuelve las
 * que aceptan. Es la reserva para cuando no se puede leer la tabla
 * de vecinos: sin spawn de procesos, con timeout corto y mucha
 * concurrencia. Solo «ve» equipos con ese puerto abierto (para el
 * escaneo es el del agente), así que su lista de vivos es más pobre
 * que la de la tabla de vecinos — por eso es solo reserva.
 */
export async function sondearPuertoTcp(
  ips: string[],
  puerto: number,
  opciones?: { timeoutMs?: number; concurrencia?: number }
): Promise<Set<string>> {
  const timeoutMs = opciones?.timeoutMs ?? TIMEOUT_TCP_RESERVA_MS;
  const concurrencia = opciones?.concurrencia ?? CONCURRENCIA_TCP_RESERVA;
  const abiertos = new Set<string>();
  let indice = 0;
  async function worker() {
    while (indice < ips.length) {
      const ip = ips[indice++];
      const abierto = await new Promise<boolean>((resolve) => {
        const conexion = net.createConnection({ host: ip, port: puerto });
        const terminar = (valor: boolean) => {
          conexion.destroy();
          resolve(valor);
        };
        conexion.setTimeout(timeoutMs);
        conexion.once("connect", () => terminar(true));
        conexion.once("timeout", () => terminar(false));
        conexion.once("error", () => terminar(false));
      });
      if (abierto) abiertos.add(ip);
    }
  }
  const numWorkers = Math.max(1, Math.min(concurrencia, ips.length));
  await Promise.all(Array.from({ length: numWorkers }, () => worker()));
  return abiertos;
}

function ipsDeIntervalos(
  objetivos: ObjetivoRed[],
  excluir: Set<string>
): string[] {
  const ips: string[] = [];
  for (const objetivo of objetivos) {
    for (const { desde, hasta } of objetivo.intervalos) {
      for (let n = desde; n <= hasta; n++) {
        const ip = numeroAIp(n);
        if (!excluir.has(ip)) ips.push(ip);
      }
    }
  }
  return ips;
}

// ════════════════════════════════════════════════════════════════
// Fase 2 — Sondeo del agente sobre los hosts vivos
// ════════════════════════════════════════════════════════════════

export interface HostScanResult {
  ip: string;
  alive: boolean;
  /** MAC descubierta en la tabla de vecinos, si se conoce. */
  mac?: string;
  serviceInstalled?: boolean;
  serviceRunning?: boolean;
  lastServiceCheck?: Date;
  healthStatus?: string;
  hostname?: string;
  latencyMs?: number;
  serviceVersion?: string;
  uptimeSeconds?: number;
  lastServiceHeartbeat?: Date | null;
  error?: string;
}

type ServiceCheckResult = Pick<
  HostScanResult,
  | "serviceInstalled"
  | "serviceRunning"
  | "lastServiceCheck"
  | "healthStatus"
  | "hostname"
  | "latencyMs"
  | "serviceVersion"
  | "uptimeSeconds"
  | "lastServiceHeartbeat"
>;

interface ComputerUpsertPayload {
  name: string;
  ip: string;
  lastSeenAt: Date;
  isActive: boolean;
  serviceInstalled?: boolean;
  serviceRunning?: boolean;
  lastServiceCheck?: Date;
}

async function checkService(ip: string): Promise<ServiceCheckResult> {
  const result: ServiceCheckResult = {
    serviceInstalled: false,
    serviceRunning: false,
    lastServiceCheck: getCurrentDate(),
    healthStatus: "Sin respuesta",
  };

  const health = await checkServiceHealth(ip);
  const statusText =
    health.statusText || (health.available ? "OK" : "Sin respuesta");
  const statusCode = health.statusCode;

  if (statusCode) {
    result.healthStatus = `${statusCode} ${statusText || ""}`.trim();
  } else if (statusText) {
    result.healthStatus = statusText;
  }

  if (health.available) {
    // «Instalado» y «en ejecución» salen del mismo dato (el agente
    // respondió en su puerto): no hay forma de distinguir un agente
    // instalado pero detenido desde la red, así que ambos campos se
    // rellenan juntos y la interfaz los presenta como un solo estado.
    result.serviceInstalled = true;
    result.serviceRunning = true;
  }

  if (health.hostname) {
    result.hostname = health.hostname;
  }

  if (typeof health.latencyMs === "number") {
    result.latencyMs = health.latencyMs;
  }

  if (typeof health.serviceVersion === "string") {
    result.serviceVersion = health.serviceVersion;
  }

  if (typeof health.uptimeSeconds === "number") {
    result.uptimeSeconds = health.uptimeSeconds;
  }

  if (typeof health.heartbeatAt === "number") {
    result.lastServiceHeartbeat = new Date(health.heartbeatAt);
  }

  return result;
}

async function persistComputers(entries: ComputerUpsertPayload[]) {
  if (!entries.length) return;
  // Cada entrada pasa por la resolución de identidad
  // (nombre + IP): si la misma PC existía como dos filas —la
  // del nombre y otra con la misma IP— se fusionan y el
  // escaneo anota en la fila única, en vez de alimentar la
  // duplicada. Son pocos hosts (solo los que tienen agente),
  // así que va en serie sin problema.
  for (const entry of entries) {
    const datos = {
      ipAddress: entry.ip,
      lastSeen: entry.lastSeenAt,
      isActive: entry.isActive,
      serviceInstalled: entry.serviceInstalled ?? false,
      serviceRunning: entry.serviceRunning ?? false,
      lastServiceCheck: entry.lastServiceCheck,
    };
    const resuelto = await resolverEquipoParaAgente({
      nombre: entry.name,
      ip: entry.ip,
    }).catch(() => null);
    if (resuelto) {
      await (db as any).computer.update({
        where: { id: resuelto.id },
        data: datos,
      });
    } else {
      await (db as any).computer.upsert({
        where: { name: entry.name },
        update: datos,
        create: { name: entry.name, ...datos },
      });
    }
  }
}

// ════════════════════════════════════════════════════════════════
// Escaneo completo
// ════════════════════════════════════════════════════════════════

export interface RedEscaneada {
  cidr: string;
  interfaz: string;
  coberturaParcial: boolean;
  motivoParcial?: string;
}

export interface ResumenEscaneo {
  /** Redes que entraron en el escaneo y su cobertura. */
  redes: RedEscaneada[];
  /** Hosts vivos encontrados (con o sin agente). */
  hostsVivos: number;
  /** Hosts vivos con el agente respondiendo (o reportado al panel). */
  conAgente: number;
  /** Método de descubrimiento: tabla de vecinos o reserva TCP. */
  metodo: "vecinos" | "tcp";
}

export interface ResultadoEscaneo {
  results: HostScanResult[];
  cached: boolean;
  resumen: ResumenEscaneo;
}

// Caché simple de 60 s, como hasta ahora, pero por conjunto de
// redes escaneadas (el escaneo automático cubre todas las redes).
let lastScan: {
  clave: string;
  timestamp: number;
  resultado: ResultadoEscaneo;
} | null = null;
const CACHE_TTL_MS = 60_000; // 60s

const CONCURRENCIA_SONDEO_AGENTE = 25;

/**
 * Interfaz sintética para un CIDR pedido a mano que no coincide
 * con ninguna interfaz del equipo (la API lo acepta): la base del
 * CIDR hace de «dirección propia» a efectos de ventanas.
 */
function interfazSintetica(cidr: string): NetworkInterfaceInfo | null {
  const analisis = analizarCidr(cidr);
  if (!analisis) return null;
  const bits = analisis.mascara;
  const netmask = numeroAIp(bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0);
  return {
    name: "manual",
    address: numeroAIp(analisis.red),
    cidr: `${numeroAIp(analisis.red)}/${bits}`,
    mac: "",
    netmask,
    type: "other",
  };
}

/**
 * Escanea las redes conectadas (o una sola si se pide su CIDR):
 * 0) vecinos ya conocidos en la tabla ARP — sin generar tráfico;
 * 1) barrido UDP sobre todas las subredes para inducir la
 *    resolución ARP de cada host vivo y releer la tabla;
 * 2) sondeo del agente solo sobre los vivos resultantes.
 * Si la tabla de vecinos no se puede leer, la fase 1 se sustituye
 * por un barrido TCP en proceso contra el puerto del agente.
 * Las direcciones propias del panel no cuentan como hosts.
 */
export async function scanNetwork(
  cidr?: string,
  options?: { force?: boolean; esperaAsentamientoMs?: number }
): Promise<ResultadoEscaneo> {
  const todas = getAllLocalNetworks();
  let redes: NetworkInterfaceInfo[];
  if (cidr) {
    const pedido = analizarCidr(cidr);
    if (!pedido) throw new Error(`CIDR no válido: ${cidr}`);
    const existente = todas.find((r) => {
      const suya = analizarCidr(r.cidr);
      return suya && suya.red === pedido.red && suya.mascara === pedido.mascara;
    });
    const sintetica = interfazSintetica(cidr);
    if (!sintetica) throw new Error(`CIDR no válido: ${cidr}`);
    redes = [existente ?? sintetica];
  } else {
    redes = todas;
  }
  if (!redes.length) throw new Error("No se pudo determinar la red local");

  const clave = redes
    .map((r) => r.cidr)
    .sort()
    .join(",");
  if (
    !options?.force &&
    lastScan &&
    lastScan.clave === clave &&
    getCurrentTimestamp() - lastScan.timestamp < CACHE_TTL_MS
  ) {
    return { ...lastScan.resultado, cached: true };
  }

  const ipsPropias = new Set(todas.map((n) => n.address));

  // Fase 0: lo que la tabla ya sabe, gratis.
  const vecinosIniciales = await leerTablaVecinos();
  const objetivos = planificarCobertura(redes, vecinosIniciales ?? []);

  // Fase 1: descubrimiento de vivos.
  let metodo: ResumenEscaneo["metodo"] = "vecinos";
  let vivos: VecinoRed[] = [];
  if (vecinosIniciales !== null) {
    await barrerUdp(objetivos, ipsPropias);
    const espera = options?.esperaAsentamientoMs ?? ESPERA_ASENTAMIENTO_MS;
    if (espera > 0) await new Promise((r) => setTimeout(r, espera));
    const vecinosTrasBarrido = await leerTablaVecinos();
    vivos = filtrarVecinosPorRedes(
      unirVecinos(vecinosIniciales, vecinosTrasBarrido),
      objetivos
    ).filter((v) => !ipsPropias.has(v.ip));
  } else {
    // Sin tabla de vecinos legible: barrido TCP en proceso contra
    // el puerto del agente sobre las mismas redes y guardas.
    metodo = "tcp";
    const puertoAgente = Number(process.env.USB_SERVICE_PORT || "5001");
    const ips = ipsDeIntervalos(objetivos, ipsPropias);
    const abiertos = await sondearPuertoTcp(ips, puertoAgente);
    vivos = [...abiertos].map((ip) => ({ ip, mac: "" }));
  }

  // Registro de agentes según el propio panel: cada agente se
  // reporta a sí mismo (su IP y su última señal). El sondeo HTTP
  // al :5001 solo puede responder en el equipo donde corre el
  // panel, porque el servidor local del agente escucha en
  // 127.0.0.1 por seguridad (ahí van la página de emergencia y la
  // configuración): para el resto de la red, la presencia del
  // servicio se confirma con este registro. Si un agente reportó
  // hace menos de 5 minutos, su servicio está en marcha.
  const agentesPorIp = new Map<
    string,
    { nombre: string; ultimaSenal: Date }
  >();
  try {
    const equipos = await (db as any).computer.findMany({
      select: { name: true, ipAddress: true, lastSeen: true },
    });
    for (const eq of equipos) {
      const ipEq = typeof eq.ipAddress === "string" ? eq.ipAddress.trim() : "";
      if (ipEq && eq.lastSeen) {
        agentesPorIp.set(ipEq, { nombre: eq.name, ultimaSenal: eq.lastSeen });
      }
    }
  } catch {
    // Sin registro disponible: el escaneo sigue solo con el sondeo.
  }

  // Fase 2: sondeo del agente solo sobre los vivos (decenas de
  // hosts, no miles de direcciones).
  const results: HostScanResult[] = [];
  const persistQueue: ComputerUpsertPayload[] = [];
  let conAgente = 0;
  let indice = 0;
  async function worker() {
    while (indice < vivos.length) {
      const vecino = vivos[indice++];
      const host: HostScanResult = {
        ip: vecino.ip,
        alive: true,
        ...(vecino.mac ? { mac: vecino.mac } : {}),
      };
      try {
        let svc = await checkService(vecino.ip);
        if (!svc.serviceInstalled) {
          const reg = agentesPorIp.get(vecino.ip);
          if (
            reg &&
            getCurrentTimestamp() - reg.ultimaSenal.getTime() < 5 * 60_000
          ) {
            svc = {
              serviceInstalled: true,
              serviceRunning: true,
              lastServiceCheck: getCurrentDate(),
              healthStatus: "OK (reportado al panel)",
              hostname: reg.nombre,
            };
          }
        }
        Object.assign(host, svc);
        const normalizedName = svc.hostname
          ? normalizeComputerName(svc.hostname)
          : "";
        host.hostname = normalizedName || host.hostname;
        if (svc.serviceInstalled) {
          conAgente++;
          // Solo se persiste lo que tiene agente: un host vivo sin
          // agente (impresora, teléfono) se muestra en los
          // resultados pero NO se convierte en «equipo» del registro.
          // Y solo si se conoce su NOMBRE: antes, sin nombre, la
          // fila se creaba con la IP como nombre, y esa fila «por
          // IP» duplicaba a la de verdad (con la credencial y el
          // dueño en la otra). Sin nombre no hay alta: el equipo
          // entrará por su propio reporte, que sí trae el nombre.
          if (normalizedName) {
            persistQueue.push({
              name: normalizedName,
              ip: vecino.ip,
              lastSeenAt: getCurrentDate(),
              isActive: true,
              serviceInstalled: true,
              serviceRunning: true,
              lastServiceCheck: svc.lastServiceCheck,
            });
          }
        }
      } catch (e: any) {
        host.error = e.message;
      }
      results.push(host);
    }
  }
  await Promise.all(
    Array.from(
      { length: Math.max(1, Math.min(CONCURRENCIA_SONDEO_AGENTE, vivos.length)) },
      () => worker()
    )
  );
  await persistComputers(persistQueue);

  results.sort((a, b) => ipANumero(a.ip) - ipANumero(b.ip));

  const resultado: ResultadoEscaneo = {
    results,
    cached: false,
    resumen: {
      redes: objetivos.map((o) => ({
        cidr: o.cidr,
        interfaz: o.interfaz,
        coberturaParcial: !o.coberturaCompleta,
        ...(o.motivoParcial ? { motivoParcial: o.motivoParcial } : {}),
      })),
      hostsVivos: results.length,
      conAgente,
      metodo,
    },
  };
  lastScan = { clave, timestamp: getCurrentTimestamp(), resultado };
  return resultado;
}
