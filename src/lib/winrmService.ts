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
//  Requisitos en el equipo destino (una sola vez, como
//  administrador local, en una red SIN dominio):
//    Enable-PSRemoting -SkipNetworkProfileCheck -Force
//      (servicio en automático, listener 5985, excepción de
//      firewall y LocalAccountTokenFilterPolicy=1 — sin esto
//      último el admin local entra recortado por UAC y todo da
//      «Access is denied»; el modificador salta el fallo que
//      provoca un adaptador en perfil de red Público)
//    winrm set winrm/config/service/Auth '@{Basic="true";Negotiate="true"}'
//    winrm set winrm/config/service '@{AllowUnencrypted="true"}'   (solo HTTP con Basic)
//  Y la cuenta que se usa debe ser administradora local CON
//  contraseña: sin contraseña no hay remoting en grupo de trabajo.
//  La función checkWinRMRequirements comprueba todo esto en vivo.
// ──────────────────────────────────────────────

export const DEFAULT_WINRM_PORT = 5985;
const CONNECT_TIMEOUT_MS = 15_000;
const OPERATION_TIMEOUT_MS = 120_000;
const CHUNK_TIMEOUT_MS = 60_000;

// Trozo de archivo por llamada WS-Man. El sobre SOAP por defecto
// (MaxEnvelopeSizekb) es 500 KB: sin tocar el destino se sube en
// trozos de 192 KB binarios (256 KB en base64, con margen). Al
// empezar la copia se intenta subir el sobre del destino a
// 8192 KB y entonces el trozo pasa a 1 MB: el exe autocontenido
// del agente en C# pesa ~163 MB y con los trozos antiguos de
// 48 KB hacían falta más de 3.400 viajes WS-Man.
const UPLOAD_CHUNK_BYTES = 1024 * 1024;
const UPLOAD_CHUNK_FALLBACK_BYTES = 192 * 1024;

const SERVICE_NAME = process.env.AGENT_SERVICE_NAME || "USBMonitorService";
const REMOTE_PATH = process.env.AGENT_REMOTE_PATH || "C:\\USBMonitor";

