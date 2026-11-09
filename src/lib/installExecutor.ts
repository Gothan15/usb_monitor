
import { db } from "@/lib/db";
import { generarCodigoEnrolamiento } from "@/lib/credenciales";
import { resolverEquipoParaAgente } from "@/lib/identidadEquipo";
import { readAppSettings } from "@/lib/appSettings";
import { getCurrentDate } from "@/lib/time";
import { logError, logInfo } from "@/lib/logger";
import { broadcastInstallChange } from "@/lib/socket";
import { ejecutarEmpujador, type ResultadoEmpujador } from "@/lib/empujador";
import { getAllLocalNetworks } from "@/lib/networkScanner";
import {
  manifiestoPaquete,
  rutaExePaquete,
} from "@/lib/paqueteAgente";
import {
  CONCURRENCIA_INSTALACION,
  ESTADO_DESTINO,
  ESTADO_TAREA,
  ESTADOS_DESTINO_FINALES,
  METODO,
  estadoDesdeEtapaEmpujador,
  estadoFinalTarea,
  resolverMetodo,
  type EstadoDestino,
} from "@/lib/installTasks";
import {
  ESTADO_ORDEN,
  ESTADOS_ORDEN_ACTIVA,
  TIPO_ORDEN_ACTUALIZAR,
} from "@/lib/agentCommands";

/**
 * Ejecutor de tareas de instalación (fase D): el proceso en
 * segundo plano del panel que lleva cada destino de EN_COLA a
 * INSTALADO, OMITIDO o ERROR, con concurrencia 2 entre todos
 * los destinos de todas las tareas.
 *
 * La contraseña de la cuenta vive SOLO en este mapa en memoria
 * mientras la tarea corre. Si el panel se reinicia a mitad, los
 * destinos en curso quedan INTERRUMPIDO (nada se finge
 * completado) y el reintento pide la clave otra vez.
 */

const credencialesEnMemoria = new Map<string, string>();
const tareasEnEjecucion = new Set<string>();

// ── Semáforo global de instalaciones simultáneas ─────────────
let instalacionesActivas = 0;
const esperandoTurno: Array<() => void> = [];

async function adquirirTurno(): Promise<void> {
  if (instalacionesActivas < CONCURRENCIA_INSTALACION) {
    instalacionesActivas++;
    return;
  }
  await new Promise<void>((resolve) => esperandoTurno.push(resolve));
  instalacionesActivas++;
}

function liberarTurno(): void {
  instalacionesActivas--;
  const siguiente = esperandoTurno.shift();
  if (siguiente) siguiente();
}

const esperar = (ms: number) =>
  new Promise((resolve) => setTimeout(resolve, ms));

// ── Utilidades de estado ─────────────────────────────────────

async function actualizarDestino(
  id: string,
  data: Record<string, unknown>,
): Promise<void> {
  await db.installTaskTarget.update({ where: { id }, data });
  broadcastInstallChange();
}

async function finalizarTareaSiToca(taskId: string): Promise<void> {
  const destinos = await db.installTaskTarget.findMany({
    where: { taskId },
    select: { status: true },
  });
  const todosFinales = destinos.every((d) =>
    (ESTADOS_DESTINO_FINALES as string[]).includes(d.status),
  );
  if (!todosFinales) return;
  await db.installTask.update({
    where: { id: taskId },
    data: {
      status: estadoFinalTarea(destinos.map((d) => d.status)),
      finishedAt: getCurrentDate(),
    },
  });
  credencialesEnMemoria.delete(taskId);
  broadcastInstallChange();
}

/** Host:puerto del panel tal como lo ve un equipo de la LAN. */
export function hostServidorParaAgente(): string {
  const envHost = (process.env.APP_HOST || "").trim();
  let host = envHost && envHost !== "0.0.0.0" && envHost !== "::" ? envHost : "";
  if (!host) {
    // La lista del escáner ya viene ordenada por preferencia
    // (interfaz física primero, virtuales al final): un agente de
    // otro PC debe recibir la IP real de la LAN, no la de un
    // adaptador de VMware/Hyper-V que nadie más puede alcanzar.
    host = getAllLocalNetworks()[0]?.address ?? "";
  }
  const puerto = Number(process.env.PORT) || 3000;
  return `${host || "localhost"}:${puerto}`;
}

