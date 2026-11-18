import { describe, expect, it } from "vitest";

import { esIpDelServidor } from "@/lib/ipServidor";

// La lista blanca solo se cambia desde la PC del servidor:
// la regla pura que lo decide, sin red ni sistema operativo.
describe("esIpDelServidor", () => {
  const locales = ["192.168.1.50", "fe80::1", "172.29.176.1"];

  it("acepta el loopback IPv4 e IPv6 aunque no esté en la lista", () => {
    expect(esIpDelServidor("127.0.0.1", [])).toBe(true);
    expect(esIpDelServidor("::1", [])).toBe(true);
  });

  it("acepta una dirección propia de la máquina", () => {
    expect(esIpDelServidor("192.168.1.50", locales)).toBe(true);
    expect(esIpDelServidor("172.29.176.1", locales)).toBe(true);
  });

  it("rechaza la IP de otro equipo de la red", () => {
    expect(esIpDelServidor("192.168.1.77", locales)).toBe(false);
    expect(esIpDelServidor("172.29.176.1", ["192.168.1.50"])).toBe(false);
  });

  it("acepta la forma IPv4 mapeada en IPv6 de una dirección propia", () => {
    expect(esIpDelServidor("::ffff:192.168.1.50", locales)).toBe(true);
  });

  it("rechaza una IP vacía o ausente", () => {
    expect(esIpDelServidor("", locales)).toBe(false);
    expect(esIpDelServidor("   ", locales)).toBe(false);
  });
});
