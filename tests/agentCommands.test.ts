import { createHash } from "crypto";
import { mkdtemp, writeFile, rm } from "fs/promises";
import { tmpdir } from "os";
import path from "path";

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  accionAlBorrarEquipo,
  canceladaServible,
  hayDesinstalacionActiva,
  informeSumaIntento,
  puedeCrearOrdenAutomatica,
  ESTADOS_ORDEN_ACTIVA,
  sePuedeCancelar,
  transicionInformeValida,
  vistaOrdenActualizacion,
  type OrdenActualizacionFila,
} from "@/lib/agentCommands";

describe("transicionInformeValida", () => {
  it("el agente puede arrancar una orden entregada", () => {
    expect(transicionInformeValida("ENTREGADA", "EN_CURSO")).toBe(true);
    expect(transicionInformeValida("ESPERA", "EN_CURSO")).toBe(true);
  });

  it("en curso se puede reintentar y cerrar", () => {
    expect(transicionInformeValida("EN_CURSO", "EN_CURSO")).toBe(true);
    expect(transicionInformeValida("EN_CURSO", "HECHA")).toBe(true);
    expect(transicionInformeValida("EN_CURSO", "ERROR")).toBe(true);
  });

  it("una orden sin arrancar no puede darse por hecha", () => {
    expect(transicionInformeValida("ENTREGADA", "HECHA")).toBe(false);
    expect(transicionInformeValida("ESPERA", "HECHA")).toBe(false);
  });

  it("una orden cerrada no admite más informes", () => {
    expect(transicionInformeValida("HECHA", "EN_CURSO")).toBe(false);
    expect(transicionInformeValida("ERROR", "EN_CURSO")).toBe(false);
  });

  it("la entrega la marca el panel, no el agente", () => {
    expect(transicionInformeValida("ESPERA", "ENTREGADA")).toBe(false);
  });

  it("los estados activos son espera, entregada y en curso", () => {
    expect(ESTADOS_ORDEN_ACTIVA).toEqual(["ESPERA", "ENTREGADA", "EN_CURSO"]);
  });
});

describe("manifiestoPaquete", () => {
  let dir: string | null = null;

  afterEach(async () => {
    delete process.env.AGENT_PACKAGE_DIR;
    vi.resetModules();
    if (dir) await rm(dir, { recursive: true, force: true });
    dir = null;
  });

  async function cargarConCarpeta(contenido: string | null) {
    dir = await mkdtemp(path.join(tmpdir(), "paquete-agente-"));
    if (contenido !== null) {
      await writeFile(path.join(dir, "USBMonitorService.exe"), contenido);
      await writeFile(
        path.join(dir, "manifiesto.json"),
        JSON.stringify({ version: "9.9.9" }),
      );
    }
    process.env.AGENT_PACKAGE_DIR = dir;
    vi.resetModules();
    return import("@/lib/paqueteAgente");
  }

  it("sin exe en la carpeta no hay manifiesto", async () => {
    const { manifiestoPaquete } = await cargarConCarpeta(null);
    expect(await manifiestoPaquete()).toBeNull();
  });

  it("el hash es el SHA-256 real del exe y la versión sale del manifiesto", async () => {
    const contenido = "exe-de-prueba-para-hash";
    const { manifiestoPaquete } = await cargarConCarpeta(contenido);
    const manifiesto = await manifiestoPaquete();
    expect(manifiesto).not.toBeNull();
    expect(manifiesto!.sha256).toBe(
      createHash("sha256").update(contenido).digest("hex"),
    );
    expect(manifiesto!.tamano).toBe(Buffer.byteLength(contenido));
    expect(manifiesto!.version).toBe("9.9.9");
  });
});

describe("vistaOrdenActualizacion", () => {
  // Fila base: una orden recién creada, como la dejaría el panel.
  const fila = (cambios: Partial<OrdenActualizacionFila> = {}): OrdenActualizacionFila => ({
    id: "orden-1",
    pcName: "ENDUSER-PC",
    type: "actualizar",
    status: "ESPERA",
    detail: null,
    targetVersion: "2.0.3",
    attempts: 0,
    createdAt: new Date("2026-11-12T06:50:24.577Z"),
    deliveredAt: null,
    startedAt: null,
    finishedAt: null,
    ...cambios,
  });

  it("traduce el estado y marca la orden como viva", () => {
    const vista = vistaOrdenActualizacion(fila());
    expect(vista.etiquetaEstado).toBe("En espera");
    expect(vista.viva).toBe(true);
    expect(vista.pcName).toBe("ENDUSER-PC");
    expect(vista.versionObjetivo).toBe("2.0.3");
  });

  it("una orden cerrada ya no vive y lleva su fecha de fin en ISO", () => {
    const vista = vistaOrdenActualizacion(
      fila({
        status: "HECHA",
        detail: "Actualización confirmada tras el reinicio: versión 2.0.3.",
        finishedAt: new Date("2026-11-12T07:02:00.000Z"),
      }),
    );
    expect(vista.etiquetaEstado).toBe("Hecha");
    expect(vista.viva).toBe(false);
    expect(vista.terminadaEn).toBe("2026-11-12T07:02:00.000Z");
    expect(vista.detalle).toContain("confirmada");
  });

  it("el error conserva su detalle: es lo que la pestaña tiene que enseñar", () => {
    const vista = vistaOrdenActualizacion(
      fila({ status: "ERROR", detail: "No se pudo descargar el paquete del panel." }),
    );
    expect(vista.etiquetaEstado).toBe("Error");
    expect(vista.detalle).toBe("No se pudo descargar el paquete del panel.");
  });

  it("un estado desconocido se enseña tal cual y un detalle vacío cuenta como ninguno", () => {
    const vista = vistaOrdenActualizacion(fila({ status: "RARO", detail: "   " }));
    expect(vista.etiquetaEstado).toBe("RARO");
    expect(vista.detalle).toBeNull();
  });

  it("las fechas que ya vienen en texto pasan sin tocarse", () => {
    const vista = vistaOrdenActualizacion(
      fila({ createdAt: "2026-11-12T06:50:24.577Z" }),
    );
    expect(vista.creadaEn).toBe("2026-11-12T06:50:24.577Z");
  });
});

