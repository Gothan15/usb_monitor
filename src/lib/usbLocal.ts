import { execFile } from "child_process";
import os from "os";

/**
 * Los dispositivos USB conectados a la PROPIA PC del panel.
 *
 * El panel no tiene agente en su PC, pero no lo necesita para
 * esto: la antigua herramienta de seriales del toolbox — que
 * antes de entrar en el toolbox era un programa aparte, sin
 * servicio ninguno — leía los seriales de las memorias
 * pinchadas en la PC donde corría, y eso es lo que se hace
 * aquí: una consulta WMI (Win32_DiskDrive, la misma fuente
 * que usa el detector del agente) lanzada con PowerShell.
 *
 * Solo en Windows y fallando en silencio: si la consulta no
 * sale (otra plataforma, PowerShell ocupado, WMI lento), la
 * lista queda vacía y el resto del panel ni se entera. El
 * resultado se cachea 15 s: el desplegable de la lista blanca
 * puede pedirlo varias veces seguidas sin martillar a WMI.
 */

export interface DispositivoLocal {
  serialNumber: string;
  pcName: string;
  driveLetter: string | null;
  volumeName: string;
  model: string;
}

// La limpieza del serial, espejo de la del agente
// (Detector.LimpiarSerial): fuera espacios, fuera los
// marcadores de «sin serial» y fuera la cola «&0» típica del
// id de instancia. Así, el serial leído aquí coincide con el
// que el agente reportaría del mismo dispositivo.
function limpiarSerial(bruto: string | null | undefined): string {
  if (!bruto) return "";
  let serial = String(bruto).trim();
  const invalido = (s: string) =>
    ["N/A", "NA", "NONE", "NULL", "0"].includes(s.toUpperCase());
  if (!serial || invalido(serial)) return "";
  serial = serial.replace(/&0$/, "").trim();
  if (!serial || invalido(serial)) return "";
  return serial;
}

// El serial puede venir también como último tramo del id de
// instancia PnP, igual que en el agente (SerialDesdeInstancia).
function serialDesdeInstancia(instancia: string | null | undefined): string {
  if (!instancia) return "";
  const partes = String(instancia).split("\\").filter(Boolean);
  return partes.length ? limpiarSerial(partes[partes.length - 1]) : "";
}

// La consulta: discos con interfaz USB (o colgando de
// USBSTOR), con su letra y su etiqueta siguiendo la cadena
// disco → partición → disco lógico, como hace el agente.
// Salida JSON por la salida estándar; cualquier error de WMI
// deja el disco fuera en vez de tumbar la lista.
const SCRIPT_PS = `
$ErrorActionPreference = 'SilentlyContinue'
$salida = @()
foreach ($disco in Get-CimInstance Win32_DiskDrive) {
  $esUsb = $disco.InterfaceType -eq 'USB' -or $disco.PNPDeviceID -like 'USBSTOR*' -or $disco.PNPDeviceID -like 'USB*'
  if (-not $esUsb) { continue }
  $letras = @()
  foreach ($particion in Get-CimAssociatedInstance -InputObject $disco -Association 'Win32_DiskDriveToDiskPartition') {
    foreach ($logico in Get-CimAssociatedInstance -InputObject $particion -Association 'Win32_LogicalDiskToPartition') {
      $letras += [pscustomobject]@{ letra = $logico.DeviceID; etiqueta = $logico.VolumeName }
    }
  }
  $salida += [pscustomobject]@{
    serial = $disco.SerialNumber
    instancia = $disco.PNPDeviceID
    modelo = $disco.Model
    letras = $letras
  }
}
$salida | ConvertTo-Json -Compress -Depth 4
`;

let cache: { hasta: number; items: DispositivoLocal[] } | null = null;
const CACHE_MS = 15_000;

/**
 * Los USB de almacenamiento pinchados ahora mismo en la PC
 * del panel, con la forma de los conectados de la flota.
 */
export async function dispositivosLocales(): Promise<DispositivoLocal[]> {
  if (process.platform !== "win32") return [];
  if (cache && Date.now() < cache.hasta) return cache.items;

  const items = await consultarWmi();
  cache = { hasta: Date.now() + CACHE_MS, items };
  return items;
}

function consultarWmi(): Promise<DispositivoLocal[]> {
  return new Promise((resolve) => {
    execFile(
      "powershell.exe",
      [
        "-NoProfile",
        "-NonInteractive",
        "-ExecutionPolicy",
        "Bypass",
        "-Command",
        SCRIPT_PS,
      ],
      { timeout: 6_000, windowsHide: true, maxBuffer: 1024 * 1024 },
      (error, stdout) => {
        if (error || !stdout?.trim()) {
          resolve([]);
          return;
        }
        try {
          const bruto = JSON.parse(stdout);
          const discos = Array.isArray(bruto) ? bruto : [bruto];
          const pcName = os.hostname();
          const items: DispositivoLocal[] = [];
          for (const d of discos) {
            const serial =
              limpiarSerial(d?.serial) || serialDesdeInstancia(d?.instancia);
            if (!serial) continue;
            const letras: { letra?: string; etiqueta?: string }[] =
              Array.isArray(d?.letras) ? d.letras : [];
            const primera = letras[0];
            items.push({
              serialNumber: serial,
              pcName,
              driveLetter: primera?.letra
                ? String(primera.letra).toUpperCase()
                : null,
              volumeName: (primera?.etiqueta || "").trim(),
              model: (d?.modelo || "Disco USB").trim(),
            });
          }
          resolve(items);
        } catch {
          resolve([]);
        }
      },
    );
  });
}
