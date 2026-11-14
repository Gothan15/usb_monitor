import { afterEach, describe, expect, it, vi } from "vitest";

import { imprimirBannerPanel } from "@/lib/banner";

// La portada de arranque: el borde derecho tiene que caer en la
// misma columna en TODAS las filas (bordes incluidos), ningún
// valor puede cortarse a mitad y el aviso va dentro de la caja.
describe("portada de arranque", () => {
  afterEach(() => vi.restoreAllMocks());

  function capturar(origenes: string, aviso?: string): string[] {
    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    imprimirBannerPanel({
      versionNext: "16.4.5",
      local: "http://localhost:3000",
      red: "http://100.92.235.66:3000",
      modo: "HTTP/1.1",
      socketLocal: "ws://localhost:3000/api/socketio",
      socketRed: "ws://100.92.235.66:3000/api/socketio",
      origenes,
      aviso,
    });
    const salida = String(info.mock.calls[0]?.[0] ?? "");
    // Sin TTY en las pruebas no hay códigos de color: se mide tal cual.
    return salida.replace(/\x1b\[[0-9;]*m/g, "").split("\n");
  }

  it("todas las filas miden lo mismo que los bordes, con orígenes largos", () => {
    const lineas = capturar(
      "https://usbmonitor.local, http://localhost:3000, http://100.92.235.66:3000",
      "TLS no configurado. El tráfico se sirve por HTTP.",
    );
    const ancho = lineas[0].length;
    expect(ancho).toBeGreaterThan(0);
    for (const linea of lineas) expect(linea.length).toBe(ancho);
  });

  it("ningún origen se corta: todos aparecen enteros", () => {
    const texto = capturar(
      "https://usbmonitor.local, http://localhost:3000, http://100.92.235.66:3000",
    ).join("\n");
    expect(texto).toContain("https://usbmonitor.local");
    expect(texto).toContain("http://localhost:3000");
    expect(texto).toContain("http://100.92.235.66:3000");
  });

  it("el aviso va dentro de la caja, como una fila más", () => {
    const lineas = capturar(
      "http://localhost:3000",
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
