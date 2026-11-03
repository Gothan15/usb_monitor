import { createHash } from "crypto";
import { mkdtemp, writeFile, rm } from "fs/promises";
import { tmpdir } from "os";
import path from "path";

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  ESTADOS_ORDEN_ACTIVA,
  transicionInformeValida,
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
