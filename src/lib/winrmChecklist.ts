// ──────────────────────────────────────────────
//  Lista de verificación WinRM — máquina recién creada
//  Los pasos que hay que cumplir EN EL DESTINO (una VM o un
//  equipo nuevo) para que la instalación remota por WinRM
//  funcione en una red sin dominio. Es la misma receta que
//  documenta la cabecera de winrmService.ts, partida en pasos.
//
//  Cada paso declara qué requisitos de checkWinRMRequirements
//  (winrmService.ts) lo verifican en vivo: el FAQ los enseña
//  como guía y el diálogo de instalación los va marcando con
//  el resultado real de la comprobación.
// ──────────────────────────────────────────────

export interface PasoWinRM {
  id: string;
  titulo: string;
  descripcion: string;
  /** Comandos a ejecutar en el destino (PowerShell de administrador). */
  comandos: string[];
  /** Ids de RequisitoWinRM que verifican este paso en vivo. */
  checks: string[];
}

export const PASOS_WINRM_VM: PasoWinRM[] = [
  {
    id: "red-privada",
    titulo: "Red visible y perfil en Privado",
    descripcion:
      "La máquina virtual debe verse desde el equipo del panel (en VirtualBox o VMware, el adaptador en modo puente o en la misma red interna) y su conexión debe estar en perfil Privado: con perfil Público, la excepción de firewall de WinRM no aplica en Windows cliente y el listener no se alcanza.",
    comandos: ["Set-NetConnectionProfile -NetworkCategory Private"],
    checks: ["perfil"],
  },
  {
    id: "cuenta-admin",
    titulo: "Cuenta administradora local con contraseña",
    descripcion:
      "La instalación entra con una cuenta administradora local del destino, y en grupo de trabajo (sin dominio) una cuenta sin contraseña no puede abrir sesión remota. Es la cuenta que se escribe en el diálogo de instalación; si la VM se acaba de crear, es la del usuario de la instalación de Windows una vez puesta su contraseña.",
    comandos: ["net user <usuario> <contraseña>"],
    checks: ["credenciales", "admin"],
  },
  {
    id: "habilitar-winrm",
    titulo: "WinRM habilitado con Enable-PSRemoting",
    descripcion:
      "Pone el servicio WinRM en automático, crea el listener en el puerto 5985, abre la excepción del firewall y crea LocalAccountTokenFilterPolicy=1, sin lo cual el administrador local entra recortado por UAC en remoto y la instalación recibe «acceso denegado». Se ejecuta en PowerShell como administrador.",
    comandos: ["Enable-PSRemoting -SkipNetworkProfileCheck -Force"],
    checks: ["listener", "latfp"],
  },
  {
    id: "basic",
    titulo: "Autenticación Basic activada",
    descripcion:
      "Con cuentas locales sobre HTTP, el panel entra con autenticación Basic; si está apagada en el servicio WinRM, la sesión se rechaza aunque la contraseña sea la correcta.",
    comandos: [
      "winrm set winrm/config/service/Auth '@{Basic=\"true\";Negotiate=\"true\"}'",
    ],
    checks: ["basic"],
  },
  {
    id: "sin-cifrar",
    titulo: "AllowUnencrypted permitido (solo con HTTP)",
    descripcion:
      "Con Basic sobre HTTP, el contenido viaja sin cifrar y el servicio lo rechaza salvo que se permita expresamente. Con HTTPS (puerto 5986) este paso no hace falta: la credencial viaja protegida por TLS.",
    comandos: ["winrm set winrm/config/service '@{AllowUnencrypted=\"true\"}'"],
    checks: ["unenc"],
  },
];

export type EstadoPasoWinRM = "cumple" | "no-cumple" | "sin-comprobar";

/** Forma mínima de un requisito comprobado (RequisitoWinRM). */
export interface RequisitoComprobado {
  id: string;
  ok: boolean;
}

/**
 * Estado de un paso según el último resultado de
 * checkWinRMRequirements: «cumple» solo si TODOS sus requisitos
 * están presentes y en verde; «no-cumple» si alguno de los
 * presentes falló; «sin-comprobar» si aún no hay resultado o la
 * comprobación se detuvo antes de llegar a ese paso (p. ej. sin
 * listener no se puede comprobar nada más).
 */
export function estadoPasoWinRM(
  paso: PasoWinRM,
  checks: RequisitoComprobado[] | null,
): EstadoPasoWinRM {
  if (!checks) return "sin-comprobar";
  const porId = new Map(checks.map((c) => [c.id, c.ok]));
  // Con HTTPS o cuenta de dominio, el servidor devuelve un único
  // requisito «basic» en verde que también cubre AllowUnencrypted.
  if (paso.id === "sin-cifrar" && !porId.has("unenc") && porId.get("basic")) {
    return "cumple";
  }
  const presentes = paso.checks.filter((id) => porId.has(id));
  if (presentes.some((id) => !porId.get(id))) return "no-cumple";
  if (presentes.length === paso.checks.length) return "cumple";
  return "sin-comprobar";
}

/** true si la lista entera está en verde con ese resultado. */
export function todosPasosCumplen(
  checks: RequisitoComprobado[] | null,
): boolean {
  if (!checks) return false;
  return PASOS_WINRM_VM.every(
    (paso) => estadoPasoWinRM(paso, checks) === "cumple",
  );
}
