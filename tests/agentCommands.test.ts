import { createHash } from "crypto";
import { mkdtemp, writeFile, rm } from "fs/promises";
import { tmpdir } from "os";
import path from "path";

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  ESTADOS_ORDEN_ACTIVA,
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
