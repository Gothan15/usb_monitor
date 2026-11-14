import { afterEach, describe, expect, it, vi } from "vitest";

import { imprimirBannerPanel } from "@/lib/banner";

// La portada de arranque: el borde derecho tiene que caer en la
// misma columna en TODAS las filas (bordes incluidos), ningún
// valor puede cortarse a mitad y el aviso va dentro de la caja.
// Sin filas de socket ni de orígenes: la tabla solo lleva las
// direcciones del panel, su modo y el aviso si lo hay.
describe("portada de arranque", () => {
  afterEach(() => vi.restoreAllMocks());

  function capturar(aviso?: string): string[] {
    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    imprimirBannerPanel({
      versionNext: "16.4.5",
      local: "http://localhost:3000",
      red: "http://172.29.176.1:3000",
      modo: "HTTP/1.1",
      aviso,
    });
    const salida = String(info.mock.calls[0]?.[0] ?? "");
    // Sin TTY en las pruebas no hay códigos de color: se mide tal cual.
    return salida.replace(/\x1b\[[0-9;]*m/g, "").split("\n");
  }

  it("todas las filas miden lo mismo que los bordes", () => {
    const lineas = capturar("TLS no configurado. El tráfico se sirve por HTTP.");
    const ancho = lineas[0].length;
    expect(ancho).toBeGreaterThan(0);
    for (const linea of lineas) expect(linea.length).toBe(ancho);
  });

  it("sin filas de socket ni de orígenes", () => {
    const texto = capturar().join("\n");
    expect(texto).not.toContain("Socket");
    expect(texto).not.toContain("Orígenes");
    expect(texto).not.toContain("socketio");
  });

  it("un valor largo se parte en continuaciones, sin cortarse", () => {
    const texto = capturar(
      "TLS no configurado. El tráfico se sirve por HTTP plano.",
    ).join("\n");
    expect(texto).toContain("TLS no configurado. El tráfico se sirve por HTTP");
    expect(texto).toContain("plano.");
  });

  it("el aviso va dentro de la caja, como una fila más", () => {
    const lineas = capturar(
      "TLS no configurado. El tráfico se sirve por HTTP.",
    );
    const conAviso = lineas.filter((l) => l.includes("TLS no configurado"));
    expect(conAviso.length).toBeGreaterThan(0);
    for (const linea of conAviso) {
      expect(linea.startsWith("║")).toBe(true);
      expect(linea.endsWith("║")).toBe(true);
    }
  });
});
