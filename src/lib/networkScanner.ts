import os from "os";
import { execFile } from "child_process";
import util from "util";
import { db } from "@/lib/db";
import { checkServiceHealth } from "@/lib/serviceNotifier";
import { getCurrentDate, getCurrentTimestamp } from "@/lib/time";
import { normalizeComputerName } from "@/lib/utils";

const execFileAsync = util.promisify(execFile);

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

export interface HostScanResult {
  ip: string;
  alive: boolean;
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

function getLocalCIDR(): string | null {
  // Única fuente de verdad: la misma lista que ve el selector de
  // interfaces (salta internas y link-local, usa la máscara real y
  // viene ordenada por preferencia: la primera es la interfaz real).
  return getAllLocalNetworks()[0]?.cidr ?? null;
}

const MAX_SCAN_HOSTS = 1024;

export interface ScanRange {
  ips: string[];
  /** true si la red pedida era mayor que el tope y se escaneó solo una ventana. */
  limitado: boolean;
  /** Direcciones útiles que tiene la red pedida (antes de limitar). */
  totalDirecciones: number;
  /** CIDR efectivamente escaneado (la ventana /24 si se limitó). */
  cidrEscaneado: string;
}

function numeroAIp(n: number): string {
  return `${(n >>> 24) & 255}.${(n >>> 16) & 255}.${(n >>> 8) & 255}.${n & 255}`;
}

/**
 * Rango a escanear para un CIDR. Una red mayor que el tope ya NO es
 * un error: las Ethernet de empresa suelen ser /16 y rechazarlas
 * dejaba el escáner inútil con el cable puesto. En ese caso se
 * escanea la ventana /24 que contiene la dirección base (en las
 * interfaces es la IP propia del equipo) y el llamante avisa de que
 * el rango se limitó. El tope sigue protegiendo: nunca se escanean
 * más de MAX_SCAN_HOSTS direcciones de una vez.
 */
export function scanRangeFromCIDR(cidr: string): ScanRange {
  const [base, maskStr] = cidr.split("/");
  const mask = parseInt(maskStr, 10);
  const octets = base.split(".").map(Number);
  if (octets.length !== 4 || octets.some((o) => Number.isNaN(o)) || Number.isNaN(mask) || mask < 0 || mask > 32) {
    throw new Error(`CIDR no válido: ${cidr}`);
  }
  const ipNum = ((octets[0] << 24) >>> 0) + (octets[1] << 16) + (octets[2] << 8) + octets[3];
  const hostBits = 32 - mask;
  const total = mask >= 31 ? Math.pow(2, hostBits) : Math.pow(2, hostBits) - 2;
  const network = hostBits === 32 ? ipNum : (ipNum >>> hostBits) << hostBits;

  if (total > MAX_SCAN_HOSTS) {
    // Ventana /24 alrededor de la dirección base: sus 254 útiles.
    const ventana = ipNum & 0xffffff00;
    const ips: string[] = [];
    for (let i = 1; i <= 254; i++) ips.push(numeroAIp(ventana + i));
    return {
      ips,
      limitado: true,
      totalDirecciones: total,
      cidrEscaneado: `${numeroAIp(ventana)}/24`,
    };
  }

  const first = mask >= 31 ? network : network + 1;
  const ips: string[] = [];
  for (let i = 0; i < total; i++) ips.push(numeroAIp(first + i));
  return {
    ips,
    limitado: false,
    totalDirecciones: total,
    cidrEscaneado: `${numeroAIp(network)}/${mask}`,
  };
}

export function ipRangeFromCIDR(cidr: string): string[] {
  return scanRangeFromCIDR(cidr).ips;
}

async function pingHost(ip: string, timeoutMs = 800): Promise<boolean> {
  // Sintaxis según el sistema donde corre el PANEL (no el agente):
  // Windows usa -n/-w en ms; Linux -c/-W en segundos; macOS -c/-W en ms.
  const platform = process.platform;
  const args =
    platform === "win32"
      ? ["-n", "1", "-w", String(timeoutMs)]
      : platform === "darwin"
        ? ["-c", "1", "-W", String(timeoutMs)]
        : ["-c", "1", "-W", String(Math.max(1, Math.ceil(timeoutMs / 1000)))];
  try {
    await execFileAsync("ping", [...args, ip], { timeout: timeoutMs + 2000 });
    return true;
  } catch {
    return false;
  }
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

// Simple cache
let lastScan: {
  cidr: string;
  timestamp: number;
  results: HostScanResult[];
  limitado: boolean;
  cidrEscaneado: string;
} | null = null;
const CACHE_TTL_MS = 60_000; // 60s

const UPSERT_BATCH_SIZE = 25;

async function persistComputers(entries: ComputerUpsertPayload[]) {
  if (!entries.length) return;
  // Chunk $transaction calls to keep Prisma execution time predictable and reduce round trips.
  for (let i = 0; i < entries.length; i += UPSERT_BATCH_SIZE) {
    const slice = entries.slice(i, i + UPSERT_BATCH_SIZE);
    const operations = slice.map((entry) =>
      (db as any).computer.upsert({
        where: { name: entry.name },
        update: {
          ipAddress: entry.ip,
          lastSeen: entry.lastSeenAt,
          isActive: entry.isActive,
          serviceInstalled: entry.serviceInstalled ?? false,
          serviceRunning: entry.serviceRunning ?? false,
          lastServiceCheck: entry.lastServiceCheck,
        },
        create: {
          name: entry.name,
          ipAddress: entry.ip,
          lastSeen: entry.lastSeenAt,
          isActive: entry.isActive,
          serviceInstalled: entry.serviceInstalled ?? false,
          serviceRunning: entry.serviceRunning ?? false,
          lastServiceCheck: entry.lastServiceCheck,
        },
      })
    );
    await (db as any).$transaction(operations);
  }
}

export async function scanNetwork(
  cidr?: string,
  options?: { force?: boolean }
): Promise<{
  results: HostScanResult[];
  cached: boolean;
  limitado: boolean;
  cidrEscaneado: string;
}> {
  const net = cidr || getLocalCIDR();
  if (!net) throw new Error("No se pudo determinar la red local");
  if (
    !options?.force &&
    lastScan &&
    lastScan.cidr === net &&
    getCurrentTimestamp() - lastScan.timestamp < CACHE_TTL_MS
  ) {
    return {
      results: lastScan.results,
      cached: true,
      limitado: lastScan.limitado,
      cidrEscaneado: lastScan.cidrEscaneado,
    };
  }
  const rango = scanRangeFromCIDR(net);
  const ips = rango.ips;
  const concurrency = 30;
  const results: HostScanResult[] = [];
  const persistQueue: ComputerUpsertPayload[] = [];

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
    // Sin registro disponible: el escaneo sigue con ping y sondeo.
  }
  const ipsPropias = new Set(getAllLocalNetworks().map((n) => n.address));
  let index = 0;
  async function worker() {
    while (index < ips.length) {
      const i = index++;
      const ip = ips[i];
      const host: HostScanResult = { ip, alive: false };
      try {
        // Ping y puerto del agente se comprueban A LA VEZ y por
        // separado: un PC con el agente sano pero el ICMP bloqueado
        // por su cortafuegos debe aparecer igual (antes el servicio
        // solo se miraba si el ping respondía). El propio equipo se
        // sondea por 127.0.0.1, que es donde su agente escucha.
        const ipSondeo = ipsPropias.has(ip) ? "127.0.0.1" : ip;
        const [isUp, svcSondeo] = await Promise.all([
          pingHost(ip),
          checkService(ipSondeo),
        ]);
        let svc = svcSondeo;
        if (!svc.serviceInstalled) {
          const reg = agentesPorIp.get(ip);
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
        host.alive = isUp || svc.serviceInstalled === true;
        if (host.alive) {
          Object.assign(host, svc);
          const normalizedName = svc.hostname
            ? normalizeComputerName(svc.hostname)
            : "";
          host.hostname = normalizedName || host.hostname;
          // Solo se persiste lo que tiene agente: un host que solo
          // responde al ping (impresora, teléfono) se muestra en los
          // resultados pero NO se convierte en «equipo» del registro.
          if (svc.serviceInstalled) {
            persistQueue.push({
              name: normalizedName || normalizeComputerName(ip),
              ip,
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
  const workers = Array.from({ length: concurrency }, () => worker());
  await Promise.all(workers);
  await persistComputers(persistQueue);
  lastScan = {
    cidr: net,
    timestamp: getCurrentTimestamp(),
    results,
    limitado: rango.limitado,
    cidrEscaneado: rango.cidrEscaneado,
  };
  return {
    results,
    cached: false,
    limitado: rango.limitado,
    cidrEscaneado: rango.cidrEscaneado,
  };
}
