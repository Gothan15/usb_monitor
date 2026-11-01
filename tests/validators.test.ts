import { describe, expect, it } from "vitest";
import { sanitizers, usbEventPayloadSchema } from "@/lib/validators";
import { normalizeComputerName } from "@/lib/utils";

describe("ingesta de eventos (validators)", () => {
  const base = {
    pc_name: "PC-RECEPCION",
    pc_ip: "192.168.1.50",
    pc_user: "recepcion",
    event: "BLOCKED | Kingston",
  };

  it("acepta el payload snake_case del agente y normaliza la letra", () => {
    const parsed = usbEventPayloadSchema.parse({
      ...base,
      drive_letter: "e",
      serial_number: "AA0101",
      whitelisted: true,
    });
    expect(parsed.drive_letter).toBe("E:");
    expect(parsed.serial_number).toBe("AA0101");
  });

  it("sin letra (un móvil) también es válido", () => {
    const parsed = usbEventPayloadSchema.parse({ ...base });
    expect(parsed.drive_letter).toBeUndefined();
  });

  it("rechaza una IP que no es IPv4", () => {
    expect(() =>
      usbEventPayloadSchema.parse({ ...base, pc_ip: "999.1.1.1" })
    ).toThrow();
  });

  it("el saneador quita caracteres de control", () => {
    expect(sanitizers.sanitizeControlChars("ho\x00la\x07")).toBe("hola");
  });
});

describe("nombres de equipo (utils)", () => {
  it("se guardan en mayúsculas, recortados y sin controles", () => {
    expect(normalizeComputerName("  pc-caja\x02 ")).toBe("PC-CAJA");
    expect(normalizeComputerName("")).toBe("");
  });
});
