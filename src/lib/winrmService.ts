import { exec } from "child_process";
import util from "util";
import { isValidIPv4 } from "./validators";

const execAsync = util.promisify(exec);

interface WinRMResult {
  success: boolean;
  stdout?: string;
  stderr?: string;
  message?: string;
}

function getCreds() {
  const user = process.env.WINRM_USER;
  const pass = process.env.WINRM_PASS;
  if (!user || !pass) {
    throw new Error("Variables de entorno WINRM_USER y WINRM_PASS requeridas");
  }
  return { user, pass };
}

function psEscape(val: string) {
  return val.replace(/`/g, "``").replace(/"/g, '`"');
}

async function runPs(command: string): Promise<WinRMResult> {
  try {
    const { stdout, stderr } = await execAsync(
      `powershell -NoLogo -NoProfile -NonInteractive -ExecutionPolicy Bypass -Command "${command}"`
    );
    return { success: true, stdout, stderr };
  } catch (e: any) {
    return {
      success: false,
      stdout: e.stdout,
      stderr: e.stderr,
      message: e.message,
    };
  }
}

function buildCredentialScript(user: string, pass: string) {
  // SecureString in-memory only
  return `$sec = ConvertTo-SecureString \"${psEscape(
    pass
  )}\" -AsPlainText -Force; $cred = New-Object System.Management.Automation.PSCredential(\"${psEscape(
    user
  )}\", $sec);`;
}

async function invokeRemote(ip: string, scriptBlock: string) {
  if (!isValidIPv4(ip)) {
    return { success: false, message: "Dirección IP inválida" };
  }
  const { user, pass } = getCreds();
  const cred = buildCredentialScript(user, pass);
  const cmd = `${cred} Invoke-Command -ComputerName "${ip}" -Credential $cred -ScriptBlock { ${scriptBlock} }`;
  return runPs(cmd);
}

// --- Acciones de servicio ---
const SERVICE_NAME = process.env.AGENT_SERVICE_NAME || "USBMonitor";
const REMOTE_PATH = process.env.AGENT_REMOTE_PATH || "C:\\USBMonitor";
const LOCAL_AGENT_EXE = process.env.AGENT_LOCAL_EXE || "dist/USBMonitor.exe";

export async function remoteStatus(ip: string) {
  return invokeRemote(ip, `sc.exe query ${SERVICE_NAME}`);
}

export async function remoteStart(ip: string) {
  return invokeRemote(ip, `sc.exe start ${SERVICE_NAME}`);
}

export async function remoteStop(ip: string) {
  return invokeRemote(ip, `sc.exe stop ${SERVICE_NAME}`);
}

export async function remoteUninstall(ip: string) {
  // Intentar detener y luego eliminar
  return invokeRemote(
    ip,
    `sc.exe stop ${SERVICE_NAME} | Out-Null; sc.exe delete ${SERVICE_NAME}`
  );
}

export async function remoteInstall(ip: string) {
  if (!isValidIPv4(ip)) {
    return { success: false, message: "Dirección IP inválida" };
  }
  // Copiar ejecutable y registrar servicio si no existe
  // Nota: Requiere que WinRM permita copia de archivos vía New-PSSession + Copy-Item
  const { user, pass } = getCreds();
  const cred = buildCredentialScript(user, pass);
  const exeName = LOCAL_AGENT_EXE.split(/[/\\]/).pop();
  const script = `
${cred}
if (-not (Test-Path '${REMOTE_PATH}')) { New-Item -ItemType Directory -Path '${REMOTE_PATH}' | Out-Null }
$sess = New-PSSession -ComputerName "${ip}" -Credential $cred
Copy-Item -Path \"${LOCAL_AGENT_EXE}\" -Destination \"${REMOTE_PATH}\\${exeName}\" -ToSession $sess -Force
Invoke-Command -Session $sess -ScriptBlock { sc.exe create ${SERVICE_NAME} binPath= '${REMOTE_PATH}\\${exeName} --console' start= auto } | Out-Null
Invoke-Command -Session $sess -ScriptBlock { sc.exe start ${SERVICE_NAME} } | Out-Null
Remove-PSSession $sess
"Instalación completada"
  `;
  return runPs(script.replace(/\n+/g, "; "));
}

export function summarize(result: WinRMResult, action: string) {
  if (result.success) {
    const output = (result.stdout || "").trim();
    let serviceInstalled: boolean | undefined;
    let serviceRunning: boolean | undefined;
    if (
      action === "status" ||
      action === "start" ||
      action === "stop" ||
      action === "install"
    ) {
      // Parse heurístico del resultado de sc.exe
      const upper = output.toUpperCase();
      if (upper.includes("FAILED") || upper.includes("NO INSTANCE")) {
        serviceInstalled = false;
        serviceRunning = false;
      } else if (upper.includes("SERVICE_NAME")) {
        serviceInstalled = true;
        if (upper.includes("STATE")) {
          if (upper.includes("RUNNING")) serviceRunning = true;
          else serviceRunning = false;
        }
      }
    }
    return { success: true, action, output, serviceInstalled, serviceRunning };
  }
  return {
    success: false,
    action,
    error: result.message,
    stderr: result.stderr,
  };
}
