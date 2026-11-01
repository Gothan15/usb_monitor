import { runPowershell } from "winrm-client";
import fs from "fs";
import path from "path";
import os from "os";
import type { ProgressCallback, SSHOperationResult } from "./sshService";

// ──────────────────────────────────────────────
//  WinRM Service — Instalación remota vía WinRM (WS-Man)
//  Espejo de sshService.ts: mismas etapas de progreso y mismo
//  contrato de resultado, para que la ruta y el diálogo traten
//  ambos protocolos igual.
//
//  Transporte: WS-Man sobre HTTP (5985) o HTTPS (5986) usando
//  `winrm-client` (autenticación Basic para usuarios locales y
//  NTLM/Negotiate para cuentas de dominio DOMAIN\user o UPN).
//
//  Requisitos en el equipo destino (una sola vez):
//    winrm quickconfig
//    winrm set winrm/config/service/Auth '@{Basic="true";Negotiate="true"}'
//    winrm set winrm/config/service '@{AllowUnencrypted="true"}'   (solo HTTP)
// ──────────────────────────────────────────────

export const DEFAULT_WINRM_PORT = 5985;
const CONNECT_TIMEOUT_MS = 15_000;
const OPERATION_TIMEOUT_MS = 120_000;
const CHUNK_TIMEOUT_MS = 60_000;

// Trozo de archivo por llamada WS-Man. El límite por defecto del sobre
// SOAP (MaxEnvelopeSizekb) es 500 KB; 48 KB binarios ≈ 64 KB en base64,
// muy por debajo del límite y con progreso visible en archivos grandes.
const UPLOAD_CHUNK_BYTES = 48 * 1024;

const SERVICE_NAME = process.env.AGENT_SERVICE_NAME || "USBMonitorService";
const REMOTE_PATH = process.env.AGENT_REMOTE_PATH || "C:\\USBMonitor";

// Mismos archivos que copia el flujo SSH
const LOCAL_FILES = [
  path.join(process.cwd(), "USBMonitor", "dist", "USBMonitorService.exe"),
  path.join(process.cwd(), "USBMonitor", "Install-Service.ps1"),
];

/* ── Tipos ── */

export interface WinRMCredentials {
  host: string;
  username: string;
  password?: string;
  /** Puerto WinRM. Por defecto 5985 (HTTP). */
  port?: number;
  /** true para HTTPS (5986). Por defecto false. */
  useHttps?: boolean;
  /** Token por equipo (fase 3): se entrega al agente en la instalación. */
  agentToken?: string;
}

export interface WinRMServiceStatus {
  /** El endpoint WS-Man respondió a la operación Identify. */
  reachable: boolean;
  installed: boolean | null;
  running: boolean | null;
  /** Estado crudo de Get-Service: Running, Stopped, … */
  status: string | null;
  error?: string;
}

export interface WinRMProbeResult {
  available: boolean;
  protocolVersion: string | null;
  productVersion: string | null;
  /** Métodos de autenticación anunciados si el endpoint respondió 401. */
  auth: string | null;
  error?: string;
}

export type { ProgressCallback, SSHOperationResult as WinRMOperationResult };

/* ── Helpers ── */

function withTimeout<T>(
  promise: Promise<T>,
  ms: number,
  label: string,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`Timeout ${label} (${ms}ms)`)),
      ms,
    );
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

/** Ejecuta un script PowerShell remoto y devuelve su salida de texto. */
async function runRemoteScript(
  creds: WinRMCredentials,
  script: string,
  timeoutMs = OPERATION_TIMEOUT_MS,
): Promise<string> {
  const output = await withTimeout(
    runPowershell(
      script,
      creds.host,
      creds.username,
      creds.password ?? "",
      creds.port || DEFAULT_WINRM_PORT,
      creds.useHttps ?? false,
      // En LAN corporativa los certificados de WinRM suelen ser
      // autofirmados; no rechazarlos (mismo criterio que el
      // hostVerifier abierto del flujo SSH).
      false,
    ),
    timeoutMs,
    "ejecutando comando vía WinRM",
  );
  return typeof output === "string" ? output : String(output ?? "");
}