// ── Esperas de confirmación por la señal del agente ──────────

async function esperarSenalAgente(
  computerId: string,
  desdeMs: number,
  limiteMs: number,
): Promise<boolean> {
  const fin = Date.now() + limiteMs;
  while (Date.now() < fin) {
    const computer = await db.computer.findUnique({
      where: { id: computerId },
      select: { lastSeen: true },
    });
    // 10 s de holgura por relojes distintos entre panel y equipo.
    if (computer?.lastSeen && computer.lastSeen.getTime() >= desdeMs - 10_000) {
      return true;
    }
    await esperar(5_000);
  }
  return false;
}

type EsperaVersion =
  | { resultado: "ok" }
  | { resultado: "error-orden"; detalle: string }
  | { resultado: "sin-confirmar" };

async function esperarVersionAgente(
  computerId: string,
  version: string | null,
  limiteMs: number,
): Promise<EsperaVersion> {
  const inicio = Date.now();
  const fin = inicio + limiteMs;
  while (Date.now() < fin) {
    const computer = await db.computer.findUnique({
      where: { id: computerId },
      select: { agentVersion: true },
    });
    if (version && computer?.agentVersion === version) {
      return { resultado: "ok" };
    }
    const orden = await db.agentCommand.findFirst({
      where: {
        computerId,
        type: TIPO_ORDEN_ACTUALIZAR,
        status: ESTADO_ORDEN.HECHA,
      },
      orderBy: { createdAt: "desc" },
      select: { id: true },
    });
    if (!version && orden) return { resultado: "ok" };
    const fallida = await db.agentCommand.findFirst({
      where: {
        computerId,
        type: TIPO_ORDEN_ACTUALIZAR,
        status: ESTADO_ORDEN.ERROR,
      },
      orderBy: { createdAt: "desc" },
      select: { detail: true, finishedAt: true },
    });
    if (fallida && fallida.finishedAt && fallida.finishedAt.getTime() >= inicio - 5_000) {
      return {
        resultado: "error-orden",
        detalle: fallida.detail || "La orden de actualización terminó en error.",
      };
    }
    await esperar(5_000);
  }
  return { resultado: "sin-confirmar" };
}

// ── Un intento sobre un destino ──────────────────────────────

interface ResultadoIntento {
  estado: typeof ESTADO_DESTINO.INSTALADO | typeof ESTADO_DESTINO.OMITIDO | typeof ESTADO_DESTINO.ERROR;
  message: string;
  reintentable: boolean;
}

async function flujoViaAgente(
  task: { omitIfInstalled: boolean },
  destino: { id: string },
  computer: { id: number | string; agentVersion: string | null },
): Promise<ResultadoIntento> {
  const manifiesto = await manifiestoPaquete();
  if (!manifiesto) {
    return {
      estado: ESTADO_DESTINO.ERROR,
      message:
        "No hay paquete de actualización en el panel: deja el USBMonitorService.exe vigente (y su manifiesto.json) en la carpeta paquete-agente.",
      reintentable: false,
    };
  }
  if (
    task.omitIfInstalled &&
    manifiesto.version &&
    computer.agentVersion === manifiesto.version
  ) {
    return {
      estado: ESTADO_DESTINO.OMITIDO,
      message: `Ya corre la versión del paquete (${manifiesto.version}): nada que instalar.`,
      reintentable: false,
    };
  }
  const activa = await db.agentCommand.findFirst({
    where: {
      computerId: String(computer.id),
      type: TIPO_ORDEN_ACTUALIZAR,
      status: { in: ESTADOS_ORDEN_ACTIVA },
    },
    select: { id: true },
  });
  if (!activa) {
    await db.agentCommand.create({
      data: {
        computerId: String(computer.id),
        type: TIPO_ORDEN_ACTUALIZAR,
        targetVersion: manifiesto.version,
      },
    });
  }
  await actualizarDestino(destino.id, {
    status: ESTADO_DESTINO.ESPERANDO_SENAL,
    message: activa
      ? "Ya había una orden de actualización activa: esperando a que el agente la confirme con su señal."
      : `Orden de actualización creada (versión objetivo ${manifiesto.version ?? "la del paquete"}): esperando a que el agente la confirme con su señal.`,
  });
  const espera = await esperarVersionAgente(
    String(computer.id),
    manifiesto.version,
    10 * 60_000,
  );
  if (espera.resultado === "ok") {
    return {
      estado: ESTADO_DESTINO.INSTALADO,
      message: `El agente se actualizó${manifiesto.version ? ` a la versión ${manifiesto.version}` : ""} y lo confirmó con su señal.`,
      reintentable: false,
    };
  }
  if (espera.resultado === "error-orden") {
    return {
      estado: ESTADO_DESTINO.ERROR,
      message: espera.detalle,
      reintentable: false,
    };
  }
  return {
    estado: ESTADO_DESTINO.ERROR,
    message:
      "El agente no confirmó la actualización en 10 minutos: puede estar apagado o sin red.",
    reintentable: true,
  };
}

