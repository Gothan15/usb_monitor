import { describe, expect, it } from "vitest";

import {
  elegirDesbloqueador,
  esEventoDesbloqueo,
  type CandidatoDesbloqueo,
} from "@/lib/eventoDesbloqueo";

// ¿Quién desbloqueó?: la pieza pura que empareja un evento de
// desbloqueo con el bloqueo que lo autorizó. El cruce con la
// base de datos se verifica contra el clúster de pruebas; lo
// que aquí se fija es el criterio de elección.

const CUANDO = new Date("2026-11-12T10:00:00Z");

function candidato(
  parcial: Partial<CandidatoDesbloqueo>,
): CandidatoDesbloqueo {
  return {
    serialNumber: "SN-123",
    driveLetter: "E:",
    unlockedAt: new Date("2026-11-12T09:58:00Z"),
    nombre: "dueno",
    ...parcial,
  };
}

describe("esEventoDesbloqueo", () => {
  it("reconoce los desbloqueos consumados", () => {
    expect(esEventoDesbloqueo("UNLOCKED")).toBe(true);
    expect(esEventoDesbloqueo("EMERGENCY_UNLOCK")).toBe(true);
  });

  it("no marca el resto de eventos", () => {
    expect(esEventoDesbloqueo("BLOCKED")).toBe(false);
    expect(esEventoDesbloqueo("CONNECTED")).toBe(false);
    expect(esEventoDesbloqueo("DISCONNECTED")).toBe(false);
  });
});

describe("elegirDesbloqueador", () => {
  it("sin candidatos, el evento queda sin nombre", () => {
    expect(
      elegirDesbloqueador([], {
        serialNumber: "SN-123",
        driveLetter: "E:",
        cuando: CUANDO,
      }),
    ).toBeNull();
  });

  it("elige el bloqueo del mismo serial aunque haya otro más reciente", () => {
    const nombre = elegirDesbloqueador(
      [
        candidato({ nombre: "otro", serialNumber: "SN-999",
          unlockedAt: new Date("2026-11-12T09:59:30Z") }),
        candidato({ nombre: "dueno", serialNumber: "SN-123",
          unlockedAt: new Date("2026-11-12T09:55:00Z") }),
      ],
      { serialNumber: "SN-123", driveLetter: null, cuando: CUANDO },
    );
    expect(nombre).toBe("dueno");
  });

  it("entre bloqueos del mismo serial gana el más reciente", () => {
    const nombre = elegirDesbloqueador(
      [
        candidato({ nombre: "primero",
          unlockedAt: new Date("2026-11-12T09:50:00Z") }),
        candidato({ nombre: "segundo",
          unlockedAt: new Date("2026-11-12T09:58:00Z") }),
      ],
      { serialNumber: "SN-123", driveLetter: "E:", cuando: CUANDO },
    );
    expect(nombre).toBe("segundo");
  });

  it("sin serial en el evento, cruza por la letra de unidad", () => {
    const nombre = elegirDesbloqueador(
      [
        candidato({ nombre: "de-otra", driveLetter: "F:", serialNumber: null }),
        candidato({ nombre: "de-esta", driveLetter: "E:", serialNumber: null,
          unlockedAt: new Date("2026-11-12T09:52:00Z") }),
      ],
      { serialNumber: null, driveLetter: "E:", cuando: CUANDO },
    );
    expect(nombre).toBe("de-esta");
  });

  it("sin datos de dispositivo, gana el desbloqueo válido más reciente", () => {
    const nombre = elegirDesbloqueador(
      [
        candidato({ nombre: "viejo", serialNumber: null, driveLetter: null,
          unlockedAt: new Date("2026-11-12T08:00:00Z") }),
        candidato({ nombre: "reciente", serialNumber: null, driveLetter: null,
          unlockedAt: new Date("2026-11-12T09:57:00Z") }),
      ],
      { serialNumber: null, driveLetter: null, cuando: CUANDO },
    );
    expect(nombre).toBe("reciente");
  });

  it("un desbloqueo posterior al evento no puede ser el suyo", () => {
    const nombre = elegirDesbloqueador(
      [candidato({ unlockedAt: new Date("2026-11-12T10:30:00Z") })],
      { serialNumber: "SN-123", driveLetter: "E:", cuando: CUANDO },
    );
    expect(nombre).toBeNull();
  });

  it("la holgura admite el desbloqueo de segundos después (relojes)", () => {
    const nombre = elegirDesbloqueador(
      [candidato({ unlockedAt: new Date("2026-11-12T10:03:00Z") })],
      { serialNumber: "SN-123", driveLetter: "E:", cuando: CUANDO },
    );
    expect(nombre).toBe("dueno");
  });
});
