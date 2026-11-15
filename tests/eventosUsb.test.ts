import { describe, expect, it } from "vitest";

import {
  EVENTOS_APAGADO,
  apagadoEnCursoDesdeEvento,
  etiquetaEventoUsb,
} from "@/lib/eventosUsb";

// ── Etiquetas de la familia del apagado y la escalera ─────────
// Los códigos nuevos del overhaul (recuperación del apagado y
// los peldaños de la escalera) tienen que presentarse en
// español, no con el código crudo.
describe("etiquetaEventoUsb — apagado y escalera", () => {
  it("traduce los eventos del apagado", () => {
    expect(etiquetaEventoUsb("SHUTDOWN_ARMED")).toBe("Apagado programado");
    expect(etiquetaEventoUsb("SHUTDOWN_CANCELLED")).toBe("Apagado cancelado");
    expect(etiquetaEventoUsb("SHUTDOWN_RECOVERED")).toBe("Apagado recuperado");
    expect(etiquetaEventoUsb("SHUTDOWN_ORPHANED")).toBe("Apagado sin el agente");
  });

  it("traduce los peldaños de la escalera de respuesta", () => {
    expect(etiquetaEventoUsb("ESCALATION_WARNING")).toBe("Escalera: aviso");
    expect(etiquetaEventoUsb("ESCALATION_LOCK")).toBe(
      "Escalera: sesión bloqueada",
    );
  });
});

// ── ¿Sigue en curso la cuenta atrás? ──────────────────────────
// Equipos deriva «Apagado en curso» del ÚLTIMO evento de la
// familia: solo armarla o recuperarla la deja en curso.
describe("apagadoEnCursoDesdeEvento", () => {
  it("la arma y la recuperación la mantienen en curso", () => {
    expect(apagadoEnCursoDesdeEvento("SHUTDOWN_ARMED")).toBe(true);
    expect(apagadoEnCursoDesdeEvento("SHUTDOWN_RECOVERED")).toBe(true);
  });

  it("la cancelación y la orfandad la cierran", () => {
    expect(apagadoEnCursoDesdeEvento("SHUTDOWN_CANCELLED")).toBe(false);
    expect(apagadoEnCursoDesdeEvento("SHUTDOWN_ORPHANED")).toBe(false);
  });

  it("sin evento o con un evento ajeno, no hay cuenta", () => {
    expect(apagadoEnCursoDesdeEvento(null)).toBe(false);
    expect(apagadoEnCursoDesdeEvento(undefined)).toBe(false);
    expect(apagadoEnCursoDesdeEvento("BLOCKED")).toBe(false);
    expect(apagadoEnCursoDesdeEvento("ESCALATION_WARNING")).toBe(false);
  });

  it("tolera minúsculas y espacios del dato guardado", () => {
    expect(apagadoEnCursoDesdeEvento(" shutdown_armed ")).toBe(true);
  });

  it("la familia del apagado es justo la de abrir y cerrar", () => {
    expect([...EVENTOS_APAGADO].sort()).toEqual(
      [
        "SHUTDOWN_ARMED",
        "SHUTDOWN_CANCELLED",
        "SHUTDOWN_ORPHANED",
        "SHUTDOWN_RECOVERED",
      ].sort(),
    );
  });
});
