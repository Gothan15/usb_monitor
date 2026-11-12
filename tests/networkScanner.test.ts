import { createServer } from "net";
import { describe, expect, it } from "vitest";
import * as escaner from "@/lib/networkScanner";
import {
  analizarCidr,
  datosEscaneoNegativo,
  datosEscaneoPositivo,
  filtrarVecinosPorRedes,
  numeroAIp,
  ordenarRedesPorPreferencia,
  reporteEsReciente,
  VENTANA_REPORTE_AGENTE_MS,
  parsearVecinosArpUnix,
  parsearVecinosArpWindows,
  parsearVecinosIpNeigh,
  parsearVecinosProcNetArp,
  planificarCobertura,
  sondearPuertoTcp,
  unirVecinos,
  type NetworkInterfaceInfo,
  type VecinoRed,
} from "@/lib/networkScanner";

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

function totalIntervalos(intervalos: Array<{ desde: number; hasta: number }>) {
  return intervalos.reduce((acc, i) => acc + (i.hasta - i.desde + 1), 0);
}

function intervalosContienen(
  intervalos: Array<{ desde: number; hasta: number }>,
  ip: string
) {
  const n = escaner.ipANumero(ip);
  return intervalos.some((i) => n >= i.desde && n <= i.hasta);
}

// ════════════════ Parsers de la tabla de vecinos ════════════════

describe("parsearVecinosArpWindows (arp -a de Windows)", () => {
  // Salida realista de un Windows en español: bloques por interfaz,
  // líneas IP / MAC con guiones / tipo. Entran también la difusión
  // y el multicast, que no son equipos y deben quedar fuera.
  const fixture = `
Interface: 192.168.1.50 --- 0x6
  Internet Address      Physical Address      Type
  192.168.1.1           aa-bb-cc-dd-ee-01     dynamic
  192.168.1.23          AA-BB-CC-DD-EE-17     dynamic
  192.168.1.255         ff-ff-ff-ff-ff-ff     static
  224.0.0.22            01-00-5e-00-00-16     static
  255.255.255.255       ff-ff-ff-ff-ff-ff     static

Interface: 172.26.112.1 --- 0x12
  Internet Address      Physical Address      Type
  172.26.125.38         00-0c-29-3a-7b-9c     dynamic
`;

  it("extrae IP y MAC normalizada (minúsculas, con dos puntos)", () => {
    const vecinos = parsearVecinosArpWindows(fixture);
    expect(vecinos).toContainEqual({ ip: "192.168.1.1", mac: "aa:bb:cc:dd:ee:01" });
    expect(vecinos).toContainEqual({ ip: "192.168.1.23", mac: "aa:bb:cc:dd:ee:17" });
    expect(vecinos).toContainEqual({ ip: "172.26.125.38", mac: "00:0c:29:3a:7b:9c" });
  });

  it("descarta difusión y multicast", () => {
    const ips = parsearVecinosArpWindows(fixture).map((v) => v.ip);
    expect(ips).not.toContain("192.168.1.255");
    expect(ips).not.toContain("224.0.0.22");
    expect(ips).not.toContain("255.255.255.255");
    expect(ips).toHaveLength(3);
  });
});

