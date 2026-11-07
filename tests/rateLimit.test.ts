import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Rate limiting con un Redis falso en memoria: alcanza para probar
// el contrato (cuenta por Redis cuando está, memoria cuando no, y
// sin tormenta de reconexiones cuando está caído) sin un servidor.
const falso = vi.hoisted(() => ({
  contadores: new Map<string, { count: number; ttl: number }>(),
  fallarConexion: false,
  llamadasConnect: 0,
  llamadasEval: 0,
}));

vi.mock("ioredis", () => {
  class RedisFalso {
    status = "wait";
    on() {
      return this;
    }
    async connect() {
      falso.llamadasConnect++;
      if (falso.fallarConexion) {
        this.status = "end";
        throw new Error("ECONNREFUSED");
      }
      this.status = "ready";
    }
    async eval(
      _script: string,
      _numKeys: number,
      clave: string,
      ventanaMs: string,
    ) {
      falso.llamadasEval++;
      const entrada = falso.contadores.get(clave) ?? { count: 0, ttl: -1 };
      entrada.count++;
      if (entrada.ttl <= 0) entrada.ttl = Number(ventanaMs);
      falso.contadores.set(clave, entrada);
      return [entrada.count, entrada.ttl];
    }
  }
  return { default: RedisFalso };
});

async function cargarModulos() {
  vi.resetModules();
  return import("@/lib/rateLimit");
}

const CFG = { windowMs: 60_000, max: 2 };

describe("rate limiting (rateLimit)", () => {
  beforeEach(() => {
    falso.contadores.clear();
    falso.fallarConexion = false;
    falso.llamadasConnect = 0;
    falso.llamadasEval = 0;
    process.env.REDIS_URL = "redis://localhost:6379";
  });

  afterEach(() => {
    delete process.env.REDIS_URL;
    vi.restoreAllMocks();
  });

  it("con Redis cuenta por Redis y deniega al pasar el máximo", async () => {
    const { hit } = await cargarModulos();
    const ctx = { ip: "10.0.0.1" };
    await expect(hit("login", CFG, ctx)).resolves.toMatchObject({
      allowed: true,
      remaining: 1,
    });
    await expect(hit("login", CFG, ctx)).resolves.toMatchObject({
      allowed: true,
      remaining: 0,
    });
    await expect(hit("login", CFG, ctx)).resolves.toMatchObject({
      allowed: false,
      remaining: 0,
    });
    expect(falso.llamadasEval).toBe(3);
    expect(falso.llamadasConnect).toBe(1);
  });

  it("sin REDIS_URL cuenta en memoria con el mismo contrato", async () => {
    delete process.env.REDIS_URL;
    const { hit } = await cargarModulos();
    const ctx = { ip: "10.0.0.2" };
    await expect(hit("login", CFG, ctx)).resolves.toMatchObject({
      allowed: true,
      remaining: 1,
    });
    await expect(hit("login", CFG, ctx)).resolves.toMatchObject({
      allowed: true,
      remaining: 0,
    });
    await expect(hit("login", CFG, ctx)).resolves.toMatchObject({
      allowed: false,
    });
    expect(falso.llamadasEval).toBe(0);
  });

  it("con Redis caído cae a memoria y no reintenta conectar en cada petición", async () => {
    falso.fallarConexion = true;
    const { hit } = await cargarModulos();
    const ctx = { ip: "10.0.0.3" };
    await expect(hit("login", CFG, ctx)).resolves.toMatchObject({
      allowed: true,
    });
    await expect(hit("login", CFG, ctx)).resolves.toMatchObject({
      allowed: true,
    });
    // Un solo intento de conexión para las dos peticiones: el
    // freno tras el fallo evita la tormenta (y el log inundado).
    expect(falso.llamadasConnect).toBe(1);
    expect(falso.llamadasEval).toBe(0);
  });
});