/** Escapa un valor para incrustarlo entre comillas simples de PowerShell. */
function psQuote(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

function getServerHost(): string {
  const envHost = process.env.APP_HOST;
  if (envHost && envHost !== "0.0.0.0" && envHost !== "::") {
    return envHost;
  }
  const interfaces = os.networkInterfaces();
  for (const entries of Object.values(interfaces)) {
    if (!entries) continue;
    for (const detail of entries) {
      if (detail.family === "IPv4" && !detail.internal) {
        return detail.address;
      }
    }
  }
  return "localhost";
}

function getServerPort(): number {
  return Number(process.env.PORT) || 3000;
}

/* ── Funciones públicas ── */

/**
 * Verifica que WinRM responda y que las credenciales sean válidas.
 */
export async function testWinRMConnection(
  creds: WinRMCredentials,
): Promise<SSHOperationResult> {
  try {
    const out = await runRemoteScript(
      creds,
      `Write-Output "__USB_HOST__$(hostname)"`,
      CONNECT_TIMEOUT_MS,
    );
    const hostLine = out
      .split(/\r?\n/)
      .find((line) => line.includes("__USB_HOST__"));
    return {
      success: true,
      message: hostLine
        ? `Conexión WinRM exitosa (${hostLine.replace("__USB_HOST__", "").trim()})`
        : "Conexión WinRM exitosa",
    };
  } catch (error: any) {
    return { success: false, message: describeWinRMError(error) };
  }
}

/**
 * Copia los archivos del servicio a la máquina remota vía WinRM.
 * WinRM no tiene transferencia de archivos nativa: se sube cada archivo
 * en trozos base64 que PowerShell va anexando a un `.part`, y al final
 * se renombra y se verifica el tamaño contra el original.
 */
export async function copyFilesViaWinRM(
  creds: WinRMCredentials,
  onProgress?: ProgressCallback,
): Promise<SSHOperationResult> {
  try {
    // Verificar archivos locales existen
    for (const localFile of LOCAL_FILES) {
      if (!fs.existsSync(localFile)) {
        return {
          success: false,
          message: `Archivo local no encontrado: ${path.basename(localFile)}`,
          details: `Ruta esperada: ${localFile}`,
        };
      }
    }

    onProgress?.("connecting", "Conectando vía WinRM...");
    await runRemoteScript(
      creds,
      `Write-Output "__USB_HOST__$(hostname)"`,
      CONNECT_TIMEOUT_MS,
    );

    // Crear directorio remoto
    onProgress?.("mkdir", `Creando directorio ${REMOTE_PATH}...`);
    await runRemoteScript(
      creds,
      `if (-not (Test-Path ${psQuote(REMOTE_PATH)})) { New-Item -ItemType Directory -Path ${psQuote(REMOTE_PATH)} -Force | Out-Null }; Write-Output '__USB_OK__'`,
    );

    // Copiar archivos por trozos
    for (let i = 0; i < LOCAL_FILES.length; i++) {
      const localFile = LOCAL_FILES[i];
      const fileName = path.basename(localFile);
      const remoteFile = `${REMOTE_PATH}\\${fileName}`;
      const partFile = `${remoteFile}.part`;
      const totalBytes = fs.statSync(localFile).size;
      const totalChunks = Math.max(1, Math.ceil(totalBytes / UPLOAD_CHUNK_BYTES));

      onProgress?.(
        "uploading",
        `Copiando ${fileName}... (${i + 1}/${LOCAL_FILES.length})`,
      );

      // Empezar de cero el .part
      await runRemoteScript(
        creds,
        `if (Test-Path ${psQuote(partFile)}) { Remove-Item ${psQuote(partFile)} -Force }; Write-Output '__USB_OK__'`,
        CHUNK_TIMEOUT_MS,
      );

      const handle = await fs.promises.open(localFile, "r");
      try {
        const buffer = Buffer.alloc(UPLOAD_CHUNK_BYTES);
        let chunkIndex = 0;
        let bytesReadTotal = 0;
        for (;;) {
          const { bytesRead } = await handle.read(
            buffer,
            0,
            UPLOAD_CHUNK_BYTES,
            null,
          );
          if (bytesRead === 0) break;
          bytesReadTotal += bytesRead;
          chunkIndex += 1;
          const base64 = buffer.subarray(0, bytesRead).toString("base64");
          await runRemoteScript(
            creds,
            `$bytes = [Convert]::FromBase64String('${base64}'); [System.IO.File]::AppendAllBytes(${psQuote(partFile)}, $bytes); Write-Output '__USB_OK__'`,
            CHUNK_TIMEOUT_MS,
          );
          onProgress?.(
            "uploading",
            `Copiando ${fileName}... ${Math.round(
              (chunkIndex / totalChunks) * 100,
            )}%`,
          );
        }
      } finally {
        await handle.close();
      }

      // Renombrar y verificar tamaño
      const verifyOut = await runRemoteScript(
        creds,
        `Move-Item -Path ${psQuote(partFile)} -Destination ${psQuote(remoteFile)} -Force; Write-Output "__USB_SIZE__$((Get-Item ${psQuote(remoteFile)}).Length)"`,
        CHUNK_TIMEOUT_MS,
      );
      const sizeLine = verifyOut
        .split(/\r?\n/)
        .find((line) => line.includes("__USB_SIZE__"));
      const remoteSize = sizeLine
        ? Number(sizeLine.replace("__USB_SIZE__", "").trim())
        : NaN;
      if (!Number.isFinite(remoteSize) || remoteSize !== totalBytes) {
        return {
          success: false,
          message: `La copia de ${fileName} quedó incompleta`,
          details: `Tamaño local ${totalBytes} bytes, remoto ${
            Number.isFinite(remoteSize) ? `${remoteSize} bytes` : "desconocido"
          }`,
        };
      }
    }

    onProgress?.("done", "Archivos copiados exitosamente");
    return {
      success: true,
      message: "Archivos copiados exitosamente",
      details: `${LOCAL_FILES.length} archivo(s) copiados a ${REMOTE_PATH}`,
    };
  } catch (error: any) {
    return {
      success: false,
      message: describeWinRMError(error),
      details: error?.message,
    };
  }
}

/**
 * Instala y arranca el servicio USBMonitor en la máquina remota vía WinRM.
 * Requiere haber copiado antes los archivos con `copyFilesViaWinRM`.
 * Mismos pasos que el flujo SSH.
 */
export async function installServiceViaWinRM(
  creds: WinRMCredentials,
  onProgress?: ProgressCallback,
): Promise<SSHOperationResult> {
  try {
    const serverHost = getServerHost();
    const serverPort = getServerPort();

    onProgress?.("connecting", "Conectando vía WinRM...");
    await runRemoteScript(
      creds,
      `Write-Output "__USB_HOST__$(hostname)"`,
      CONNECT_TIMEOUT_MS,
    );

    // 1. Detener servicio existente si lo hay (ignorar errores)
    onProgress?.("cleanup", "Verificando servicio existente...");
    await runRemoteScript(
      creds,
      `Stop-Service -Name ${psQuote(SERVICE_NAME)} -Force -ErrorAction SilentlyContinue; sc.exe delete ${SERVICE_NAME} | Out-Null; Write-Output '__USB_OK__'`,
      30_000,
    ).catch(() => {});

    // 2. Ejecutar Install-Service.ps1 en un proceso PowerShell propio
    //    (igual que en SSH) para que un `exit` del script no cierre la sesión.
    onProgress?.("installing", "Ejecutando instalación del servicio...");
    const installOut = await runRemoteScript(
      creds,
      `powershell -NoLogo -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "${REMOTE_PATH}\\Install-Service.ps1" -Action install -ServerHost ${serverHost} -ServerPort ${serverPort}${creds.agentToken ? ` -AgentToken ${creds.agentToken}` : ""}; Write-Output "__USB_EXIT__$LASTEXITCODE"`,
      OPERATION_TIMEOUT_MS,
    );
    const exitLine = installOut
      .split(/\r?\n/)
      .find((line) => line.includes("__USB_EXIT__"));
    const exitCode = exitLine
      ? Number(exitLine.replace("__USB_EXIT__", "").trim())
      : NaN;
    if (!Number.isFinite(exitCode) || exitCode !== 0) {
      const errOutput = installOut
        .split(/\r?\n/)
        .filter((line) => !line.includes("__USB_EXIT__"))
        .join("\n")
        .trim();
      return {
        success: false,
        message: "Error al instalar el servicio",
        details:
          errOutput ||
          (Number.isFinite(exitCode)
            ? `Código de salida: ${exitCode}`
            : "El script de instalación no devolvió código de salida"),
      };
    }

    // 3. Verificar que el servicio está corriendo
    onProgress?.("verifying", "Verificando estado del servicio...");
    let status = await queryServiceStatus(creds);

    if (status !== "running") {
      // Intentar iniciar manualmente
      onProgress?.("starting", "Iniciando servicio manualmente...");
      await runRemoteScript(
        creds,
        `Start-Service -Name ${psQuote(SERVICE_NAME)} -ErrorAction SilentlyContinue; Write-Output '__USB_OK__'`,
        30_000,
      ).catch(() => {});
      status = await queryServiceStatus(creds);
      if (status !== "running") {
        return {
          success: false,
          message: "El servicio se instaló pero no arrancó",
          details: `Estado: ${status || "desconocido"}`,
        };
      }
    }

    onProgress?.("done", "Servicio instalado y ejecutándose");
    return {
      success: true,
      message: "Servicio USBMonitor instalado y ejecutándose",
      details: `Servidor: ${serverHost}:${serverPort}`,
    };
  } catch (error: any) {
    return {
      success: false,
      message: describeWinRMError(error),
      details: error?.message,
    };
  }
}

/** Estado crudo del servicio vía WinRM: "running", "stopped", "" si no existe. */
async function queryServiceStatus(
  creds: WinRMCredentials,
): Promise<string> {
  const out = await runRemoteScript(
    creds,
    `$s = Get-Service -Name ${psQuote(SERVICE_NAME)} -ErrorAction SilentlyContinue; if ($null -eq $s) { Write-Output '__USB_STATUS__' } else { Write-Output "__USB_STATUS__$($s.Status)" }`,
    30_000,
  );
  const line = out
    .split(/\r?\n/)
    .find((l) => l.includes("__USB_STATUS__"));
  return line ? line.replace("__USB_STATUS__", "").trim().toLowerCase() : "";
}

/**
 * Estado completo del servicio en un equipo vía WinRM (con credenciales).
 */
export async function getServiceStatusViaWinRM(
  creds: WinRMCredentials,
): Promise<WinRMServiceStatus> {
  try {
    const status = await queryServiceStatus(creds);
    return {
      reachable: true,
      installed: status !== "",
      running: status === "running",
      status: status || null,
    };
  } catch (error: any) {
    return {
      reachable: false,
      installed: null,
      running: null,
      status: null,
      error: describeWinRMError(error),
    };
  }
}

/**
 * Sonda WS-Man sin credenciales: la operación Identify de WS-Man no
 * requiere autenticación, así que permite saber si un equipo tiene el
 * listener WinRM activo y qué versión de protocolo habla, sin conocer
 * ninguna contraseña. Es lo máximo que se puede afirmar del estado
 * WinRM de un host sin credenciales (refresh-host solo recibe la IP).
 */
export async function probeWinRM(
  host: string,
  port: number = DEFAULT_WINRM_PORT,
  useHttps = false,
  timeoutMs = 2_500,
): Promise<WinRMProbeResult> {
  const url = `${useHttps ? "https" : "http"}://${host}:${port}/wsman`;
  const envelope =
    `<?xml version="1.0" encoding="UTF-8"?>` +
    `<s:Envelope xmlns:s="http://www.w3.org/2003/05/soap-envelope" ` +
    `xmlns:wsmid="http://schemas.dmtf.org/wbem/wsman/identity/1/wsmanidentity.xsd">` +
    `<s:Header/><s:Body><wsmid:Identify/></s:Body></s:Envelope>`;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/soap+xml;charset=UTF-8",
      },
      body: envelope,
      signal: controller.signal,
    });
    const text = await res.text().catch(() => "");

    const protocolVersion = text.match(
      /<wsmid:ProtocolVersion>([^<]+)<\/wsmid:ProtocolVersion>/,
    )?.[1];
    const productVersion = text.match(
      /<wsmid:ProductVersion>([^<]+)<\/wsmid:ProductVersion>/,
    )?.[1];

    if (protocolVersion) {
      return {
        available: true,
        protocolVersion,
        productVersion: productVersion ?? null,
        auth: null,
      };
    }
    if (res.status === 401) {
      // El listener está vivo pero exige autenticación incluso para
      // Identify (configuración endurecida): también es «disponible».
      return {
        available: true,
        protocolVersion: null,
        productVersion: null,
        auth: res.headers.get("www-authenticate"),
      };
    }
    return {
      available: false,
      protocolVersion: null,
      productVersion: null,
      auth: null,
      error: `Respuesta inesperada del endpoint WS-Man (HTTP ${res.status})`,
    };
  } catch (error: any) {
    return {
      available: false,
      protocolVersion: null,
      productVersion: null,
      auth: null,
      error:
        error?.name === "AbortError"
          ? "Sin respuesta del listener WinRM (timeout)"
          : describeWinRMError(error),
    };
  } finally {
    clearTimeout(timer);
  }
}

