import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// El token CSRF sale del documento: se sustituye la utilidad
// por una doble para controlar qué «documento» ve la prueba.
vi.mock("@/lib/utils", () => ({
  getCsrfTokenFromDocument: () => tokenActual,
}));

let tokenActual = "";

import { HttpError, mutacionJson } from "@/lib/http";
import * as equiposApi from "@/lib/api/equipos";

// Doble de fetch que anota la última petición y responde lo
// que la prueba haya preparado en `respuestaSiguiente`.
let ultimaPeticion: { url: string; init: RequestInit } | null = null;
let respuestaSiguiente: Response | null = null;

function respuestaJson(cuerpo: unknown, status = 200): Response {
  return new Response(JSON.stringify(cuerpo), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

beforeEach(() => {
  tokenActual = "token-de-prueba";
  ultimaPeticion = null;
  respuestaSiguiente = null;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init: RequestInit) => {
      ultimaPeticion = { url, init };
      return respuestaSiguiente ?? respuestaJson({ ok: true });
    }),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("mutacionJson", () => {
  it("sin token CSRF no llama a la red y lanza el aviso de sesión", async () => {
    tokenActual = "";
    await expect(
      mutacionJson("/api/computers/reiniciar-servicio", "POST", { ids: [] }),
    ).rejects.toBeInstanceOf(HttpError);
    expect(ultimaPeticion).toBeNull();
  });

  it("pone el token, el tipo JSON y el cuerpo serializado", async () => {
    respuestaSiguiente = respuestaJson({ ok: true, creadas: [] });
    const datos = await mutacionJson<{ ok: boolean }>(
      "/api/computers/reiniciar-servicio",
      "POST",
      { ids: ["a", "b"] },
    );
    expect(datos.ok).toBe(true);
    const headers = ultimaPeticion!.init.headers as Record<string, string>;
    expect(headers["x-csrf-token"]).toBe("token-de-prueba");
    expect(headers["Content-Type"]).toBe("application/json");
    expect(ultimaPeticion!.init.method).toBe("POST");
    expect(JSON.parse(String(ultimaPeticion!.init.body))).toEqual({
      ids: ["a", "b"],
    });
  });

  it("sin cuerpo no manda Content-Type ni cuerpo", async () => {
    await mutacionJson("/api/computers/9/cancelar-apagado", "POST");
    const headers = ultimaPeticion!.init.headers as Record<string, string>;
    expect(headers["Content-Type"]).toBeUndefined();
    expect(ultimaPeticion!.init.body).toBeUndefined();
    expect(headers["x-csrf-token"]).toBe("token-de-prueba");
  });

  it("convierte el error del servidor en HttpError con su mensaje", async () => {
    respuestaSiguiente = respuestaJson(
      { ok: false, error: "El equipo no tiene el servicio en ejecución" },
      400,
    );
    const error = await mutacionJson("/api/x", "POST", {}).catch((e) => e);
    expect(error).toBeInstanceOf(HttpError);
    expect((error as HttpError).status).toBe(400);
    expect((error as HttpError).message).toBe(
      "El equipo no tiene el servicio en ejecución",
    );
  });
});

describe("servicio de equipos", () => {
  it("reiniciarServicio pide la ruta con los ids dados", async () => {
    respuestaSiguiente = respuestaJson({
      ok: true,
      creadas: [{ pcName: "PC-1" }],
      omitidas: [],
    });
    const datos = await equiposApi.reiniciarServicio(["id-1"]);
    expect(ultimaPeticion!.url).toBe("/api/computers/reiniciar-servicio");
    expect(JSON.parse(String(ultimaPeticion!.init.body))).toEqual({
      ids: ["id-1"],
    });
    expect(datos.creadas[0].pcName).toBe("PC-1");
  });

  it("estadoCredencial devuelve null si el servidor falla", async () => {
    respuestaSiguiente = respuestaJson({ ok: false, error: "No" }, 500);
    await expect(equiposApi.estadoCredencial("PC-1")).resolves.toBeNull();
  });
});
