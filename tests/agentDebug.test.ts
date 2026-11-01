import { afterEach, describe, expect, it, vi } from "vitest";
import {
  contactosAgente,
  depuracionAgenteActiva,
  registrarContactoAgente,
} from "@/lib/agentDebug";

// El estado vive en globalThis y se comparte entre tests del archivo:
// cada test usa nombres de PC propios para no pisarse.
describe("depuración del agente (agentDebug)", () => {
  afterEach(() => {
    delete process.env.USB_MONITOR_DEBUG;
    vi.restoreAllMocks();
  });

  it("registrarContactoAgente acumula contactos por PC", () => {
    registrarContactoAgente("PC-PRUEBA-1", "/api/agent/ping", 200);
    registrarContactoAgente("PC-PRUEBA-1", "/api/usb-event", 200);

    const entrada = contactosAgente().find((c) => c.pc === "PC-PRUEBA-1");
    expect(entrada).toBeDefined();
    expect(entrada?.contactos).toBe(2);
    expect(entrada?.ultimaRuta).toBe("/api/usb-event");
    expect(entrada?.ultimoEstado).toBe(200);
    expect(entrada?.ultimoContacto).toBeInstanceOf(Date);
  });

  it("sin nombre de PC el contacto se guarda bajo «?»", () => {
    registrarContactoAgente(null, "/api/agent/config", 401);
    registrarContactoAgente(undefined, "/api/agent/config", 401);
    registrarContactoAgente("   ", "/api/agent/config", 401);

    const entrada = contactosAgente().find((c) => c.pc === "?");
    expect(entrada).toBeDefined();
    expect(entrada?.contactos).toBeGreaterThanOrEqual(3);
    expect(entrada?.ultimoEstado).toBe(401);
  });

  it("contactosAgente devuelve una copia, no el estado interno", () => {
    registrarContactoAgente("PC-PRUEBA-2", "/api/agent/ping", 200);
    const copia = contactosAgente();
    copia.length = 0;
    expect(contactosAgente().length).toBeGreaterThan(0);
  });

  it("depuracionAgenteActiva solo es true con USB_MONITOR_DEBUG=1", () => {
    delete process.env.USB_MONITOR_DEBUG;
    expect(depuracionAgenteActiva()).toBe(false);

    process.env.USB_MONITOR_DEBUG = "0";
    expect(depuracionAgenteActiva()).toBe(false);

    process.env.USB_MONITOR_DEBUG = "true";
    expect(depuracionAgenteActiva()).toBe(false);

    process.env.USB_MONITOR_DEBUG = "1";
    expect(depuracionAgenteActiva()).toBe(true);
  });

  it("con el modo activo, registrar imprime la línea [AGENTE]", () => {
    process.env.USB_MONITOR_DEBUG = "1";
    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    registrarContactoAgente("PC-PRUEBA-3", "/api/agent/ping", 200);
    const salida = info.mock.calls.map((c) => String(c[0])).join("\n");
    expect(salida).toContain("[AGENTE]");
    expect(salida).toContain("PC-PRUEBA-3");
    expect(salida).toContain("/api/agent/ping");
  });
});
