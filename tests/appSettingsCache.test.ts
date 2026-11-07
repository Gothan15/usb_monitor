import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Caché de ajustes en Redis con un servidor falso en memoria. El
// archivo real config/app_settings.json del repo es {} (todo por
// defecto), así que «leer de disco» da silenceThresholdMinutes = 5:
// si una lectura devuelve otro valor, vino de la caché.
const falso = vi.hoisted(() => ({
  almacen: new Map<string, string>(),
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
    async set(clave: string, valor: string) {
      falso.almacen.set(clave, valor);
      return "OK";
    }
    async get(clave: string) {
      return falso.almacen.get(clave) ?? null;
    }
    async del(clave: string) {
      return falso.almacen.delete(clave) ? 1 : 0;
    }
  }
  return { default: RedisFalso };
});

const CLAVE = "ajustes:app";

async function cargarModulos() {
  vi.resetModules();
  return import("@/lib/appSettings");
}

describe("caché de ajustes en Redis (appSettings)", () => {
  beforeEach(() => {
    falso.almacen.clear();
    falso.fallarConexion = false;
    process.env.REDIS_URL = "redis://localhost:6379";
  });

  afterEach(() => {
    delete process.env.REDIS_URL;
    vi.restoreAllMocks();
  });

  it("la primera lectura puebla la caché y la segunda lee de ella", async () => {
    const { readAppSettings } = await cargarModulos();
    const primera = await readAppSettings();
    expect(primera.silenceThresholdMinutes).toBe(5);
    expect(falso.almacen.has(CLAVE)).toBe(true);

    // Se «envenena» la caché: si la segunda lectura devuelve el
    // veneno, es que no pasó por el disco.
    falso.almacen.set(CLAVE, JSON.stringify({ silenceThresholdMinutes: 9 }));
    const segunda = await readAppSettings();
    expect(segunda.silenceThresholdMinutes).toBe(9);
  });

  it("invalidarCacheAjustes borra la clave y se vuelve al disco", async () => {
    const { readAppSettings, invalidarCacheAjustes } = await cargarModulos();
    await readAppSettings();
    falso.almacen.set(CLAVE, JSON.stringify({ silenceThresholdMinutes: 9 }));
    await invalidarCacheAjustes();
    expect(falso.almacen.has(CLAVE)).toBe(false);
    const trasInvalidar = await readAppSettings();
    expect(trasInvalidar.silenceThresholdMinutes).toBe(5);
  });

  it("sin REDIS_URL se lee el disco como siempre", async () => {
    delete process.env.REDIS_URL;
    const { readAppSettings } = await cargarModulos();
    const ajustes = await readAppSettings();
    expect(ajustes.silenceThresholdMinutes).toBe(5);
    expect(ajustes.passwordUnlockEnabled).toBe(true);
    expect(falso.almacen.size).toBe(0);
  });

  it("con Redis caído se lee el disco sin lanzar", async () => {
    falso.fallarConexion = true;
    const { readAppSettings, invalidarCacheAjustes } = await cargarModulos();
    const ajustes = await readAppSettings();
    expect(ajustes.silenceThresholdMinutes).toBe(5);
    await expect(invalidarCacheAjustes()).resolves.toBeUndefined();
  });
});