/* ── Descripciones de error ── */

function describeWinRMError(error: any): string {
  const causeCode = error?.cause?.code || error?.code || "";
  const msg = `${error?.message || String(error)} ${causeCode}`;

  if (msg.includes("Timeout")) {
    return "Timeout: no se pudo conectar vía WinRM. Verifica que el servicio WinRM esté iniciado en el equipo destino (winrm quickconfig) y que el puerto 5985 esté permitido en el firewall.";
  }
  if (
    /401|unauthori[sz]ed|authentication/i.test(msg) &&
    !msg.includes("ECONN")
  ) {
    return "Autenticación WinRM fallida. Verifica el usuario y la contraseña, y que el servicio WinRM tenga habilitados Basic (usuarios locales) o Negotiate/NTLM (cuentas de dominio).";
  }
  if (msg.includes("ECONNREFUSED")) {
    return "Conexión rechazada. WinRM no está escuchando en el equipo destino: ejecútalo con «winrm quickconfig» en una consola de administrador.";
  }
  if (msg.includes("ECONNRESET") || msg.includes("ETIMEDOUT")) {
    return "No se pudo alcanzar el equipo vía WinRM. Verifica que esté encendido y accesible en la red.";
  }
  if (msg.includes("EHOSTUNREACH")) {
    return "Equipo inaccesible. Verifica la dirección IP y la conectividad de red.";
  }
  if (msg.includes("Unable to extract shell ID")) {
    return "El equipo respondió, pero no se pudo abrir una sesión WinRM válida. Verifica que el servicio WinRM esté completo y operativo (winrm quickconfig) y que ningún proxy o firewall esté interceptando el puerto.";
  }
  if (/envelope|MaxEnvelope/i.test(msg)) {
    return "Respuesta WinRM demasiado grande. Aumenta el MaxEnvelopeSizekb del servicio WinRM en el equipo destino.";
  }
  return `Error WinRM: ${msg}`;
}
