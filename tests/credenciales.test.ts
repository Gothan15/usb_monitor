import { createHash } from "crypto";

import { describe, expect, it } from "vitest";

import { codigoEnrolamientoValido } from "@/lib/credenciales";

// Validación del código de enrolamiento de un solo uso: el
// contrato que decide si un agente se acredita o recibe el
// 401. El hash esperado se calcula aquí igual que al generar
// (SHA-256 del código normalizado: sin guiones ni espacios,
// en mayúsculas) para fijar el formato entre las dos puntas.

function hashDe(codigo: string): string {
  const normalizado = codigo.replace(/[^a-zA-Z0-9]/g, "").toUpperCase();
  return createHash("sha256").update(normalizado, "utf8").digest("hex");
}

const VIVO = {
  codigoEnrolamientoHash: hashDe("ABCD-EFGH-JKMN"),
  codigoEnrolamientoExpira: new Date(Date.now() + 10 * 60_000),
};

describe("codigoEnrolamientoValido", () => {
  it("acepta el código tal como se enseña en el panel", () => {
    expect(codigoEnrolamientoValido(VIVO, "ABCD-EFGH-JKMN")).toBe(true);
  });

  it("acepta el código sin guiones, en minúsculas o con espacios", () => {
    expect(codigoEnrolamientoValido(VIVO, "abcdefghjkmn")).toBe(true);
    expect(codigoEnrolamientoValido(VIVO, " abcd efgh jkmn ")).toBe(true);
  });

  it("rechaza otro código", () => {
    expect(codigoEnrolamientoValido(VIVO, "WXYZ-2345-6789")).toBe(false);
  });

  it("rechaza el código correcto si ya caducó", () => {
    const caducado = {
      ...VIVO,
      codigoEnrolamientoExpira: new Date(Date.now() - 1000),
    };
    expect(codigoEnrolamientoValido(caducado, "ABCD-EFGH-JKMN")).toBe(false);
  });

  it("rechaza si la fila no tiene código (nunca se generó o ya se gastó)", () => {
    expect(
      codigoEnrolamientoValido(
        { codigoEnrolamientoHash: null, codigoEnrolamientoExpira: null },
        "ABCD-EFGH-JKMN",
      ),
    ).toBe(false);
  });
});
