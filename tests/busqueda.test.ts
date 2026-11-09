import { describe, expect, it } from "vitest";

import {
  filtrarRegistros,
  normalizarConsulta,
  normalizarTexto,
  textosBuscables,
  textosCoinciden,
} from "@/lib/busqueda";

// Registros de ejemplo con la forma de las pestañas que filtran
// en cliente: equipos (nombre/IP) y lista blanca (serial/alias/
// notas, con campos que pueden ser nulos).
interface Equipo {
  name: string;
  ipAddress: string;
}

interface EntradaLista {
  serialNumber: string;
  label: string | null;
  notes: string | null;
}

const EQUIPOS: Equipo[] = [
  { name: "Cámara Sur", ipAddress: "172.26.125.38" },
  { name: "PC-RECEPCIÓN", ipAddress: "192.168.1.20" },
  { name: "Servidor Ñandú", ipAddress: "10.0.0.5" },
];

const ENTRADAS: EntradaLista[] = [
  { serialNumber: "ABC-123", label: "Memoria de Ana", notes: null },
  { serialNumber: "XYZ-999", label: null, notes: "Disco de respaldo" },
];

describe("normalizarTexto", () => {
  it("quita acentos y pasa a minúsculas", () => {
    expect(normalizarTexto("Cámara Ñandú ÁÉÍÓÚ")).toBe("camara nandu aeiou");
  });

  it("deja igual lo que no tiene marcas", () => {
    expect(normalizarTexto("pc-01 172.26")).toBe("pc-01 172.26");
  });
});

describe("normalizarConsulta", () => {
  it("recorta los espacios de los extremos", () => {
    expect(normalizarConsulta("  cámara  ")).toBe("camara");
  });

  it("una consulta de solo espacios queda vacía", () => {
    expect(normalizarConsulta("   ")).toBe("");
  });
});

describe("filtrarRegistros en equipos (nombre e IP)", () => {
  const campos = ["name", "ipAddress"] as const;

  it("encuentra datos acentuados con la consulta sin acentuar", () => {
    const r = filtrarRegistros(EQUIPOS, "camara", campos);
    expect(r.map((e) => e.name)).toEqual(["Cámara Sur"]);
  });

  it("encuentra datos sin acentuar con la consulta acentuada", () => {
    const r = filtrarRegistros(EQUIPOS, "recepción", campos);
    expect(r.map((e) => e.name)).toEqual(["PC-RECEPCIÓN"]);
  });

  it("no distingue mayúsculas", () => {
    const r = filtrarRegistros(EQUIPOS, "ÑANDÚ", campos);
    expect(r.map((e) => e.name)).toEqual(["Servidor Ñandú"]);
  });

  it("busca también en el segundo campo (la IP)", () => {
    const r = filtrarRegistros(EQUIPOS, "125.38", campos);
    expect(r.map((e) => e.name)).toEqual(["Cámara Sur"]);
  });

  it("con la consulta vacía devuelve la lista entera (el efecto de la ✕ de limpiar)", () => {
    expect(filtrarRegistros(EQUIPOS, "", campos)).toEqual(EQUIPOS);
    expect(filtrarRegistros(EQUIPOS, "   ", campos)).toEqual(EQUIPOS);
  });

  it("sin coincidencias devuelve una lista vacía", () => {
    expect(filtrarRegistros(EQUIPOS, "impresora", campos)).toEqual([]);
  });
});

describe("filtrarRegistros en lista blanca (varios campos, con nulos)", () => {
  const campos = ["serialNumber", "label", "notes"] as const;

  it("coincide por el alias aunque el serial no contenga la aguja", () => {
    const r = filtrarRegistros(ENTRADAS, "ana", campos);
    expect(r.map((e) => e.serialNumber)).toEqual(["ABC-123"]);
  });

  it("coincide por las notas y tolera campos nulos en el resto", () => {
    const r = filtrarRegistros(ENTRADAS, "respaldo", campos);
    expect(r.map((e) => e.serialNumber)).toEqual(["XYZ-999"]);
  });

  it("el campo nulo nunca coincide ni rompe el filtrado", () => {
    expect(filtrarRegistros(ENTRADAS, "null", campos)).toEqual([]);
  });
});

describe("piezas del índice (lo que memoiza useBusqueda)", () => {
  it("textosBuscables normaliza cada campo una vez", () => {
    expect(
      textosBuscables(ENTRADAS[0], ["serialNumber", "label", "notes"]),
    ).toEqual(["abc-123", "memoria de ana", ""]);
  });

  it("textosCoinciden con aguja vacía siempre coincide", () => {
    expect(textosCoinciden(["cualquier cosa"], "")).toBe(true);
  });

  it("textosCoinciden exige la subcadena en algún campo", () => {
    expect(textosCoinciden(["abc-123", "memoria de ana"], "ana")).toBe(true);
    expect(textosCoinciden(["abc-123", "memoria de ana"], "xyz")).toBe(false);
  });
});
