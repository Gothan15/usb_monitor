// ──────────────────────────────────────────────
//  Lista de verificación del empujón SMB — máquina recién creada
//  Los pasos que hay que cumplir EN EL DESTINO (una VM o un
//  equipo nuevo) para que la instalación forzada estilo
//  Kaspersky (SMB al recurso C$ + servicio temporal por RPC)
//  funcione en una red sin dominio. Sustituye a la vieja lista
//  de WinRM: el empujador (USBMonitorEmpujador.exe --comprobar)
//  verifica en vivo los requisitos puerto445, sesion, scm e
//  instalado, y cada paso declara cuáles lo verifican.
//
//  El FAQ enseña los pasos como guía; en la vista de Tareas,
//  la fila de cada destino enseña esta misma lista marcada con
//  el resultado real de su comprobación.
// ──────────────────────────────────────────────

export interface PasoEmpuje {
  id: string;
  titulo: string;
  descripcion: string;
  /** Comandos a ejecutar en el destino (PowerShell de administrador). */
  comandos: string[];
  /** Ids de requisito del empujador que verifican este paso en vivo. */
  checks: string[];
}

export const PASOS_EMPUJE_VM: PasoEmpuje[] = [
  {
    id: "red-privada",
    titulo: "Red visible, compartición activa y perfil en Privado",
    descripcion:
      "La máquina debe verse desde el equipo del panel (en VirtualBox o VMware, el adaptador en modo puente o en la misma red interna), con «Compartir archivos e impresoras» activo para que el recurso C$ exista, y su conexión en perfil Privado: con perfil Público, las reglas de firewall de compartición no aplican en Windows cliente y el puerto 445 no responde.",
    comandos: ["Set-NetConnectionProfile -NetworkCategory Private"],
    checks: ["puerto445"],
  },
  {
    id: "cuenta-admin",
    titulo: "Cuenta administradora local con contraseña",
    descripcion:
      "El empujón entra con una cuenta administradora local del destino, y en grupo de trabajo (sin dominio) una cuenta sin contraseña no puede abrir sesión remota. Es la cuenta que se escribe al crear la tarea de instalación; si el equipo se acaba de crear, es la del usuario de la instalación de Windows una vez puesta su contraseña.",
    comandos: ["net user <usuario> <contraseña>"],
    checks: ["sesion"],
  },
  {
    id: "token-sin-filtro",
    titulo: "Administrador completo en remoto (LocalAccountTokenFilterPolicy)",
    descripcion:
      "Sin este valor, el administrador local entra recortado por UAC cuando accede por red y el gestor de servicios remoto responde «acceso denegado» aunque la contraseña sea la correcta. Se crea una sola vez en el destino; es el mismo ajuste que antes pedía WinRM.",
    comandos: [
      "New-ItemProperty -Path 'HKLM:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Policies\\System' -Name LocalAccountTokenFilterPolicy -Value 1 -PropertyType DWord -Force",
    ],
    checks: ["scm"],
  },
  {
    id: "firewall",
    titulo: "Firewall: Compartir archivos y Administración remota de servicios",
    descripcion:
      "Las dos reglas que el empujón necesita: SMB (puerto 445) para copiar el agente al recurso C$ y la administración remota de servicios (RPC) para crear el servicio temporal que lo instala. Con el perfil en Privado y la compartición activa suelen venir ya permitidas; si la sesión abre pero el servicio no se crea, es aquí donde mirar.",
    comandos: [
      "Enable-NetFirewallRule -DisplayGroup 'Compartir archivos e impresoras'",
      "Enable-NetFirewallRule -DisplayGroup 'Administración remota de servicios'",
    ],
    checks: ["puerto445", "scm"],
  },
  {
    id: "sin-agente",
    titulo: "El agente no está ya instalado",
    descripcion:
      "Si USBMonitorService ya existe en el destino no hay nada que empujar: a ese equipo se llega por el canal del agente (la orden de actualización), y la tarea lo omite o lo actualiza según la opción elegida al crearla. Este paso es un dato de la comprobación, no un fallo.",
    comandos: [],
    checks: ["instalado"],
  },
];

export type EstadoPasoEmpuje = "cumple" | "no-cumple" | "sin-comprobar";

/** Forma mínima de un requisito comprobado (salida del empujador). */
export interface RequisitoComprobado {
  id: string;
  ok: boolean;
}

/**
 * Estado de un paso según el último resultado del empujador:
 * «cumple» solo si TODOS sus requisitos están presentes y en
 * verde; «no-cumple» si alguno de los presentes falló;
 * «sin-comprobar» si aún no hay resultado o la comprobación se
 * detuvo antes de llegar a ese paso (sin SMB no hay sesión que
 * comprobar, por ejemplo).
 */
export function estadoPasoEmpuje(
  paso: PasoEmpuje,
  checks: RequisitoComprobado[] | null,
): EstadoPasoEmpuje {
  if (!checks) return "sin-comprobar";
  const porId = new Map(checks.map((c) => [c.id, c.ok]));
  const presentes = paso.checks.filter((id) => porId.has(id));
  if (presentes.some((id) => !porId.get(id))) return "no-cumple";
  if (presentes.length === paso.checks.length) return "cumple";
  return "sin-comprobar";
}

/**
 * true si los pasos de preparación están en verde. El paso
 * «sin-agente» no cuenta: que el agente ya esté es un dato para
 * la tarea (omitir o ir por el canal), no un incumplimiento.
 */
export function pasosPreparacionCumplen(
  checks: RequisitoComprobado[] | null,
): boolean {
  if (!checks) return false;
  return PASOS_EMPUJE_VM.filter((paso) => paso.id !== "sin-agente").every(
    (paso) => estadoPasoEmpuje(paso, checks) === "cumple",
  );
}
