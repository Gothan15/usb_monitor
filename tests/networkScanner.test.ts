import { describe, expect, it } from "vitest";
import { ipRangeFromCIDR } from "@/lib/networkScanner";

describe("ipRangeFromCIDR (escáner de red)", () => {
  it("una /30 da sus dos direcciones útiles", () => {
    expect(ipRangeFromCIDR("198.19.0.0/30")).toEqual([
      "198.19.0.1",
      "198.19.0.2",
    ]);
  });

  it("una /31 da las dos direcciones (sin red/difusión útiles)", () => {
    expect(ipRangeFromCIDR("10.0.0.0/31")).toEqual(["10.0.0.0", "10.0.0.1"]);
  });

  it("una /32 da la dirección misma", () => {
    expect(ipRangeFromCIDR("10.0.0.7/32")).toEqual(["10.0.0.7"]);
  });

  it("una /24 da 254 direcciones, de la .1 a la .254", () => {
    const ips = ipRangeFromCIDR("192.168.1.0/24");
    expect(ips).toHaveLength(254);
    expect(ips[0]).toBe("192.168.1.1");
    expect(ips[ips.length - 1]).toBe("192.168.1.254");
  });

  it("normaliza la base a su red (10.0.0.55/24 empieza en .1)", () => {
    const ips = ipRangeFromCIDR("10.0.0.55/24");
    expect(ips[0]).toBe("10.0.0.1");
  });

  it("una red demasiado grande se rechaza con un error claro", () => {
    expect(() => ipRangeFromCIDR("10.0.0.0/16")).toThrow(/demasiado grande/);
  });

  it("un CIDR mal formado se rechaza", () => {
    expect(() => ipRangeFromCIDR("no-es-una-red")).toThrow(/no válido/);
    expect(() => ipRangeFromCIDR("10.0.0.0/33")).toThrow(/no válido/);
  });
});