async function intentoInstalacion(
  task: { id: string; username: string; omitIfInstalled: boolean },
  destino: { id: string; pcName: string; ipAddress: string },
  clave: string,
): Promise<ResultadoIntento> {
  const settings = await readAppSettings();
  const umbralMs = Math.max(2, settings.silenceThresholdMinutes || 5) * 60_000;
  const computer = await db.computer.findUnique({
    where: { name: destino.pcName },
    select: {
      id: true,
      lastSeen: true,
      clavePublica: true,
      agentVersion: true,
    },
  });
  const metodo = computer
    ? resolverMetodo({
        lastSeen: computer.lastSeen,
        tieneCredencial: !!computer.clavePublica,
        ahora: Date.now(),
        umbralMs,
      })
    : METODO.EMPUJE;
  await actualizarDestino(destino.id, {
    method: metodo,
    computerId: computer?.id ?? null,
  });

  if (metodo === METODO.AGENTE && computer) {
    await actualizarDestino(destino.id, {
      status: ESTADO_DESTINO.INSTALANDO,
      message: "El equipo ya reporta: se instala por el canal del agente.",
    });
    return flujoViaAgente(task, destino, computer);
  }

  // ── Empujón SMB+RPC ──
  await actualizarDestino(destino.id, {
    status: ESTADO_DESTINO.COMPROBANDO,
    message: "Comprobando los requisitos del destino con el empujador…",
  });
  const comprobacion: ResultadoEmpujador = await ejecutarEmpujador(
    "--comprobar",
    { ip: destino.ipAddress, usuario: task.username, clave },
  );
  if (comprobacion.checks) {
    await actualizarDestino(destino.id, { checks: comprobacion.checks });
  }
  // OJO al orden (falso «Completado y omitido» de 2026-11-08):
  // la comprobación pregunta «¿ya instalado?» con un acceso al
  // SCM más débil que el que exige para darla por buena, así
  // que puede volver success=false Y yaInstalado=true a la vez
  // (p. ej. el filtro UAC deniega crear servicios pero deja
  // consultarlos). Antes el omitido se miraba primero y la
  // tarea «completaba y omitía» sin haber podido comprobar de
  // verdad. Ahora el omitido solo vale con la comprobación
  // entera en verde; si la comprobación falló, es un error
  // reintentable aunque el servicio pareciera existir.
  if (comprobacion.yaInstalado && !comprobacion.success) {
    return {
      estado: ESTADO_DESTINO.ERROR,
      message:
        "El destino parece tener el servicio, pero la comprobación no pudo completarse (el gestor de servicios no aceptó todas las operaciones): no se da por instalado sin comprobarlo bien. Revisa los requisitos y reintenta.",
      reintentable: true,
    };
  }
  if (comprobacion.yaInstalado && task.omitIfInstalled) {
    return {
      estado: ESTADO_DESTINO.OMITIDO,
      message: computer?.clavePublica
        ? comprobacion.message
        : "El servicio ya existe en el destino —casi seguro lo dejó un intento anterior de esta misma instalación— pero su agente aún no se ha enrolado en el panel. No hay que empujar otra vez: el agente gastará solo el código de aquel intento; si en unos minutos sigue sin aparecer en Equipos, genera un código en Equipos → «Credencial del equipo» y escríbelo en el asistente de esa PC.",
      reintentable: false,
    };
  }
  if (comprobacion.yaInstalado && !task.omitIfInstalled) {
    if (computer?.clavePublica) {
      await actualizarDestino(destino.id, {
        method: METODO.AGENTE,
        status: ESTADO_DESTINO.INSTALANDO,
        message:
          "El agente ya existe en el destino: se va por su canal con una orden de actualización.",
      });
      return flujoViaAgente(task, destino, computer);
    }
    return {
      estado: ESTADO_DESTINO.ERROR,
      message:
        "El agente ya está instalado en el destino, pero el panel no tiene su credencial: genera un código de enrolamiento en Equipos y escríbelo en el asistente de esa PC, o desinstálalo allí para poder empujar de nuevo.",
      reintentable: false,
    };
  }
  if (!comprobacion.success) {
    const fallidos = new Set(
      (comprobacion.checks ?? []).filter((c) => !c.ok).map((c) => c.id),
    );
    const esDelDestino =
      fallidos.has("sesion") || fallidos.has("scm") || !comprobacion.checks;
    return {
      estado: ESTADO_DESTINO.ERROR,
      message: comprobacion.message,
      // Credenciales o el filtro UAC no se arreglan reintentando;
      // que no responda el puerto 445 sí puede ser transitorio.
      reintentable: !esDelDestino,
    };
  }

  // Código de enrolamiento de un solo uso para el agente que va
  // a nacer (overhaul de credenciales): viaja en el comando del
  // empujón, el agente lo presenta al arrancar junto con la
  // clave que genera en la propia PC, y muere en ese acto. Su
  // ventana es larga (12 h) porque copiar el paquete por SMB
  // puede tardar; sigue siendo de un solo uso.
  //
  // Antes de generarlo se resuelve LA identidad del equipo
  // (nombre + IP): si existían dos filas para esta PC —la del
  // nombre y la de la IP, del escáner o de un refresco— se
  // fusionan y el código nace en la fila única. Sin esto, el
  // código podía quedar atado a la fila equivocada y el agente
  // era rechazado al enrolar («código no aceptado»).
  const resuelto = await resolverEquipoParaAgente({
    nombre: destino.pcName,
    ip: destino.ipAddress,
  }).catch(() => null);
  const equipo = resuelto
    ? await db.computer.update({
        where: { id: resuelto.id },
        data: { ipAddress: destino.ipAddress },
        select: { id: true },
      })
    : await db.computer.upsert({
        where: { name: destino.pcName },
        update: { ipAddress: destino.ipAddress },
        create: { name: destino.pcName, ipAddress: destino.ipAddress },
        select: { id: true },
      });
  await actualizarDestino(destino.id, { computerId: equipo.id });
  // ¿El equipo ya tenía credencial de un alta anterior? Lo decide
  // el aviso que se añade si el empujón falla: sin credencial
  // previa, el código que nace ahora es la única vía de alta del
  // destino y conviene decir en el mensaje que sigue vivo.
  const estadoPrevio = await db.computer.findUnique({
    where: { id: equipo.id },
    select: { clavePublica: true },
  });
  const { codigo } = await generarCodigoEnrolamiento(equipo.id, 12 * 60);

  const manifiesto = await manifiestoPaquete();
  const inicio = Date.now();
  const instalacion = await ejecutarEmpujador(
    "--instalar",
    {
      ip: destino.ipAddress,
      usuario: task.username,
      clave,
      codigo,
      servidor: hostServidorParaAgente(),
      exeAgente: manifiesto ? rutaExePaquete() : undefined,
    },
    (etapa, detalle) => {
      void actualizarDestino(destino.id, {
        status: estadoDesdeEtapaEmpujador(etapa),
        message: detalle,
      }).catch(() => {});
    },
  );
  if (!instalacion.success) {
    return {
      estado: ESTADO_DESTINO.ERROR,
      message:
        instalacion.message +
        (estadoPrevio?.clavePublica
          ? ""
          : " El código de enrolamiento de este intento ya quedó generado y vale 12 h: si el agente llegó a escribir su configuración en el destino, se enrolará solo en cuanto su servicio arranque; si en unos minutos el equipo no aparece en Equipos, reintenta la instalación, no hace falta tocar nada en esa PC."),
      reintentable: true,
    };
  }

  await actualizarDestino(destino.id, {
    status: ESTADO_DESTINO.ESPERANDO_SENAL,
    message: "Instalado en el destino: esperando la primera señal del agente…",
  });
  const llego = await esperarSenalAgente(equipo.id, inicio, 3 * 60_000);
  if (llego) {
    await db.computer.update({
      where: { id: equipo.id },
      data: { serviceInstalled: true, serviceRunning: true, lastServiceCheck: getCurrentDate() },
    });
    return {
      estado: ESTADO_DESTINO.INSTALADO,
      message: "El agente quedó instalado y ya reporta al panel.",
      reintentable: false,
    };
  }
  return {
    estado: ESTADO_DESTINO.ERROR,
    message:
      "El instalador terminó bien en el destino, pero el agente no dio señal en 3 minutos. El código de enrolamiento sigue vigente 12 h: si el servicio arranca más tarde, el agente se enrolará solo. Revisa en ese equipo que el servicio USBMonitorService esté en marcha y su registro en C:\\ProgramData\\USBMonitor\\agente.log (las líneas del instalador-remoto cuentan la instalación paso a paso).",
    reintentable: false,
  };
}