describe("parsearVecinosIpNeigh (ip neigh de Linux)", () => {
  const fixture = `
192.168.1.1 dev eth0 lladdr aa:bb:cc:dd:ee:01 REACHABLE
192.168.1.23 dev eth0 lladdr aa:bb:cc:dd:ee:17 STALE
192.168.1.40 dev eth0 FAILED
192.168.1.41 dev eth0 INCOMPLETE
fe80::1 dev eth0 lladdr aa:bb:cc:dd:ee:99 router REACHABLE
10.0.0.1 dev wg0 lladdr 00:0c:29:3a:7b:9c DELAY
192.168.1.255 dev eth0 lladdr ff:ff:ff:ff:ff:ff PERMANENT
`;

  it("se queda con los resueltos y descarta fallidos, IPv6 y difusión", () => {
    const vecinos = parsearVecinosIpNeigh(fixture);
    expect(vecinos).toContainEqual({ ip: "192.168.1.1", mac: "aa:bb:cc:dd:ee:01" });
    expect(vecinos).toContainEqual({ ip: "192.168.1.23", mac: "aa:bb:cc:dd:ee:17" });
    expect(vecinos).toContainEqual({ ip: "10.0.0.1", mac: "00:0c:29:3a:7b:9c" });
    const ips = vecinos.map((v) => v.ip);
    expect(ips).not.toContain("192.168.1.40");
    expect(ips).not.toContain("192.168.1.41");
    expect(ips).not.toContain("192.168.1.255");
    expect(ips).toHaveLength(3);
  });
});

describe("parsearVecinosProcNetArp (/proc/net/arp)", () => {
  const fixture = `IP address       HW type     Flags       HW address            Mask     Device
192.168.1.1      0x1         0x2         aa:bb:cc:dd:ee:01     *        eth0
192.168.1.50     0x1         0x0         00:00:00:00:00:00     *        eth0
`;

  it("salta la cabecera y las entradas incompletas (flags 0x0)", () => {
    expect(parsearVecinosProcNetArp(fixture)).toEqual([
      { ip: "192.168.1.1", mac: "aa:bb:cc:dd:ee:01" },
    ]);
  });
});

describe("parsearVecinosArpUnix (arp -a de macOS)", () => {
  const fixture = `
? (192.168.1.1) at aa:bb:cc:dd:ee:1 on en0 ifscope [ethernet]
? (192.168.1.60) at (incomplete) on en0 ifscope [ethernet]
`;

  it("normaliza la MAC sin ceros y descarta los incompletos", () => {
    expect(parsearVecinosArpUnix(fixture)).toEqual([
      { ip: "192.168.1.1", mac: "aa:bb:cc:dd:ee:01" },
    ]);
  });
});

// ════════════════ Plan de cobertura ════════════════

describe("planificarCobertura", () => {
  it("una /24 se barre entera: 254 direcciones, cobertura completa", () => {
    const [objetivo] = planificarCobertura([red("Ethernet", "ethernet")]);
    expect(objetivo.coberturaCompleta).toBe(true);
    expect(objetivo.cidr).toBe("192.168.1.0/24");
    expect(totalIntervalos(objetivo.intervalos)).toBe(254);
    expect(objetivo.intervalos[0]).toEqual({
      desde: escaner.ipANumero("192.168.1.1"),
      hasta: escaner.ipANumero("192.168.1.254"),
    });
  });

  it("una /16 se barre entera: 65.534 direcciones", () => {
    const [objetivo] = planificarCobertura([
      red("Ethernet", "ethernet", "10.35.7.9/16"),
    ]);
    expect(objetivo.coberturaCompleta).toBe(true);
    expect(objetivo.cidr).toBe("10.35.0.0/16");
    expect(totalIntervalos(objetivo.intervalos)).toBe(65_534);
  });

  it("el caso de la VM: la red del hipervisor /20 se barre entera y la VM cae dentro", () => {
    // Adaptador tipo VMware host-only en 172.26.112.1/20 y la VM en
    // 172.26.125.38: con el motor anterior (ventana /24 alrededor de
    // la IP propia de OTRA red) la VM jamás aparecía.
    const objetivos = planificarCobertura([
      red("Ethernet", "ethernet", "192.168.1.50/24"),
      red("VMware Network Adapter VMnet1", "ethernet", "172.26.112.1/20"),
    ]);
    expect(objetivos).toHaveLength(2);
    const deLaVm = objetivos.find((o) => o.cidr === "172.26.112.0/20");
    expect(deLaVm?.coberturaCompleta).toBe(true);
    expect(deLaVm && intervalosContienen(deLaVm.intervalos, "172.26.125.38")).toBe(true);
  });

  it("una /8 no se barre a ciegas: ventanas /24 de la IP propia y de los vecinos conocidos, con parcial", () => {
    const conocidos: VecinoRed[] = [
      { ip: "10.5.5.5", mac: "aa:bb:cc:dd:ee:05" },
      { ip: "192.168.1.1", mac: "aa:bb:cc:dd:ee:01" }, // de otra red: no cuenta
    ];
    const [objetivo] = planificarCobertura(
      [red("Ethernet", "ethernet", "10.200.30.40/8")],
      conocidos
    );
    expect(objetivo.coberturaCompleta).toBe(false);
    expect(objetivo.motivoParcial).toMatch(/mayor que una \/16/);
    expect(objetivo.intervalos).toHaveLength(2);
    expect(intervalosContienen(objetivo.intervalos, "10.200.30.40")).toBe(true);
    expect(intervalosContienen(objetivo.intervalos, "10.5.5.5")).toBe(true);
    expect(intervalosContienen(objetivo.intervalos, "10.99.99.99")).toBe(false);
    // Dos ventanas /24 como mucho: 512 direcciones, no 16 millones.
    expect(totalIntervalos(objetivo.intervalos)).toBeLessThanOrEqual(512);
  });

  it("dos interfaces en la misma red producen un solo objetivo", () => {
    const objetivos = planificarCobertura([
      red("Ethernet", "ethernet", "192.168.1.50/24"),
      red("Ethernet 2", "ethernet", "192.168.1.60/24"),
    ]);
    expect(objetivos).toHaveLength(1);
  });

  it("un CIDR mal formado se salta sin lanzar", () => {
    expect(planificarCobertura([red("Rara", "other", "no-es-una-red")])).toEqual([]);
    expect(analizarCidr("10.0.0.0/33")).toBeNull();
  });
});

