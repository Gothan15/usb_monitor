import { describe, expect, it } from "vitest";
import { aCsv, celdaCsv, rangoExportacion } from "@/lib/csv";

describe("celdaCsv", () => {
  it("deja pasar el texto simple", () => {
    expect(celdaCsv("ENDUSER-PC")).toBe("ENDUSER-PC");
    expect(celdaCsv(null)).toBe("");
    expect(celdaCsv(42)).toBe("42");
  });

  it("entrecomilla lo que lleva separador, comillas o saltos", () => {
    expect(celdaCsv("a;b")).toBe('"a;b"');
    expect(celdaCsv('dijo "hola"')).toBe('"dijo ""hola"""');
    expect(celdaCsv("una\nlínea")).toBe('"una\nlínea"');
  });
});

describe("aCsv", () => {
  it("encabeza con las columnas y separa con punto y coma", () => {
    const csv = aCsv(
      ["Equipo", "Evento"],
      [{ Equipo: "PC-1", Evento: "BLOCKED" }],
    );
    expect(csv.startsWith("\uFEFFEquipo;Evento\r\n")).toBe(true);
    expect(csv).toContain("PC-1;BLOCKED\r\n");
  });
});

describe("rangoExportacion", () => {
  const ahora = new Date("2026-11-18T12:00:00Z");

  it("sin parámetros: los últimos 30 días", () => {
    const rango = rangoExportacion(null, null, ahora);
    expect(rango?.hasta).toEqual(ahora);
    expect(rango?.desde).toEqual(new Date("2026-10-19T12:00:00Z"));
  });

  it("un «hasta» de solo fecha llega al final de ese día", () => {
    const rango = rangoExportacion("2026-11-01", "2026-11-18", ahora);
    expect(rango?.desde).toEqual(new Date("2026-11-01T00:00:00.000Z"));
    expect(rango?.hasta.getTime()).toBe(
      new Date("2026-11-18T00:00:00.000Z").getTime() + 86_399_999,
    );
  });

  it("una fecha ilegible devuelve null", () => {
    expect(rangoExportacion("ayer", null, ahora)).toBeNull();
  });
});