async function ejecutarDestino(
  task: { id: string; username: string; omitIfInstalled: boolean; maxAttempts: number },
  destinoId: string,
  clave: string,
): Promise<void> {
  const destino = await db.installTaskTarget.findUnique({
    where: { id: destinoId },
    select: { id: true, pcName: true, ipAddress: true, attempts: true },
  });
  if (!destino) return;
  let intentos = destino.attempts;
  while (true) {
    intentos++;
    await actualizarDestino(destino.id, {
      attempts: intentos,
      startedAt: getCurrentDate(),
      status: ESTADO_DESTINO.COMPROBANDO,
      message: intentos > 1 ? `Intento ${intentos} de ${task.maxAttempts}…` : undefined,
    });
    let resultado: ResultadoIntento;
    try {
      resultado = await intentoInstalacion(task, destino, clave);
    } catch (error) {
      logError("Fallo inesperado instalando un destino de tarea", error);
      resultado = {
        estado: ESTADO_DESTINO.ERROR,
        message: "Fallo inesperado del ejecutor en este destino.",
        reintentable: true,
      };
    }
    if (
      resultado.estado === ESTADO_DESTINO.ERROR &&
      resultado.reintentable &&
      intentos < task.maxAttempts
    ) {
      await actualizarDestino(destino.id, {
        message: `${resultado.message} Se reintenta…`,
      });
      await esperar(5_000);
      continue;
    }
    await actualizarDestino(destino.id, {
      status: resultado.estado,
      message: resultado.message,
      finishedAt: getCurrentDate(),
    });
    return;
  }
}

