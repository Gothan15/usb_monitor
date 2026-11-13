import { describe, expect, it } from "vitest";

import {
  direccionesIpv4Locales,
  origenesLocales,
} from "@/lib/direccionesLocales";

describe("direccionesIpv4Locales", () => {
  it("solo IPv4 reales: ni loopback ni enlace local", () => {
    for (const ip of direccionesIpv4Locales()) {
      expect(ip).toMatch(/^\d{1,3}(\.\d{1,3}){3}$/);
      expect(ip.startsWith("127.")).toBe(false);
      expect(ip.startsWith("169.254.")).toBe(false);
    }
  });

  it("sin duplicados", () => {
    const lista = direccionesIpv4Locales();
    expect(new Set(lista).size).toBe(lista.length);
  });
});

describe("origenesLocales", () => {
  it("cada dirección sale en http y en https con el puerto dado", () => {
    const origenes = origenesLocales(4321);
    for (const ip of direccionesIpv4Locales()) {
      expect(origenes).toContain(`http://${ip}:4321`);
      expect(origenes).toContain(`https://${ip}:4321`);
    }
    expect(origenes.length).toBe(direccionesIpv4Locales().length * 2);
  });
});