// ════════════════ Unión y acotación de vecinos ════════════════

describe("unirVecinos y filtrarVecinosPorRedes", () => {
  it("une fase 0 y fase 1 sin duplicar IPs", () => {
    const fase0: VecinoRed[] = [{ ip: "192.168.1.1", mac: "aa:bb:cc:dd:ee:01" }];
    const fase1: VecinoRed[] = [
      { ip: "192.168.1.1", mac: "aa:bb:cc:dd:ee:01" },
      { ip: "192.168.1.23", mac: "aa:bb:cc:dd:ee:17" },
    ];
    const unidos = unirVecinos(fase0, null, fase1);
    expect(unidos).toHaveLength(2);
    expect(unidos.map((v) => v.ip).sort()).toEqual(["192.168.1.1", "192.168.1.23"]);
  });

  it("solo cuentan los vecinos de las redes escaneadas", () => {
    const objetivos = planificarCobertura([
      red("Ethernet", "ethernet", "192.168.1.50/24"),
    ]);
    const vecinos: VecinoRed[] = [
      { ip: "192.168.1.23", mac: "aa:bb:cc:dd:ee:17" },
      { ip: "203.0.113.9", mac: "aa:bb:cc:dd:ee:09" }, // puerta de otra red
    ];
    const filtrados = filtrarVecinosPorRedes(vecinos, objetivos);
    expect(filtrados).toEqual([{ ip: "192.168.1.23", mac: "aa:bb:cc:dd:ee:17" }]);
  });
});

// ════════════════ Reserva TCP ════════════════