// ── Arranque, reintento y recuperación ───────────────────────

async function ejecutarTarea(taskId: string): Promise<void> {
  if (tareasEnEjecucion.has(taskId)) return;
  tareasEnEjecucion.add(taskId);
  try {
    const clave = credencialesEnMemoria.get(taskId);
    const task = await db.installTask.findUnique({
      where: { id: taskId },
      select: {
        id: true,
        username: true,
        omitIfInstalled: true,
        maxAttempts: true,
      },
    });
    if (!task) return;
    if (!clave) {
      // Sin clave en memoria (reinicio) no hay forma de empujar:
      // lo que quedaba en cola queda interrumpido, no fingido.
      await db.installTaskTarget.updateMany({
        where: { taskId, status: ESTADO_DESTINO.EN_COLA },
        data: {
          status: ESTADO_DESTINO.INTERRUMPIDO,
          message:
            "El panel se reinició antes de ejecutar este destino y la clave solo vive en memoria: reintenta la tarea.",
          finishedAt: getCurrentDate(),
        },
      });
      await finalizarTareaSiToca(taskId);
      return;
    }
    const enCola = await db.installTaskTarget.findMany({
      where: { taskId, status: ESTADO_DESTINO.EN_COLA },
      select: { id: true },
      orderBy: { createdAt: "asc" },
    });
    await Promise.all(
      enCola.map(async (destino) => {
        await adquirirTurno();
        try {
          await ejecutarDestino(task, destino.id, clave);
        } finally {
          liberarTurno();
        }
      }),
    );
    await finalizarTareaSiToca(taskId);
  } catch (error) {
    logError("Fallo inesperado del ejecutor de tareas", error);
  } finally {
    tareasEnEjecucion.delete(taskId);
  }
}

