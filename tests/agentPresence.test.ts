import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Redis falso en memoria: alcanza para probar el contrato de la
// presencia (clave por equipo, TTL = umbral, null sin Redis) sin un
// servidor de verdad. El estado vive en vi.hoisted porque la fábrica
// de vi.mock se eleva por encima de las declaraciones del archivo.
const falso = vi.hoisted(() => ({
  almacen: new Map<string, string>(),
  pxPorClave: new Map<string, number>(),
  fallarConexion: false,
}));

vi.mock("ioredis", () => {
  class RedisFalso {
    status = "wait";
    on() {
      return this;
    }
    async connect() {
      if (falso.fallarConexion) throw new Error("ECONNREFUSED");
      this.status = "ready";
    }
    async set(clave: string, valor: string, modo?: string, px?: number) {
      falso.almacen.set(clave, valor);
      if (modo === "PX" && typeof px === "number") {
        falso.pxPorClave.set(clave, px);
      }
      return "OK";
    }
    async get(clave: string) {
      return falso.almacen.get(clave) ?? null;
    }
    async del(clave: string) {
      return falso.almacen.delete(clave) ? 1 : 0;
    }
    pipeline() {
      const comandos: Array<() => unknown> = [];
      const api = {
        exists: (clave: string) => {
          comandos.push(() => (falso.almacen.has(clave) ? 1 : 0));
          return api;
        },
        exec: async () => comandos.map((fn) => [null, fn()] as [null, unknown]),
      };
      return api;
    }
  }
  return { default: RedisFalso };
});

// Umbral fijo de 3 minutos para poder comprobar el TTL exacto.
vi.mock("@/lib/appSettings", () => ({
  readAppSettings: async () => ({ silenceThresholdMinutes: 3 }),
}));

async function cargarModulos() {
  vi.resetModules();
  return import("@/lib/agentPresence");
}

describe("presencia del agente en Redis (agentPresence)", () => {
  beforeEach(() => {
    falso.almacen.clear();
    falso.pxPorClave.clear();
    falso.fallarConexion = false;
    process.env.REDIS_URL = "redis://localhost:6379";
  });

  afterEach(() => {
    delete process.env.REDIS_URL;
    vi.restoreAllMocks();
  });

  it("el TTL es el umbral vigente con suelo de 2 minutos", async () => {
    const { ttlPresenciaMs } = await cargarModulos();
    expect(ttlPresenciaMs(5)).toBe(300_000);
    expect(ttlPresenciaMs(10)).toBe(600_000);
    expect(ttlPresenciaMs(1)).toBe(120_000);
    expect(ttlPresenciaMs(0)).toBe(300_000);
  });

  it("refrescarPresencia escribe la clave del equipo con el TTL del umbral", async () => {
    const { refrescarPresencia, clavePresencia } = await cargarModulos();
    await refrescarPresencia("pc-1");
    expect(falso.almacen.has(clavePresencia("pc-1"))).toBe(true);
    expect(falso.pxPorClave.get(clavePresencia("pc-1"))).toBe(180_000);
  });

  it("leerPresencias distingue presentes y ausentes", async () => {
    const { refrescarPresencia, leerPresencias } = await cargarModulos();
    await refrescarPresencia("pc-1");
    const mapa = await leerPresencias(["pc-1", "pc-2"]);
    expect(mapa).not.toBeNull();
    expect(mapa?.get("pc-1")).toBe(true);
    expect(mapa?.get("pc-2")).toBe(false);
  });

  it("sin REDIS_URL no hay presencia: leer devuelve null y refrescar no lanza", async () => {
    delete process.env.REDIS_URL;
    const { refrescarPresencia, leerPresencias } = await cargarModulos();
    await expect(refrescarPresencia("pc-1")).resolves.toBeUndefined();
    await expect(leerPresencias(["pc-1"])).resolves.toBeNull();
    expect(falso.almacen.size).toBe(0);
  });

  it("con Redis caído todo cae al respaldo sin lanzar", async () => {
    falso.fallarConexion = true;
    const { refrescarPresencia, leerPresencias } = await cargarModulos();
    await expect(refrescarPresencia("pc-1")).resolves.toBeUndefined();
    await expect(leerPresencias(["pc-1"])).resolves.toBeNull();
  });
});
