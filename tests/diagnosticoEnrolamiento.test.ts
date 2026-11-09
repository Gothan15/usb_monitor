import { describe, expect, it } from "vitest";

import {
  ESTADO_CODIGO,
  diagnosticarCodigo,
} from "@/lib/diagnosticoEnrolamiento";

// Los motivos distinguibles del enrolamiento: cada estado que
// la prueba paso a paso del agente puede enseñar, fijado aquí
// para que ningún refactor vuelva al «no aceptado» genérico.

const AHORA = new Date("2026-11-08T12:00:00Z").getTime();
const EN_UNA_HORA = new Date(AHORA + 3_600_000);
const HACE_UNA_HORA = new Date(AHORA - 3_600_000);

const FILA = {
  name: "PC-CAJA",
  codigoEnrolamientoHash: "hash-del-codigo",
  codigoEnrolamientoExpira: EN_UNA_HORA,
};

describe("diagnosticarCodigo", () => {
  it("vigente: el código es de este equipo y no ha caducado", () => {
    const d = diagnosticarCodigo({
      fila: FILA,
      coincideConLaFila: true,
      duenoDelCodigo: { name: "PC-CAJA" },
      ahoraMs: AHORA,
    });
    expect(d.estado).toBe(ESTADO_CODIGO.VIGENTE);
  });

  it("caducado: coincide, pero su hora ya pasó", () => {
    const d = diagnosticarCodigo({
      fila: { ...FILA, codigoEnrolamientoExpira: HACE_UNA_HORA },
      coincideConLaFila: true,
      duenoDelCodigo: { name: "PC-CAJA" },
      ahoraMs: AHORA,
    });
    expect(d.estado).toBe(ESTADO_CODIGO.CADUCADO);
    expect(d.detalle).toContain("caducó");
  });

  it("otro-equipo: el código consta atado a otra fila (el duplicado nombre/IP)", () => {
    const d = diagnosticarCodigo({
      fila: { ...FILA, codigoEnrolamientoHash: null },
      coincideConLaFila: false,
      duenoDelCodigo: { name: "172.26.125.38" },
      ahoraMs: AHORA,
    });
    expect(d.estado).toBe(ESTADO_CODIGO.OTRO_EQUIPO);
    expect(d.detalle).toContain("172.26.125.38");
  });

  it("otro-equipo aunque no exista fila para el nombre presentado", () => {
    const d = diagnosticarCodigo({
      fila: null,
      coincideConLaFila: false,
      duenoDelCodigo: { name: "PC-TALLER" },
      ahoraMs: AHORA,
    });
    expect(d.estado).toBe(ESTADO_CODIGO.OTRO_EQUIPO);
  });

  it("no-coincide: la fila tiene un código vivo, pero es otro (el nuevo invalidó a este)", () => {
    const d = diagnosticarCodigo({
      fila: FILA,
      coincideConLaFila: false,
      duenoDelCodigo: null,
      ahoraMs: AHORA,
    });
    expect(d.estado).toBe(ESTADO_CODIGO.NO_COINCIDE);
  });

  it("sin-codigo: la fila no guarda ningún código (gastado o nunca generado)", () => {
    const d = diagnosticarCodigo({
      fila: { ...FILA, codigoEnrolamientoHash: null, codigoEnrolamientoExpira: null },
      coincideConLaFila: false,
      duenoDelCodigo: null,
      ahoraMs: AHORA,
    });
    expect(d.estado).toBe(ESTADO_CODIGO.SIN_CODIGO);
  });

  it("sin-equipo: no hay fila para ese nombre ni código en ningún sitio", () => {
    const d = diagnosticarCodigo({
      fila: null,
      coincideConLaFila: false,
      duenoDelCodigo: null,
      ahoraMs: AHORA,
    });
    expect(d.estado).toBe(ESTADO_CODIGO.SIN_EQUIPO);
  });
});