/**
 * ¿El ejecutor de ESTE proceso tiene la tarea entre manos?
 * Lo usa el borrado de tareas: una tarea viva no se borra
 * (dejaría empujones corriendo contra filas inexistentes).
 */
export function tareaEnEjecucion(taskId: string): boolean {
  return tareasEnEjecucion.has(taskId);
}

/** Registra la clave en memoria y pone la tarea en marcha. */
export function lanzarTarea(taskId: string, clave: string): void {
  credencialesEnMemoria.set(taskId, clave);
  void ejecutarTarea(taskId);
}

/** Reintenta los destinos fallidos o interrumpidos de una tarea. */
export async function reintentarTarea(
  taskId: string,
  clave: string,
): Promise<boolean> {
  const previos = await db.installTaskTarget.updateMany({
    where: {
      taskId,
      status: { in: [ESTADO_DESTINO.ERROR, ESTADO_DESTINO.INTERRUMPIDO] },
    },
    data: {
      status: ESTADO_DESTINO.EN_COLA,
      attempts: 0,
      message: null,
      detail: null,
      startedAt: null,
      finishedAt: null,
      method: null,
    },
  });
  if (previos.count === 0) return false;
  await db.installTask.update({
    where: { id: taskId },
    data: { status: ESTADO_TAREA.EN_CURSO, finishedAt: null },
  });
  broadcastInstallChange();
  lanzarTarea(taskId, clave);
  return true;
}

/**
 * Al arrancar el panel: lo que una tarea dejó a medias queda
 * INTERRUMPIDO (la clave ya no está en memoria y nada se da por
 * completado sin señal que lo confirme).
 */
export async function recuperarTareasInterrumpidas(): Promise<void> {
  try {
    const aMedias = await db.installTaskTarget.updateMany({
      where: {
        status: {
          in: [
            ESTADO_DESTINO.EN_COLA,
            ESTADO_DESTINO.COMPROBANDO,
            ESTADO_DESTINO.COPIANDO,
            ESTADO_DESTINO.INSTALANDO,
            ESTADO_DESTINO.ESPERANDO_SENAL,
          ],
        },
      },
      data: {
        status: ESTADO_DESTINO.INTERRUMPIDO,
        message:
          "El panel se reinició a mitad de la instalación: nada se da por hecho. Reintenta la tarea (te pedirá la clave otra vez).",
        finishedAt: getCurrentDate(),
      },
    });
    if (aMedias.count > 0) {
      logInfo(
        `Recuperación de tareas: ${aMedias.count} destino(s) marcados como interrumpidos`,
      );
    }
    const enCurso = await db.installTask.findMany({
      where: { status: ESTADO_TAREA.EN_CURSO },
      select: { id: true },
    });
    for (const tarea of enCurso) {
      await finalizarTareaSiToca(tarea.id);
    }
    if (aMedias.count > 0) broadcastInstallChange();
  } catch (error) {
    logError("No se pudieron recuperar las tareas interrumpidas", error);
  }
}
