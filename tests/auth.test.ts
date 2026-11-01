import { describe, expect, it } from "vitest";
import { generateApiKey, hashPassword, verifyPassword } from "@/lib/auth";

describe("contraseñas (auth)", () => {
  it("hashPassword guarda con el prefijo argon2id$ del proyecto", async () => {
    const stored = await hashPassword("ClaveSegura123!");
    expect(stored.startsWith("argon2id$")).toBe(true);
  });

  it("la contraseña correcta verifica y la incorrecta no", async () => {
    const stored = await hashPassword("ClaveSegura123!");
    expect((await verifyPassword("ClaveSegura123!", stored)).valid).toBe(true);
    expect((await verifyPassword("otra-clave", stored)).valid).toBe(false);
  });

  it("un hash PHC «pelado», sin el prefijo, NO verifica (contrato del formato)", async () => {
    const stored = await hashPassword("ClaveSegura123!");
    const barePhc = stored.slice("argon2id$".length);
    expect(barePhc.startsWith("$argon2id$")).toBe(true);
    expect((await verifyPassword("ClaveSegura123!", barePhc)).valid).toBe(
      false
    );
  });

  it("un valor que no es un hash no verifica ni rompe", async () => {
    expect((await verifyPassword("x", "basura")).valid).toBe(false);
    expect((await verifyPassword("x", "")).valid).toBe(false);
  });

  it("generateApiKey produce claves uk_ únicas", () => {
    const a = generateApiKey();
    const b = generateApiKey();
    expect(a.startsWith("uk_")).toBe(true);
    expect(a).not.toBe(b);
  });
});
