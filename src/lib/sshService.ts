import { Client, SFTPWrapper } from "ssh2";
import fs from "fs";
import path from "path";
import os from "os";

// ──────────────────────────────────────────────
//  SSH Service — Instalación remota vía SSH/SCP
// ──────────────────────────────────────────────

const DEFAULT_SSH_PORT = 22;
const CONNECT_TIMEOUT_MS = 10_000;
const OPERATION_TIMEOUT_MS = 120_000;

const SERVICE_NAME = process.env.AGENT_SERVICE_NAME || "USBMonitorService";
const REMOTE_PATH = process.env.AGENT_REMOTE_PATH || "C:\\USBMonitor";

// Archivos locales a copiar (relativos a CWD del servidor)
const LOCAL_FILES = [
  path.join(process.cwd(), "USBMonitor", "dist", "USBMonitorService.exe"),
  path.join(process.cwd(), "USBMonitor", "Install-Service.ps1"),
];

/* ── Tipos ── */

export interface SSHCredentials {
  host: string;
  username: string;
  password?: string;
  port?: number;
  /** Token por equipo (fase 3): se entrega al agente en la instalación. */
  agentToken?: string;
}

export interface SSHOperationResult {
  success: boolean;
  message: string;
  details?: string;
}

export type ProgressCallback = (stage: string, detail?: string) => void;

/* ── Helpers ── */

function createClient(creds: SSHCredentials): Promise<Client> {
  return new Promise((resolve, reject) => {
    const client = new Client();
    const timer = setTimeout(() => {
      client.end();
      reject(new Error("Timeout al conectar vía SSH"));
    }, CONNECT_TIMEOUT_MS);

    const pw = creds.password ?? "";

    client
      .on("ready", () => {
        clearTimeout(timer);
        resolve(client);
      })
      .on("error", (err) => {
        clearTimeout(timer);
        reject(new Error(`Error SSH: ${err.message}`));
      });

    // Manejar autenticación keyboard-interactive (para usuarios sin contraseña
    // o servidores que requieran este método)
    (client as any).on(
      "keyboard-interactive",
      (
        _name: string,
        _instructions: string,
        _instructionsLang: string,
        _prompts: Array<{ prompt: string; echo: boolean }>,
        finish: (responses: string[]) => void
      ) => {
        finish([pw]);
      }
    );

    client.connect({
      host: creds.host,
      port: creds.port || DEFAULT_SSH_PORT,
      username: creds.username,
      password: pw,
      tryKeyboard: true,
      readyTimeout: CONNECT_TIMEOUT_MS,
      // Auto-accept host keys (entorno LAN corporativo)
      hostVerifier: () => true,
    });
  });
}

function getSFTP(client: Client): Promise<SFTPWrapper> {
  return new Promise((resolve, reject) => {
    client.sftp((err, sftp) => {
      if (err) reject(new Error(`Error SFTP: ${err.message}`));
      else resolve(sftp);
    });
  });
}

function sftpMkdir(sftp: SFTPWrapper, remotePath: string): Promise<void> {
  return new Promise((resolve, reject) => {
    sftp.mkdir(remotePath, (err) => {
      // Ignorar error si el directorio ya existe
      if (err && (err as any).code !== 4) {
        reject(new Error(`Error al crear directorio: ${err.message}`));
      } else {
        resolve();
      }
    });
  });
}

function sftpUpload(
  sftp: SFTPWrapper,
  localPath: string,
  remotePath: string
): Promise<void> {
  return new Promise((resolve, reject) => {
    const readStream = fs.createReadStream(localPath);
    const writeStream = sftp.createWriteStream(remotePath);

    writeStream.on("close", () => resolve());
    writeStream.on("error", (err: Error) =>
      reject(new Error(`Error al subir ${path.basename(localPath)}: ${err.message}`))
    );
    readStream.on("error", (err: Error) =>
      reject(new Error(`Error al leer ${path.basename(localPath)}: ${err.message}`))
    );

    readStream.pipe(writeStream);
  });
}

function execRemote(
  client: Client,
  command: string,
  timeoutMs = OPERATION_TIMEOUT_MS
): Promise<{ stdout: string; stderr: string; code: number }> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`Timeout ejecutando comando remoto (${timeoutMs}ms)`));
    }, timeoutMs);

    client.exec(command, (err, stream) => {
      if (err) {
        clearTimeout(timer);
        reject(new Error(`Error exec: ${err.message}`));
        return;
      }

      let stdout = "";
      let stderr = "";

      stream
        .on("close", (code: number) => {
          clearTimeout(timer);
          resolve({ stdout, stderr, code: code ?? 0 });
        })
        .on("data", (data: Buffer) => {
          stdout += data.toString();
        })
        .stderr.on("data", (data: Buffer) => {
          stderr += data.toString();
        });
    });
  });
}

