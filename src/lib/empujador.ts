import { spawn } from "child_process";
import { promises as fs } from "fs";
import path from "path";

import { logError } from "@/lib/logger";

/**
 * El empujador (USBMonitorEmpujador.exe): el ayudante nativo que
 * hace el empujón SMB+RPC en el equipo del panel, porque desde
 * Node no hay librería seria para el SCM remoto. Vive junto al
 * panel (carpeta `empujador/`, u otra ruta con EMPUJADOR_PATH) y
 * el ejecutor de tareas lo lanza como proceso hijo.
 *
 * Protocolo (líneas JSON por stdout):
 *   {"tipo":"progreso","etapa":"conexion|copia|servicio",
 *    "detalle":"…","porcentaje":42|null}
 *   {"tipo":"resultado","success":bool,"message":"…",
 *    "checks":[{id,etiqueta,ok,detalle,consejo}]|null,
 *    "yaInstalado":bool|null}
 *
 * La clave viaja solo como argumento del proceso en el propio
 * equipo del panel: no se escribe en ningún archivo ni se
 * registra en los logs.
 */

export interface CheckEmpujador {
  id: string;
  etiqueta: string;
  ok: boolean;
  detalle: string;
  consejo?: string | null;
}

export interface ResultadoEmpujador {
  success: boolean;
  message: string;
  checks: CheckEmpujador[] | null;
  yaInstalado: boolean | null;
}

export type EventoEmpujador =
  | {
      tipo: "progreso";
      etapa: string;
      detalle: string;
      porcentaje: number | null;
    }
  | { tipo: "resultado"; resultado: ResultadoEmpujador };

/** Interpreta una línea de stdout del empujador; null si no es JSON suyo. */
export function interpretarLineaEmpujador(
  linea: string,
): EventoEmpujador | null {
  const limpia = linea.trim();
  if (!limpia.startsWith("{")) return null;
  let datos: any;
  try {
    datos = JSON.parse(limpia);
  } catch {
    return null;
  }
  if (datos?.tipo === "progreso") {
    return {
      tipo: "progreso",
      etapa: typeof datos.etapa === "string" ? datos.etapa : "",
      detalle: typeof datos.detalle === "string" ? datos.detalle : "",
      porcentaje:
        typeof datos.porcentaje === "number" ? datos.porcentaje : null,
    };
  }
  if (datos?.tipo === "resultado") {
    return {
      tipo: "resultado",
      resultado: {
        success: datos.success === true,
        message: typeof datos.message === "string" ? datos.message : "",
        checks: Array.isArray(datos.checks) ? datos.checks : null,
        yaInstalado:
          typeof datos.yaInstalado === "boolean" ? datos.yaInstalado : null,
      },
    };
  }
  return null;
}

export function rutaEmpujador(): string {
  return (
    process.env.EMPUJADOR_PATH ||
    path.join(process.cwd(), "empujador", "USBMonitorEmpujador.exe")
  );
}

export async function empujadorDisponible(): Promise<boolean> {
  try {
    const info = await fs.stat(rutaEmpujador());
    return info.isFile() && info.size > 0;
  } catch {
    return false;
  }
}

export interface ArgumentosEmpujador {
  ip: string;
  usuario: string;
  clave: string;
  codigo?: string;
  servidor?: string;
  exeAgente?: string;
}

const LIMITE_EMPUJADOR_MS = 10 * 60_000;

/**
 * Lanza el empujador en un modo y recoge su resultado. El
 * progreso se reenvía por el callback en cuanto llega cada
 * línea. Nunca lanza: un fallo de lanzamiento o un tiempo
 * agotado vuelven como resultado success=false.
 */
