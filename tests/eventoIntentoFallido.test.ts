import { describe, expect, it } from "vitest";

import {
  debeCrearEventoIntento,
  debePausarPc,
  esActivacionPausa,
  RESULTADOS_QUE_CUENTAN_PC,
  RESULTADO_PC_EN_PAUSA,
} from "@/lib/eventoIntentoFallido";

describe("debeCrearEventoIntento", () => {
  it("los fallos de verdad tienen evento", () => {
    expect(debeCrearEventoIntento("BAD_PASSWORD")).toBe(true);
    expect(debeCrearEventoIntento("NOT_OWNER")).toBe(true);
    expect(debeCrearEventoIntento("LOCKED")).toBe(true);
    expect(debeCrearEventoIntento("OFFLINE_FAIL")).toBe(true);
    expect(debeCrearEventoIntento(RESULTADO_PC_EN_PAUSA)).toBe(true);
  });

  it("la rutina y el contexto no ensucian el registro", () => {
    expect(debeCrearEventoIntento("SUCCESS")).toBe(false);
    expect(debeCrearEventoIntento("OFFLINE_OK")).toBe(false);
    expect(debeCrearEventoIntento("NO_PENDING")).toBe(false);
    expect(debeCrearEventoIntento("NOT_WHITELISTED")).toBe(false);
    expect(debeCrearEventoIntento("DISABLED")).toBe(false);
  });
});

describe("debePausarPc", () => {
  it("por debajo del umbral no hay pausa y al llegar, sí", () => {
    expect(debePausarPc(9, 10)).toBe(false);
    expect(debePausarPc(10, 10)).toBe(true);
    expect(debePausarPc(25, 10)).toBe(true);
  });

  it("la pausa no se autoalimenta: PC_LOCKED no cuenta para la ventana", () => {
    expect(RESULTADOS_QUE_CUENTAN_PC).not.toContain(RESULTADO_PC_EN_PAUSA);
    expect(RESULTADOS_QUE_CUENTAN_PC).toContain("BAD_PASSWORD");
    expect(RESULTADOS_QUE_CUENTAN_PC).toContain("NO_PENDING");
  });
});

describe("esActivacionPausa", () => {
  it("solo la primera denegación de la racha anuncia", () => {
    expect(esActivacionPausa("BAD_PASSWORD")).toBe(true);
    expect(esActivacionPausa(null)).toBe(true);
    expect(esActivacionPausa(RESULTADO_PC_EN_PAUSA)).toBe(false);
  });
});