function getServerHost(): string {
  const envHost = process.env.APP_HOST;
  if (envHost && envHost !== "0.0.0.0" && envHost !== "::") {
    return envHost;
  }
  // Auto-detect from network interfaces
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

/* ── Funciones Públicas ── */

/**
 * Verifica que la conexión SSH sea válida.
 */
export async function testSSHConnection(
  creds: SSHCredentials
): Promise<SSHOperationResult> {
  let client: Client | null = null;
  try {
    client = await createClient(creds);
    return { success: true, message: "Conexión SSH exitosa" };
  } catch (error: any) {
    return {
      success: false,
      message: describeSSHError(error),
    };
  } finally {
    client?.end();
  }
}

/**
 * Copia los archivos del servicio a la máquina remota vía SFTP.
 */
export async function copyFilesViaSSH(
  creds: SSHCredentials,
  onProgress?: ProgressCallback
): Promise<SSHOperationResult> {
  let client: Client | null = null;
  try {
    onProgress?.("connecting", "Conectando vía SSH...");
    client = await createClient(creds);

    onProgress?.("sftp", "Iniciando transferencia SFTP...");
    const sftp = await getSFTP(client);

    // Crear directorio remoto
    onProgress?.("mkdir", `Creando directorio ${REMOTE_PATH}...`);
    await sftpMkdir(sftp, REMOTE_PATH);

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

    // Copiar archivos
    for (let i = 0; i < LOCAL_FILES.length; i++) {
      const localFile = LOCAL_FILES[i];
      const fileName = path.basename(localFile);
      const remoteFile = `${REMOTE_PATH}\\${fileName}`;
      onProgress?.(
        "uploading",
        `Copiando ${fileName}... (${i + 1}/${LOCAL_FILES.length})`
      );
      await sftpUpload(sftp, localFile, remoteFile);
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
      message: describeSSHError(error),
      details: error?.message,
    };
  } finally {
    client?.end();
  }
}

/**
 * Instala y arranca el servicio USBMonitor en la máquina remota.
 * Requires files already copied via `copyFilesViaSSH`.
 */
export async function installServiceViaSSH(
  creds: SSHCredentials,
  onProgress?: ProgressCallback
): Promise<SSHOperationResult> {
  let client: Client | null = null;
  try {
    const serverHost = getServerHost();
    const serverPort = getServerPort();

    onProgress?.("connecting", "Conectando vía SSH...");
    client = await createClient(creds);

    // 1. Detener servicio existente si lo hay (ignorar errores)
    onProgress?.("cleanup", "Verificando servicio existente...");
    await execRemote(
      client,
      `powershell -NoLogo -NoProfile -NonInteractive -Command "Stop-Service -Name '${SERVICE_NAME}' -Force -ErrorAction SilentlyContinue; sc.exe delete '${SERVICE_NAME}' 2>$null"`,
      30_000
    ).catch(() => {});

    // 2. Ejecutar Install-Service.ps1
    onProgress?.("installing", "Ejecutando instalación del servicio...");
    const installCmd = `powershell -NoLogo -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "${REMOTE_PATH}\\Install-Service.ps1" -Action install -ServerHost ${serverHost} -ServerPort ${serverPort}${creds.agentToken ? ` -AgentToken ${creds.agentToken}` : ""}`;
    const installResult = await execRemote(client, installCmd, OPERATION_TIMEOUT_MS);

    if (installResult.code !== 0) {
      const errOutput = (installResult.stderr || installResult.stdout || "").trim();
      return {
        success: false,
        message: "Error al instalar el servicio",
        details: errOutput || `Código de salida: ${installResult.code}`,
      };
    }

    // 3. Verificar que el servicio está corriendo
    onProgress?.("verifying", "Verificando estado del servicio...");
    const statusResult = await execRemote(
      client,
      `powershell -NoLogo -NoProfile -NonInteractive -Command "(Get-Service -Name '${SERVICE_NAME}' -ErrorAction SilentlyContinue).Status"`,
      15_000
    );

    const serviceStatus = statusResult.stdout.trim().toLowerCase();
    const isRunning = serviceStatus === "running";

    if (!isRunning) {
      // Intentar iniciar manualmente
      onProgress?.("starting", "Iniciando servicio manualmente...");
      await execRemote(
        client,
        `powershell -NoLogo -NoProfile -NonInteractive -Command "Start-Service -Name '${SERVICE_NAME}'"`,
        15_000
      );

      // Re-verificar
      const recheck = await execRemote(
        client,
        `powershell -NoLogo -NoProfile -NonInteractive -Command "(Get-Service -Name '${SERVICE_NAME}' -ErrorAction SilentlyContinue).Status"`,
        10_000
      );
      const recheckStatus = recheck.stdout.trim().toLowerCase();
      if (recheckStatus !== "running") {
        return {
          success: false,
          message: "El servicio se instaló pero no arrancó",
          details: `Estado: ${recheckStatus || "desconocido"}`,
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
      message: describeSSHError(error),
      details: error?.message,
    };
  } finally {
    client?.end();
  }
}

/* ── Error descriptions ── */

function describeSSHError(error: any): string {
  const msg = error?.message || String(error);
  const level = error?.level;

  if (msg.includes("Timeout")) {
    return "Timeout: no se pudo conectar al equipo. Verifica que el servidor SSH esté habilitado y el firewall lo permita.";
  }
  if (
    msg.includes("All configured authentication methods failed") ||
    level === "client-authentication"
  ) {
    return "Autenticación fallida. Verifica el usuario y la contraseña. Si el usuario no tiene contraseña, asegúrate de que el servidor SSH permita contraseñas vacías (PermitEmptyPasswords yes en sshd_config).";
  }
  if (msg.includes("ECONNREFUSED")) {
    return "Conexión rechazada. Verifica que OpenSSH Server esté habilitado en el equipo destino.";
  }
  if (msg.includes("ECONNRESET") || msg.includes("ETIMEDOUT")) {
    return "No se pudo alcanzar el equipo. Verifica que esté encendido y accesible en la red.";
  }
  if (msg.includes("EHOSTUNREACH")) {
    return "Equipo inaccesible. Verifica la dirección IP y la conectividad de red.";
  }
  return `Error SSH: ${msg}`;
}

// Progreso en tiempo real: los callbacks onProgress de este módulo se
// reenvían al cliente como eventos SSE desde /api/remote-install cuando
// la llamada trae `stream: true` (ver route.ts de remote-install).
