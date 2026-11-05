import { promises as fs } from "fs";
import os from "os";
import path from "path";
import { zipSync } from "fflate";
import { describe, expect, it } from "vitest";

import {
  ErrorPaqueteInvalido,
  colocarPaquete,
  elegirEntradas,
  validarVersion,
  versionDesdeNombre,
} from "@/lib/paqueteAdmin";

// ── La versión deducida del nombre del zip ─────────────────────
describe("versionDesdeNombre", () => {
  it("extrae la versión del nombre real de la Release", () => {
    expect(versionDesdeNombre("USBMonitorService-agente-v1.0.11.zip")).toBe(
      "1.0.11",
    );
    expect(versionDesdeNombre("USBMonitorService-agente-v1.0.9.zip")).toBe(
      "1.0.9",
    );
  });

  it("acepta variantes con y sin «v»", () => {
    expect(versionDesdeNombre("agente-v2.0.1.zip")).toBe("2.0.1");
    expect(versionDesdeNombre("paquete-1.10.3.zip")).toBe("1.10.3");
  });

  it("devuelve null si el nombre no lleva versión", () => {
    expect(versionDesdeNombre("USBMonitorService.zip")).toBeNull();
    expect(versionDesdeNombre("paquete.zip")).toBeNull();
    expect(versionDesdeNombre("")).toBeNull();
  });
});

describe("validarVersion", () => {
  it("acepta X.Y.Z y la recorta", () => {
    expect(validarVersion("1.0.11")).toBe("1.0.11");
    expect(validarVersion("  2.3.4 ")).toBe("2.3.4");
  });

  it("rechaza lo que no es X.Y.Z", () => {
    expect(validarVersion("v1.0.11")).toBeNull();
    expect(validarVersion("1.0")).toBeNull();
    expect(validarVersion("")).toBeNull();
    expect(validarVersion(undefined)).toBeNull();
    expect(validarVersion(1011)).toBeNull();
  });
});

// ── La elección de entradas dentro del zip ─────────────────────
describe("elegirEntradas", () => {
  it("encuentra agente y empujador en el zip completo", () => {
    const elegidas = elegirEntradas([
      "USBMonitorService.exe",
      "Install-Service.ps1",
      "USBMonitorEmpujador.exe",
    ]);
    expect(elegidas.agente).toBe("USBMonitorService.exe");
    expect(elegidas.empujador).toBe("USBMonitorEmpujador.exe");
  });

  it("un zip de Release vieja solo trae el agente", () => {
    const elegidas = elegirEntradas([
      "USBMonitorService.exe",
      "Install-Service.ps1",
    ]);
    expect(elegidas.agente).toBe("USBMonitorService.exe");
    expect(elegidas.empujador).toBeNull();
  });

  it("compara por nombre base: vale una entrada en subcarpeta", () => {
    const elegidas = elegirEntradas([
      "agente/USBMonitorService.exe",
      "agente/extra/USBMonitorEmpujador.exe",
    ]);
    expect(elegidas.agente).toBe("agente/USBMonitorService.exe");
    expect(elegidas.empujador).toBe("agente/extra/USBMonitorEmpujador.exe");
  });

  it("sin ejecutable del agente, agente es null", () => {
    const elegidas = elegirEntradas([
      "Install-Service.ps1",
      "USBMonitorEmpujador.exe",
    ]);
    expect(elegidas.agente).toBeNull();
  });
});

// ── La colocación del paquete en disco ─────────────────────────
const EXE_AGENTE = new TextEncoder().encode("exe-del-agente-de-prueba");
const EXE_EMPUJADOR = new TextEncoder().encode("exe-del-empujador-de-prueba");

async function raicesTemporales() {
  const base = await fs.mkdtemp(path.join(os.tmpdir(), "paquete-admin-"));
  return {
    carpetaPaquete: path.join(base, "paquete-agente"),
    rutaEmpujador: path.join(base, "empujador", "USBMonitorEmpujador.exe"),
  };
}

describe("colocarPaquete", () => {
  it("coloca los dos ejecutables y escribe el manifiesto", async () => {
    const raices = await raicesTemporales();
    const zip = zipSync({
      "USBMonitorService.exe": EXE_AGENTE,
      "Install-Service.ps1": new TextEncoder().encode("script"),
      "USBMonitorEmpujador.exe": EXE_EMPUJADOR,
    });

    const { estado, avisos } = await colocarPaquete(zip, "1.0.11", raices);

    const exeAgente = await fs.readFile(
      path.join(raices.carpetaPaquete, "USBMonitorService.exe"),
    );
    expect(exeAgente.equals(Buffer.from(EXE_AGENTE))).toBe(true);
    const exeEmpujador = await fs.readFile(raices.rutaEmpujador);
    expect(exeEmpujador.equals(Buffer.from(EXE_EMPUJADOR))).toBe(true);
    const manifiesto = JSON.parse(
      await fs.readFile(
        path.join(raices.carpetaPaquete, "manifiesto.json"),
        "utf-8",
      ),
    );
    expect(manifiesto).toEqual({ version: "1.0.11" });
    expect(avisos).toEqual([]);
    expect(estado.version).toBe("1.0.11");
    expect(estado.agente.presente).toBe(true);
    expect(estado.empujador.presente).toBe(true);
  });

  it("sin empujador en el zip, avisa y coloca lo demás", async () => {
    const raices = await raicesTemporales();
    const zip = zipSync({
      "USBMonitorService.exe": EXE_AGENTE,
      "Install-Service.ps1": new TextEncoder().encode("script"),
    });

    const { estado, avisos } = await colocarPaquete(zip, "1.0.9", raices);

    expect(avisos).toHaveLength(1);
    expect(avisos[0]).toContain("empujador");
    expect(estado.agente.presente).toBe(true);
    expect(estado.empujador.presente).toBe(false);
    const manifiesto = JSON.parse(
      await fs.readFile(
        path.join(raices.carpetaPaquete, "manifiesto.json"),
        "utf-8",
      ),
    );
    expect(manifiesto).toEqual({ version: "1.0.9" });
  });

  it("rechaza un zip sin el ejecutable del agente", async () => {
    const raices = await raicesTemporales();
    const zip = zipSync({
      "USBMonitorEmpujador.exe": EXE_EMPUJADOR,
    });
    await expect(colocarPaquete(zip, "1.0.11", raices)).rejects.toBeInstanceOf(
      ErrorPaqueteInvalido,
    );
  });

  it("rechaza contenido que no es un zip", async () => {
    const raices = await raicesTemporales();
    const noZip = new TextEncoder().encode("esto no es un zip");
    await expect(colocarPaquete(noZip, "1.0.11", raices)).rejects.toBeInstanceOf(
      ErrorPaqueteInvalido,
    );
  });
});