// Archivos del agente ACTUAL (el de C#, en USBMonitorCS): su exe
// autocontenido publicado y su Install-Service.ps1, que acepta la
// misma interfaz (-ServerHost/-ServerPort/-AgentToken/-Action) y
// delega el registro en el propio exe. Antes se copiaban el exe y
// el script del agente Python (USBMonitor/dist + USBMonitor/), que
// en una copia limpia del repo ni siquiera existen.
const LOCAL_FILES = [
  path.join(
    process.cwd(),
    "USBMonitorCS",
    "dist",
    "USBMonitorService.exe",
  ),
  path.join(process.cwd(), "USBMonitorCS", "Install-Service.ps1"),
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

    // Sobre SOAP grande en el destino para poder subir en trozos
    // de 1 MB (ver la nota de UPLOAD_CHUNK_BYTES). Es lo mejor que
    // se puede intentar: si la cuenta no puede tocar la config de
    // WinRM, se sigue con el trozo pequeño que cabe en el sobre
    // por defecto.
    let chunkBytes = UPLOAD_CHUNK_FALLBACK_BYTES;
    try {
      await runRemoteScript(
        creds,
        `winrm set winrm/config '@{MaxEnvelopeSizekb="8192"}' | Out-Null; Write-Output '__USB_OK__'`,
        CONNECT_TIMEOUT_MS,
      );
      chunkBytes = UPLOAD_CHUNK_BYTES;
    } catch {
      // Sin sobre grande: trozo de reserva.
    }

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
      const totalChunks = Math.max(1, Math.ceil(totalBytes / chunkBytes));

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
        const buffer = Buffer.alloc(chunkBytes);
        let chunkIndex = 0;
        let bytesReadTotal = 0;
        for (;;) {
          const { bytesRead } = await handle.read(
            buffer,
            0,
            chunkBytes,
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

/* ── Comprobación previa de requisitos (solo WinRM) ─────────── */

export interface RequisitoWinRM {
  id: string;
  etiqueta: string;
  /** true = cumple; false = bloquea la instalación. */
  ok: boolean;
  detalle: string;
  /** Qué hacer en el destino cuando no cumple. */
  consejo?: string;
}

export interface WinRMRequirementsResult extends SSHOperationResult {
  checks: RequisitoWinRM[];
}

const CONSEJO_ENABLE_PSREMOTING =
  "En el equipo destino, como administrador local: Enable-PSRemoting -SkipNetworkProfileCheck -Force";

/**
 * Comprueba EN VIVO, antes de copiar nada, si el equipo destino
 * cumple la receta de WinRM para redes sin dominio (ver la nota
 * de cabecera del archivo). Primero la sonda Identify sin
 * credenciales; si el listener vive, una sesión con las
 * credenciales dadas lee la configuración real del destino.
 */
export async function checkWinRMRequirements(
  creds: WinRMCredentials,
): Promise<WinRMRequirementsResult> {
  const checks: RequisitoWinRM[] = [];
  const port = creds.port || DEFAULT_WINRM_PORT;
  const useHttps = creds.useHttps ?? false;
  const esCuentaLocal =
    !creds.username.includes("\\") && !creds.username.includes("@");

  const sonda = await probeWinRM(creds.host, port, useHttps);
  checks.push({
    id: "listener",
    etiqueta: "WinRM responde en el destino (listener)",
    ok: sonda.available,
    detalle: sonda.available
      ? `Identify respondió${sonda.productVersion ? ` (${sonda.productVersion})` : ""} en ${creds.host}:${port}.`
      : sonda.error ||
        "Sin respuesta: servicio parado, sin listener o firewall cerrado.",
    consejo: sonda.available ? undefined : CONSEJO_ENABLE_PSREMOTING,
  });
  if (!sonda.available) {
    return {
      success: false,
      message:
        "El destino no responde por WinRM: sin listener no se puede comprobar nada más.",
      checks,
    };
  }

  let salida: string;
  try {
    salida = await runRemoteScript(
      creds,
      [
        `$identidad = [Security.Principal.WindowsIdentity]::GetCurrent()`,
        `$principal = New-Object Security.Principal.WindowsPrincipal($identidad)`,
        `Write-Output "__CHK__admin=$($principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator))"`,
        `$latfp = (Get-ItemProperty -Path 'HKLM:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Policies\\System' -Name LocalAccountTokenFilterPolicy -ErrorAction SilentlyContinue).LocalAccountTokenFilterPolicy`,
        `Write-Output "__CHK__latfp=$latfp"`,
        `$auth = (winrm get winrm/config/service/Auth) -join ' '`,
        `Write-Output "__CHK__basic=$($auth -match 'Basic\\s*=\\s*true')"`,
        `$servicioCfg = (winrm get winrm/config/service) -join ' '`,
        `Write-Output "__CHK__unenc=$($servicioCfg -match 'AllowUnencrypted\\s*=\\s*true')"`,
        `$perfil = (Get-NetConnectionProfile -ErrorAction SilentlyContinue | Select-Object -First 1).NetworkCategory`,
        `Write-Output "__CHK__perfil=$perfil"`,
      ].join("; "),
      30_000,
    );
  } catch (error: any) {
    checks.push({
      id: "credenciales",
      etiqueta: "Las credenciales abren sesión WinRM",
      ok: false,
      detalle: describeWinRMError(error),
      consejo:
        "La cuenta debe ser administradora local del destino y tener contraseña (sin contraseña no hay remoting en grupo de trabajo).",
    });
    return {
      success: false,
      message: "WinRM responde, pero las credenciales no abren sesión.",
      checks,
    };
  }

  const valor = (id: string): string => {
    const marcador = `__CHK__${id}=`;
    const linea = salida
      .split(/\r?\n/)
      .find((l) => l.includes(marcador));
    return linea
      ? linea.slice(linea.indexOf(marcador) + marcador.length).trim()
      : "";
  };
  const esTrue = (id: string) => /^true$/i.test(valor(id));

  checks.push({
    id: "credenciales",
    etiqueta: "Las credenciales abren sesión WinRM",
    ok: true,
    detalle: `Sesión abierta como ${creds.username}.`,
  });

  const adminCompleto = esTrue("admin");
  checks.push({
    id: "admin",
    etiqueta: "La sesión entra con token de administrador completo",
    ok: adminCompleto,
    detalle: adminCompleto
      ? "Instalar servicios está permitido para esta sesión."
      : "La sesión entró recortada por UAC: podrá conectar, pero no instalar servicios.",
    consejo: adminCompleto
      ? undefined
      : "Suele faltar LocalAccountTokenFilterPolicy=1 en el destino: Enable-PSRemoting lo crea en equipos sin dominio (ver el punto siguiente).",
  });

  const latfpOk = valor("latfp") === "1";
  checks.push({
    id: "latfp",
    etiqueta: "LocalAccountTokenFilterPolicy = 1 (UAC remoto)",
    ok: latfpOk || adminCompleto,
    detalle: latfpOk
      ? "Presente: los administradores locales no se filtran en remoto."
      : adminCompleto
        ? "No está en el registro, pero la sesión ya entra como administrador completo (p. ej. cuenta Administrator integrada)."
        : "Falta: el administrador local entra recortado en remoto.",
    consejo:
      latfpOk || adminCompleto ? undefined : CONSEJO_ENABLE_PSREMOTING,
  });

  if (esCuentaLocal && !useHttps) {
    const basicOk = esTrue("basic");
    checks.push({
      id: "basic",
      etiqueta: "Autenticación Basic habilitada (cuenta local por HTTP)",
      ok: basicOk,
      detalle: basicOk
        ? "El servicio WinRM acepta Basic para cuentas locales."
        : "Basic está apagado en el servicio y esta librería entra con Basic para cuentas locales.",
      consejo: basicOk
        ? undefined
        : `En el destino: winrm set winrm/config/service/Auth '@{Basic="true";Negotiate="true"}'`,
    });

    const unencOk = esTrue("unenc");
    checks.push({
      id: "unenc",
      etiqueta: "AllowUnencrypted permitido (HTTP con Basic)",
      ok: unencOk,
      detalle: unencOk
        ? "El servicio acepta contenido sin cifrar sobre HTTP."
        : "Con Basic sobre HTTP, el servicio rechaza el contenido sin cifrar.",
      consejo: unencOk
        ? undefined
        : `En el destino: winrm set winrm/config/service '@{AllowUnencrypted="true"}' (o usar HTTPS 5986)`,
    });
  } else {
    checks.push({
      id: "basic",
      etiqueta: "Autenticación Basic / AllowUnencrypted",
      ok: true,
      detalle: useHttps
        ? "Con HTTPS no hacen falta: la credencial viaja protegida por TLS."
        : "Cuenta de dominio (NTLM/Negotiate): la carga va cifrada con la clave de sesión, no hace falta Basic ni AllowUnencrypted.",
    });
  }

  const perfil = valor("perfil");
  const perfilOk = !/public/i.test(perfil);
  checks.push({
    id: "perfil",
    etiqueta: "Perfil de red del destino",
    ok: perfilOk,
    detalle: perfil
      ? `Perfil actual: ${perfil}.`
      : "No se pudo leer el perfil de red.",
    consejo: perfilOk
      ? undefined
      : "Con la red en Público, la excepción de firewall de WinRM no aplica en Windows cliente: pasa la red a Privada (Set-NetConnectionProfile -NetworkCategory Private) o habilita WinRM con -SkipNetworkProfileCheck.",
  });

  const bloqueos = checks.filter((c) => !c.ok).length;
  return {
    success: bloqueos === 0,
    message:
      bloqueos === 0
        ? "El destino cumple todos los requisitos de WinRM."
        : `Faltan ${bloqueos} requisito(s) en el destino: revisa la lista antes de instalar.`,
    checks,
  };
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
