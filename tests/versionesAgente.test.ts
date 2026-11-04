import { describe, expect, it } from "vitest";

import {
  compararVersiones,
  necesitaActualizacion,
} from "@/lib/versionesAgente";

describe("compararVersiones", () => {
  it("ordena por tramos numéricos, no como texto", () => {
    expect(compararVersiones("1.0.4", "1.0.3")).toBe(1);
    expect(compararVersiones("1.0.3", "1.0.4")).toBe(-1);
    expect(compararVersiones("1.0.10", "1.0.9")).toBe(1);
    expect(compararVersiones("1.0.4", "1.0.4")).toBe(0);
    expect(compararVersiones("2.0", "1.9.9")).toBe(1);
  });

  it("tolera la v inicial y los tramos que faltan", () => {
    expect(compararVersiones("v1.0.4", "1.0.4")).toBe(0);
    expect(compararVersiones("1.1", "1.1.0")).toBe(0);
    expect(compararVersiones("1.1", "1.1.1")).toBe(-1);
  });
});

describe("necesitaActualizacion", () => {
  it("sí cuando el equipo va por detrás del paquete", () => {
    expect(necesitaActualizacion("1.0.3", "1.0.4")).toBe(true);
  });

  it("no cuando está igual o por delante", () => {
    expect(necesitaActualizacion("1.0.4", "1.0.4")).toBe(false);
    expect(necesitaActualizacion("1.0.5", "1.0.4")).toBe(false);
  });

  it("no afirma nada sin las dos versiones", () => {
    expect(necesitaActualizacion(null, "1.0.4")).toBe(false);
    expect(necesitaActualizacion("1.0.3", null)).toBe(false);
    expect(necesitaActualizacion(undefined, undefined)).toBe(false);
  });
});