describe("sondearPuertoTcp (reserva sin tabla de vecinos)", () => {
  it("detecta el puerto abierto y no el cerrado", async () => {
    const servidor = createServer(() => {});
    await new Promise<void>((resolve) =>
      servidor.listen(0, "127.0.0.1", () => resolve())
    );
    const puerto = (servidor.address() as { port: number }).port;
    // Un puerto efímero que se abre y se cierra: queda libre y sirve
    // como «cerrado» sin depender de que un puerto fijo lo esté.
    const efimero = createServer(() => {});
    await new Promise<void>((resolve) =>
      efimero.listen(0, "127.0.0.1", () => resolve())
    );
    const puertoCerrado = (efimero.address() as { port: number }).port;
    await new Promise<void>((resolve) => efimero.close(() => resolve()));
    try {
      const abiertos = await sondearPuertoTcp(["127.0.0.1"], puerto, {
        timeoutMs: 500,
      });
      expect(abiertos.has("127.0.0.1")).toBe(true);
      const cerrados = await sondearPuertoTcp(["127.0.0.1"], puertoCerrado, {
        timeoutMs: 300,
      });
      expect(cerrados.size).toBe(0);
    } finally {
      await new Promise<void>((resolve) => servidor.close(() => resolve()));
    }
  });
});

// ════════════════ Sin restos del motor anterior ════════════════

describe("overhaul: el motor anterior desaparece", () => {
  it("ya no se exportan ni la ventana /24 ni el rango limitado", () => {
    expect((escaner as Record<string, unknown>).scanRangeFromCIDR).toBeUndefined();
    expect((escaner as Record<string, unknown>).ipRangeFromCIDR).toBeUndefined();
  });

  it("el resultado de un host admite la MAC descubierta", () => {
    const host: escaner.HostScanResult = {
      ip: "192.168.1.23",
      alive: true,
      mac: "aa:bb:cc:dd:ee:17",
    };
    expect(host.mac).toBe("aa:bb:cc:dd:ee:17");
    expect(numeroAIp(0)).toBe("0.0.0.0");
  });
});

// ════════════════ Orden de interfaces (se conserva) ════════════════

describe("ordenarRedesPorPreferencia", () => {
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


describe("agente fantasma: el escaneo no se testifica a sí mismo", () => {
  // El bug: un agente desinstalado seguía saliendo «instalado»
  // en cada escaneo, porque (1) el respaldo por reporte reciente
  // miraba un lastSeen que el propio escaneo refrescaba al
  // persistir, y (2) ningún escaneo limpiaba las marcas de un
  // equipo conocido cuyo agente ya no responde.

  const AHORA = Date.parse("2026-11-12T10:00:00Z");

  it("reporteEsReciente: dentro de la ventana cuenta como vivo", () => {
    const senal = new Date(AHORA - (VENTANA_REPORTE_AGENTE_MS - 1_000));
    expect(reporteEsReciente(senal, AHORA)).toBe(true);
  });

  it("reporteEsReciente: cumplida la ventana, el reporte ya no resucita", () => {
    const senal = new Date(AHORA - VENTANA_REPORTE_AGENTE_MS);
    expect(reporteEsReciente(senal, AHORA)).toBe(false);
    const vieja = new Date(AHORA - 60 * 60_000);
    expect(reporteEsReciente(vieja, AHORA)).toBe(false);
  });

  it("el positivo al actualizar NO toca lastSeen (la señal es del agente)", () => {
    const datos = datosEscaneoPositivo({
      name: "PC-CAJA",
      ip: "192.168.1.60",
      lastSeenAt: new Date(AHORA),
      isActive: true,
      serviceInstalled: true,
      serviceRunning: true,
      lastServiceCheck: new Date(AHORA),
    });
    expect(datos).not.toHaveProperty("lastSeen");
    expect(datos.serviceInstalled).toBe(true);
    expect(datos.serviceRunning).toBe(true);
    expect(datos.lastServiceCheck).toEqual(new Date(AHORA));
  });

  it("el negativo limpia las marcas y solo las marcas", () => {
    const datos = datosEscaneoNegativo({
      lastServiceCheck: new Date(AHORA),
    });
    expect(datos.serviceInstalled).toBe(false);
    expect(datos.serviceRunning).toBe(false);
    expect(datos.lastServiceCheck).toEqual(new Date(AHORA));
    expect(datos).not.toHaveProperty("lastSeen");
    expect(datos).not.toHaveProperty("isActive");
    expect(datos).not.toHaveProperty("ipAddress");
  });
});