describe("accionAlBorrarEquipo", () => {
  it("sin credencial no hay agente que desinstalar: borrado directo", () => {
    expect(accionAlBorrarEquipo(false, false)).toBe("borrar");
    expect(accionAlBorrarEquipo(false, true)).toBe("borrar");
  });

  it("con credencial se pide la desinstalación al agente", () => {
    expect(accionAlBorrarEquipo(true, false)).toBe("pedir-desinstalacion");
  });

  it("con la orden ya viva no se duplica", () => {
    expect(accionAlBorrarEquipo(true, true)).toBe("ya-pedida");
  });
});

describe("sePuedeCancelar", () => {
  it("una orden viva se puede cancelar en cualquier estado", () => {
    expect(sePuedeCancelar("ESPERA")).toBe(true);
    expect(sePuedeCancelar("ENTREGADA")).toBe(true);
    expect(sePuedeCancelar("EN_CURSO")).toBe(true);
  });

  it("una orden terminada no se toca", () => {
    expect(sePuedeCancelar("HECHA")).toBe(false);
    expect(sePuedeCancelar("ERROR")).toBe(false);
    expect(sePuedeCancelar("CANCELADA")).toBe(false);
  });
});

describe("canceladaServible", () => {
  const ahora = new Date("2026-11-14T12:00:00.000Z");

  it("recién cancelada se sirve", () => {
    expect(canceladaServible(new Date("2026-11-14T11:55:00.000Z"), ahora)).toBe(true);
    expect(canceladaServible("2026-11-14T11:59:00.000Z", ahora)).toBe(true);
  });

  it("pasada la ventana deja de servirse", () => {
    expect(canceladaServible(new Date("2026-11-14T11:49:00.000Z"), ahora)).toBe(false);
  });

  it("sin fecha de fin no se sirve", () => {
    expect(canceladaServible(null, ahora)).toBe(false);
    expect(canceladaServible("no-es-fecha", ahora)).toBe(false);
  });
});

describe("puedeCrearOrdenAutomatica (oleadas)", () => {
  it("con sitio en la oleada y sin errores, crea", () => {
    expect(puedeCrearOrdenAutomatica(0, 0, 3)).toBe(true);
    expect(puedeCrearOrdenAutomatica(2, 0, 3)).toBe(true);
  });

  it("oleada llena: espera", () => {
    expect(puedeCrearOrdenAutomatica(3, 0, 3)).toBe(false);
    expect(puedeCrearOrdenAutomatica(5, 0, 3)).toBe(false);
  });

  it("un solo error en la versión congela el despliegue", () => {
    expect(puedeCrearOrdenAutomatica(0, 1, 3)).toBe(false);
  });

  it("tamaño ilegible cuenta como oleada de uno", () => {
    expect(puedeCrearOrdenAutomatica(0, 0, 0)).toBe(true);
    expect(puedeCrearOrdenAutomatica(1, 0, 0)).toBe(false);
  });
});

describe("informeSumaIntento", () => {
  it("abrir el intento suma; el progreso dentro del mismo, no", () => {
    expect(informeSumaIntento("ENTREGADA", "EN_CURSO")).toBe(true);
    expect(informeSumaIntento("ESPERA", "EN_CURSO")).toBe(true);
    expect(informeSumaIntento("EN_CURSO", "EN_CURSO")).toBe(false);
  });

  it("los estados terminales no suman", () => {
    expect(informeSumaIntento("EN_CURSO", "HECHA")).toBe(false);
    expect(informeSumaIntento("ENTREGADA", "ERROR")).toBe(false);
  });
});

describe("hayDesinstalacionActiva", () => {
  it("detecta la desinstalación entre las órdenes vivas", () => {
    expect(hayDesinstalacionActiva(["actualizar"])).toBe(false);
    expect(hayDesinstalacionActiva(["desinstalar"])).toBe(true);
    expect(hayDesinstalacionActiva(["actualizar", "desinstalar"])).toBe(true);
    expect(hayDesinstalacionActiva([])).toBe(false);
  });
});
