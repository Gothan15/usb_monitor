import { describe, expect, it } from "vitest";
import {
  PASOS_WINRM_VM,
  estadoPasoWinRM,
  todosPasosCumplen,
  type RequisitoComprobado,
} from "@/lib/winrmChecklist";

const paso = (id: string) => PASOS_WINRM_VM.find((p) => p.id === id)!;

const TODO_OK: RequisitoComprobado[] = [
  { id: "listener", ok: true },
  { id: "credenciales", ok: true },
  { id: "admin", ok: true },
  { id: "latfp", ok: true },
  { id: "basic", ok: true },
  { id: "unenc", ok: true },
  { id: "perfil", ok: true },
];

describe("estadoPasoWinRM", () => {
  it("sin comprobación, todo queda sin comprobar", () => {
    for (const p of PASOS_WINRM_VM) {
      expect(estadoPasoWinRM(p, null)).toBe("sin-comprobar");
    }
    expect(todosPasosCumplen(null)).toBe(false);
  });

  it("con todo en verde, los cinco pasos cumplen", () => {
    for (const p of PASOS_WINRM_VM) {
      expect(estadoPasoWinRM(p, TODO_OK)).toBe("cumple");
    }
    expect(todosPasosCumplen(TODO_OK)).toBe(true);
  });

  it("sin listener solo se marca ese paso; el resto no se inventa", () => {
    const checks = [{ id: "listener", ok: false }];
    expect(estadoPasoWinRM(paso("habilitar-winrm"), checks)).toBe("no-cumple");
    expect(estadoPasoWinRM(paso("cuenta-admin"), checks)).toBe("sin-comprobar");
    expect(estadoPasoWinRM(paso("basic"), checks)).toBe("sin-comprobar");
    expect(todosPasosCumplen(checks)).toBe(false);
  });

  it("un requisito en rojo marca su paso aunque los demás estén en verde", () => {
    const checks = TODO_OK.map((c) =>
      c.id === "basic" ? { ...c, ok: false } : c,
    );
    expect(estadoPasoWinRM(paso("basic"), checks)).toBe("no-cumple");
    expect(estadoPasoWinRM(paso("sin-cifrar"), checks)).toBe("cumple");
    expect(todosPasosCumplen(checks)).toBe(false);
  });

  it("el requisito combinado (HTTPS/dominio) también cubre AllowUnencrypted", () => {
    const checks = TODO_OK.filter((c) => c.id !== "unenc");
    expect(estadoPasoWinRM(paso("sin-cifrar"), checks)).toBe("cumple");
    expect(todosPasosCumplen(checks)).toBe(true);
  });

  it("la sesión recortada por UAC marca la cuenta aunque abra sesión", () => {
    const checks = TODO_OK.map((c) =>
      c.id === "admin" || c.id === "latfp" ? { ...c, ok: false } : c,
    );
    expect(estadoPasoWinRM(paso("cuenta-admin"), checks)).toBe("no-cumple");
    expect(estadoPasoWinRM(paso("habilitar-winrm"), checks)).toBe("no-cumple");
  });
});
