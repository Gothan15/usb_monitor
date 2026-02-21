import os from "os";
import { exec } from "child_process";
import util from "util";
import { db } from "@/lib/db";
import { checkServiceHealth } from "@/lib/serviceNotifier";
import { getCurrentDate, getCurrentTimestamp } from "@/lib/time";
import { normalizeComputerName } from "@/lib/utils";
import { remoteInstall, summarize } from "@/lib/winrmService";

const execAsync = util.promisify(exec);

/*
  Métricas sugeridas:
  ```ts
  import { performance } from "node:perf_hooks";

  function recordScanMetrics(durationMs: number, hosts: number) {
    void fetch("/api/metrics", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "network_scan_latency_ms", value: durationMs, hosts }),
    }).catch(() => {});
  }
  ```
  Invocar `recordScanMetrics` tras `await Promise.all(workers);` para almacenar tiempos
  en Prometheus/Grafana. Similarmente instrumentar `$transaction` en Prisma usando
  `prisma.$on("query", ...)` cuando se habilite la canalización de observabilidad.
*/

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
  const ifaces = os.networkInterfaces();
  for (const name of Object.keys(ifaces)) {
    for (const net of ifaces[name] || []) {
      if (net.family === "IPv4" && !net.internal) {
        // Asumimos máscara 24 si no la tenemos (común en LANs pequeñas)
        return `${net.address}/24`;
      }
    }
  }
  return null;
}

function ipRangeFromCIDR(cidr: string): string[] {
  const [base, maskStr] = cidr.split("/");
  const mask = parseInt(maskStr, 10);
  if (mask !== 24) return [base];
  const octets = base.split(".").map(Number);
  const prefix = `${octets[0]}.${octets[1]}.${octets[2]}`;
  const ips: string[] = [];
  for (let i = 1; i < 255; i++) ips.push(`${prefix}.${i}`);
  return ips;
}

async function pingHost(ip: string, timeoutMs = 800): Promise<boolean> {
  try {
    // -n 1 un eco, -w timeout en ms (Windows). Ajustar si se despliega en Linux.
    // Cambiar a una librería ICMP (net-ping/fast-ping) si se identifica este paso como cuello de botella.
    await execAsync(`ping -n 1 -w ${timeoutMs} ${ip}`);
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
} | null = null;
const CACHE_TTL_MS = 60_000; // 60s

// Jobs async
interface ScanJob {
  id: string;
  cidr: string;
  started: number;
  finished?: number;
  progress: number;
  results: HostScanResult[];
  status: "running" | "finished" | "error";
  error?: string;
}
const jobs: Record<string, ScanJob> = {};
function newJobId() {
  return Math.random().toString(36).slice(2, 10);
}

const UPSERT_BATCH_SIZE = 25;
const JOB_TTL_MS = 5 * 60_000;

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

export function getScanJob(jobId: string) {
  return jobs[jobId];
}

export async function scanNetwork(
  cidr?: string,
  options?: { force?: boolean }
): Promise<HostScanResult[]> {
  const net = cidr || getLocalCIDR();
  if (!net) throw new Error("No se pudo determinar la red local");
  if (
    !options?.force &&
    lastScan &&
    lastScan.cidr === net &&
    getCurrentTimestamp() - lastScan.timestamp < CACHE_TTL_MS
  ) {
    return lastScan.results;
  }
  const ips = ipRangeFromCIDR(net);
  const concurrency = 30;
  const results: HostScanResult[] = [];
  const persistQueue: ComputerUpsertPayload[] = [];
  let index = 0;
  async function worker() {
    while (index < ips.length) {
      const i = index++;
      const ip = ips[i];
      const host: HostScanResult = { ip, alive: false };
      try {
        const isUp = await pingHost(ip);
        host.alive = isUp;
        if (isUp) {
          const svc = await checkService(ip);
          Object.assign(host, svc);
          const normalizedName = svc.hostname
            ? normalizeComputerName(svc.hostname)
            : "";
          const computerName = normalizedName || normalizeComputerName(ip);
          host.hostname = normalizedName || host.hostname || computerName;
          // Defer writes so Prisma only touches the database once per batch instead of per host.
          persistQueue.push({
            name: computerName,
            ip,
            lastSeenAt: getCurrentDate(),
            isActive: isUp,
            serviceInstalled: (svc as any).serviceInstalled ?? false,
            serviceRunning: (svc as any).serviceRunning ?? false,
            lastServiceCheck: (svc as any).lastServiceCheck,
          });
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
  lastScan = { cidr: net, timestamp: getCurrentTimestamp(), results };
  return results;
}

export async function remoteInstallAndStart(
  ip: string
): Promise<{ success: boolean; message: string }> {
  const result = await remoteInstall(ip);
  const summary = summarize(result, "install");
  return {
    success: summary.success,
    message: summary.success
      ? summary.output || "Instalación completada"
      : summary.error || "Error en la instalación remota",
  };
}

export function startScanJob(cidr?: string): ScanJob {
  const net = cidr || getLocalCIDR();
  if (!net) throw new Error("No se pudo determinar la red local");
  const job: ScanJob = {
    id: newJobId(),
    cidr: net,
    started: getCurrentTimestamp(),
    progress: 0,
    results: [],
    status: "running",
  };
  jobs[job.id] = job;
  const ips = ipRangeFromCIDR(net);
  const total = ips.length;
  const concurrency = 30;
  let index = 0;
  const runWorker = async () => {
    while (index < ips.length && job.status === "running") {
      const i = index++;
      const ip = ips[i];
      try {
        const alive = await pingHost(ip);
        let svc: any = {};
        if (alive) svc = await checkService(ip);
        const host: HostScanResult = { ip, alive, ...svc };
        job.results.push(host);
      } catch (e: any) {
        job.results.push({ ip, alive: false, error: e.message });
      }
      job.progress = job.results.length / total;
    }
  };
  Promise.all(Array.from({ length: concurrency }, () => runWorker()))
    .then(() => {
      job.status = "finished";
      job.finished = getCurrentTimestamp();
      lastScan = {
        cidr: job.cidr,
        timestamp: getCurrentTimestamp(),
        results: job.results,
      };
      // Auto-expire finished jobs to avoid unbounded memory growth when admins fire many scans.
      setTimeout(() => {
        delete jobs[job.id];
      }, JOB_TTL_MS).unref?.();
    })
    .catch((e) => {
      job.status = "error";
      job.error = e.message;
      job.finished = getCurrentTimestamp();
      // Ensure errored jobs also get purged after TTL.
      setTimeout(() => {
        delete jobs[job.id];
      }, JOB_TTL_MS).unref?.();
    });
  return job;
}