export async function ejecutarEmpujador(
  modo: "--comprobar" | "--instalar",
  args: ArgumentosEmpujador,
  onProgreso?: (etapa: string, detalle: string, porcentaje: number | null) => void,
): Promise<ResultadoEmpujador> {
  const ruta = rutaEmpujador();
  if (!(await empujadorDisponible())) {
    return {
      success: false,
      message:
        "Falta el empujador en el equipo del panel: deja USBMonitorEmpujador.exe en la carpeta empujador del panel (sale de compilar el proyecto agente/empujador).",
      checks: null,
      yaInstalado: null,
    };
  }
  const argv = [
    modo,
    "--ip",
    args.ip,
    "--usuario",
    args.usuario,
    "--clave",
    args.clave,
  ];
  if (args.codigo) argv.push("--codigo", args.codigo);
  if (args.servidor) argv.push("--servidor", args.servidor);
  if (args.exeAgente) argv.push("--exe", args.exeAgente);

  return new Promise<ResultadoEmpujador>((resolve) => {
    let resultado: ResultadoEmpujador | null = null;
    let resto = "";
    let errores = "";
    let terminado = false;
    let agotado = false;
    const terminar = (r: ResultadoEmpujador) => {
      if (terminado) return;
      terminado = true;
      resolve(r);
    };

    let hijo: ReturnType<typeof spawn>;
    try {
      hijo = spawn(ruta, argv, { windowsHide: true });
    } catch (error) {
      logError("No se pudo lanzar el empujador", error);
      return terminar({
        success: false,
        message: "No se pudo lanzar el empujador en el equipo del panel.",
        checks: null,
        yaInstalado: null,
      });
    }

    // stderr se DRENA siempre, aunque no se use: con la tubería
    // sin lector, un empujador que escriba más de lo que cabe en
    // el búfer (un volcado de excepción de.NET, por ejemplo) se
    // queda bloqueado escribiendo y no termina nunca — era una
    // de las vías del «proceso colgado» que retenía el paquete.
    // Se guarda solo la cola, para poder contar el fallo.
    hijo.stderr?.setEncoding("utf-8");
    hijo.stderr?.on("data", (trozo: string) => {
      errores = (errores + trozo).slice(-4096);
    });

    const limite = setTimeout(() => {
      agotado = true;
      try {
        hijo.kill();
      } catch {}
      // No se resuelve hasta que el proceso muere de verdad
      // (evento close) o pasa una gracia breve: resolver aquí
      // dejaba al empujador zombi con el ejecutable del paquete
      // abierto, y el siguiente intento — o la subida de un
      // paquete nuevo en Ajustes — chocaba contra ese candado.
      setTimeout(() => {
        terminar({
          success: false,
          message:
            "El empujador no terminó en 10 minutos y no se dejó detener; el destino queda como estaba antes del intento.",
          checks: null,
          yaInstalado: null,
        });
      }, 5_000);
    }, LIMITE_EMPUJADOR_MS);

    hijo.stdout?.setEncoding("utf-8");
    hijo.stdout?.on("data", (trozo: string) => {
      resto += trozo;
      let corte: number;
      while ((corte = resto.indexOf("\n")) >= 0) {
        const linea = resto.slice(0, corte);
        resto = resto.slice(corte + 1);
        const evento = interpretarLineaEmpujador(linea);
        if (!evento) continue;
        if (evento.tipo === "progreso") {
          onProgreso?.(evento.etapa, evento.detalle, evento.porcentaje);
        } else {
          resultado = evento.resultado;
        }
      }
    });
    hijo.on("error", (error) => {
      clearTimeout(limite);
      logError("Error del proceso empujador", error);
      terminar({
        success: false,
        message: `El empujador falló al ejecutarse: ${error.message}`,
        checks: null,
        yaInstalado: null,
      });
    });
    hijo.on("close", () => {
      clearTimeout(limite);
      if (agotado) {
        logError("El empujador agotó el tiempo y fue detenido", {
          stderr: errores.trim().slice(-500) || undefined,
        });
        return terminar({
          success: false,
          message:
            "El empujador no terminó en 10 minutos; se detuvo. El destino queda como estaba antes del intento.",
          checks: null,
          yaInstalado: null,
        });
      }
      if (resto.trim()) {
        const evento = interpretarLineaEmpujador(resto);
        if (evento?.tipo === "resultado") resultado = evento.resultado;
      }
      if (!resultado && errores.trim()) {
        logError("El empujador terminó sin resultado", {
          stderr: errores.trim().slice(-500),
        });
      }
      terminar(
        resultado ?? {
          success: false,
          message: "El empujador terminó sin dar resultado.",
          checks: null,
          yaInstalado: null,
        },
      );
    });
  });
}
