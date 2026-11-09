import { describe, expect, it } from "vitest";

import {
  elegirSobreviviente,
  esNombreIp,
  puntuarFila,
  type FilaEquipo,
} from "@/lib/identidadEquipo";

// Identidad única de equipos: las piezas puras que deciden
// cuál de dos filas duplicadas sobrevive a la fusión. La
// fusión en sí toca la base de datos y se verifica contra el
// clúster de pruebas; lo que aquí se fija es el criterio.

const AHORA = new Date("2026-11-08T12:00:00Z").getTime();

function fila(parcial: Partial<FilaEquipo>): FilaEquipo {
  return {
    id: "x",
    name: "PC-CAJA",
    ipAddress: "10.0.0.5",
    clavePublica: null,
    credencialAt: null,
    codigoEnrolamientoHash: null,
    codigoEnrolamientoExpira: null,
    lastSeen: null,
    createdAt: new Date("2026-11-01T00:00:00Z"),
    ...parcial,
  };
}

describe("esNombreIp", () => {
  it("reconoce una IPv4 escrita como nombre", () => {
    expect(esNombreIp("172.26.125.38")).toBe(true);
    expect(esNombreIp("10.0.0.5")).toBe(true);
  });

  it("no confunde nombres de PC con IPs", () => {
    expect(esNombreIp("PC-CAJA")).toBe(false);
    expect(esNombreIp("PC-1.2")).toBe(false);
    expect(esNombreIp("999.1.1.1")).toBe(false);
    expect(esNombreIp("")).toBe(false);
  });
});

describe("elegirSobreviviente", () => {
  it("gana la fila con la credencial del agente, aunque la otra tenga el nombre bueno", () => {
    const conClave = fila({
      id: "ip",
      name: "10.0.0.5",
      clavePublica: "SPKI...",
      credencialAt: new Date("2026-11-07T00:00:00Z"),
    });
    const conNombre = fila({ id: "nombre", name: "PC-CAJA" });
    expect(elegirSobreviviente(conNombre, conClave, AHORA).id).toBe("ip");
    expect(elegirSobreviviente(conClave, conNombre, AHORA).id).toBe("ip");
  });

  it("sin credenciales, gana la fila con nombre frente a la fila-IP", () => {
    const porIp = fila({ id: "ip", name: "10.0.0.5", lastSeen: new Date() });
    const porNombre = fila({ id: "nombre", name: "PC-CAJA" });
    expect(elegirSobreviviente(porIp, porNombre, AHORA).id).toBe("nombre");
  });

  it("un código de enrolamiento vivo pesa más que la antigüedad", () => {
    const conCodigo = fila({
      id: "codigo",
      name: "10.0.0.5",
      codigoEnrolamientoHash: "abc",
      codigoEnrolamientoExpira: new Date(AHORA + 60_000),
      createdAt: new Date("2026-11-08T00:00:00Z"),
    });
    const vieja = fila({
      id: "vieja",
      name: "10.0.0.5",
      createdAt: new Date("2026-10-01T00:00:00Z"),
    });
    expect(elegirSobreviviente(vieja, conCodigo, AHORA).id).toBe("codigo");
  });

  it("un código caducado no suma", () => {
    const caducado = fila({
      id: "caducado",
      codigoEnrolamientoHash: "abc",
      codigoEnrolamientoExpira: new Date(AHORA - 60_000),
    });
    const conSenal = fila({ id: "senal", lastSeen: new Date(AHORA - 1000) });
    expect(puntuarFila(caducado, AHORA)).toBeLessThan(
      puntuarFila(conSenal, AHORA),
    );
  });
});
