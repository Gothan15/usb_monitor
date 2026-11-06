import { describe, expect, it } from "vitest";
import {
  ipRangeFromCIDR,
  ordenarRedesPorPreferencia,
  scanRangeFromCIDR,
  type NetworkInterfaceInfo,
} from "@/lib/networkScanner";

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

  it("un CIDR mal formado se rechaza", () => {
    expect(() => ipRangeFromCIDR("no-es-una-red")).toThrow(/no válido/);
    expect(() => ipRangeFromCIDR("10.0.0.0/33")).toThrow(/no válido/);
  });
});

describe("scanRangeFromCIDR (ventana cuando la red pasa el tope)", () => {
  it("una /24 no se limita: 254 direcciones y limitado=false", () => {
    const rango = scanRangeFromCIDR("192.168.1.0/24");
    expect(rango.limitado).toBe(false);
    expect(rango.totalDirecciones).toBe(254);
    expect(rango.cidrEscaneado).toBe("192.168.1.0/24");
    expect(rango.ips).toHaveLength(254);
  });

  it("una /22 (1022 útiles) aún cabe en el tope y no se limita", () => {
    const rango = scanRangeFromCIDR("10.0.0.0/22");
    expect(rango.limitado).toBe(false);
    expect(rango.ips).toHaveLength(1022);
  });

  it("una /16 ya no es un error: ventana /24 alrededor de la IP propia", () => {
    // El caso del bug: Ethernet empresarial en una /16, el equipo
    // es 10.35.7.9. Antes esto lanzaba «demasiado grande».
    const rango = scanRangeFromCIDR("10.35.7.9/16");
    expect(rango.limitado).toBe(true);
    expect(rango.totalDirecciones).toBe(65534);
    expect(rango.cidrEscaneado).toBe("10.35.7.0/24");
    expect(rango.ips).toHaveLength(254);
    expect(rango.ips[0]).toBe("10.35.7.1");
    expect(rango.ips[rango.ips.length - 1]).toBe("10.35.7.254");
    expect(rango.ips).toContain("10.35.7.9");
  });

  it("la ventana sigue a la IP base aunque la red sea una /8", () => {
    const rango = scanRangeFromCIDR("10.200.30.40/8");
    expect(rango.limitado).toBe(true);
    expect(rango.cidrEscaneado).toBe("10.200.30.0/24");
    expect(rango.ips).toHaveLength(254);
  });

  it("ipRangeFromCIDR devuelve la ventana en vez de lanzar", () => {
    expect(ipRangeFromCIDR("172.16.5.5/16")).toHaveLength(254);
  });

  it("una /31 y una /32 no se limitan (regresión)", () => {
    expect(scanRangeFromCIDR("10.0.0.0/31").limitado).toBe(false);
    expect(scanRangeFromCIDR("10.0.0.7/32").ips).toEqual(["10.0.0.7"]);
  });
});

describe("ordenarRedesPorPreferencia", () => {
  const red = (
    name: string,
    type: NetworkInterfaceInfo["type"],
    cidr = "192.168.1.50/24"
  ): NetworkInterfaceInfo => ({
    name,
    address: cidr.split("/")[0],
    cidr,
    mac: "",
    netmask: "255.255.255.0",
    type,
  });

  it("pone la Ethernet física antes que una VPN enumerada primero", () => {
    const ordenadas = ordenarRedesPorPreferencia([
      red("Tailscale", "vpn", "100.64.0.5/32"),
      red("Ethernet", "ethernet", "10.35.7.9/16"),
    ]);
    expect(ordenadas[0].name).toBe("Ethernet");
  });

  it("deja los adaptadores virtuales detrás de la Wi-Fi real", () => {
    const ordenadas = ordenarRedesPorPreferencia([
      red("VMware Network Adapter VMnet8", "ethernet", "192.168.80.1/24"),
      red("Wi-Fi", "wifi", "192.168.1.50/24"),
    ]);
    expect(ordenadas[0].name).toBe("Wi-Fi");
    expect(ordenadas[1].name).toContain("VMware");
  });

  it("es estable: a igual rango conserva el orden del sistema", () => {
    const ordenadas = ordenarRedesPorPreferencia([
      red("Ethernet", "ethernet"),
      red("Ethernet 2", "ethernet"),
    ]);
    expect(ordenadas.map((r) => r.name)).toEqual(["Ethernet", "Ethernet 2"]);
  });
});
