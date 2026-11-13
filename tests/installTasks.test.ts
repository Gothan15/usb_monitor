import { describe, expect, it } from "vitest";

import {
  ESTADO_DESTINO,
  METODO,
  estadoDesdeEtapaEmpujador,
  estadoFinalTarea,
  resolverCredencialDestino,
  resolverMetodo,
  tareaPuedeBorrarse,
} from "@/lib/installTasks";
import {
  PASOS_EMPUJE_VM,
  estadoPasoEmpuje,
  pasosPreparacionCumplen,
} from "@/lib/empujeChecklist";
import { interpretarLineaEmpujador } from "@/lib/empujador";

const AHORA = new Date("2026-11-03T12:10:00Z").getTime();
const UMBRAL = 5 * 60_000;

describe("resolverMetodo", () => {
  it("AGENTE si reporta dentro del umbral y tiene token", () => {
    expect(
      resolverMetodo({
        lastSeen: new Date(AHORA - 60_000),
        tieneCredencial: true,
        ahora: AHORA,
        umbralMs: UMBRAL,
      }),
    ).toBe(METODO.AGENTE);
  });

  it("EMPUJE si la señal es más vieja que el umbral", () => {
    expect(
      resolverMetodo({
        lastSeen: new Date(AHORA - UMBRAL - 1),
        tieneCredencial: true,
        ahora: AHORA,
        umbralMs: UMBRAL,
      }),
    ).toBe(METODO.EMPUJE);
  });

  it("EMPUJE sin token o sin señal alguna", () => {
    expect(
      resolverMetodo({
        lastSeen: new Date(AHORA),
        tieneCredencial: false,
        ahora: AHORA,
        umbralMs: UMBRAL,
      }),
    ).toBe(METODO.EMPUJE);
    expect(
      resolverMetodo({
        lastSeen: null,
        tieneCredencial: true,
        ahora: AHORA,
        umbralMs: UMBRAL,
      }),
    ).toBe(METODO.EMPUJE);
  });
});

describe("resolverCredencialDestino", () => {
  const base = { usuario: "admin", clave: "general" };

  it("sin ajuste manda la general tal cual", () => {
    expect(resolverCredencialDestino(base)).toEqual(base);
    expect(resolverCredencialDestino(base, null)).toEqual(base);
    expect(resolverCredencialDestino(base, {})).toEqual(base);
  });

  it("con clave propia manda esa clave y el usuario general", () => {
    expect(resolverCredencialDestino(base, { clave: "suya" })).toEqual({
      usuario: "admin",
      clave: "suya",
    });
  });

  it("con usuario propio manda ese usuario y la clave general", () => {
    expect(resolverCredencialDestino(base, { usuario: "otro" })).toEqual({
      usuario: "otro",
      clave: "general",
    });
  });

  it("un usuario en blanco no pisa el general", () => {
    expect(
      resolverCredencialDestino(base, { usuario: "   ", clave: "suya" }),
    ).toEqual({ usuario: "admin", clave: "suya" });
  });
});

describe("estadoFinalTarea", () => {
  it("COMPLETADA solo con instalados y omitidos", () => {
    expect(estadoFinalTarea(["INSTALADO", "OMITIDO"])).toBe("COMPLETADA");
  });
  it("CON_ERRORES si alguno falló o quedó interrumpido", () => {
    expect(estadoFinalTarea(["INSTALADO", "ERROR"])).toBe("CON_ERRORES");
    expect(estadoFinalTarea(["INTERRUMPIDO"])).toBe("CON_ERRORES");
  });
});

describe("estadoDesdeEtapaEmpujador", () => {
  it("mapea las etapas del protocolo", () => {
    expect(estadoDesdeEtapaEmpujador("copia")).toBe(ESTADO_DESTINO.COPIANDO);
    expect(estadoDesdeEtapaEmpujador("servicio")).toBe(
      ESTADO_DESTINO.INSTALANDO,
    );
    expect(estadoDesdeEtapaEmpujador("conexion")).toBe(
      ESTADO_DESTINO.COMPROBANDO,
    );
    expect(estadoDesdeEtapaEmpujador("otra")).toBe(ESTADO_DESTINO.COMPROBANDO);
  });
});

describe("lista de verificación del empujón", () => {
  const todoVerde = [
    { id: "puerto445", ok: true },
    { id: "sesion", ok: true },
    { id: "scm", ok: true },
    { id: "instalado", ok: true },
  ];

  it("sin resultado todo queda sin-comprobar", () => {
    for (const paso of PASOS_EMPUJE_VM) {
      expect(estadoPasoEmpuje(paso, null)).toBe("sin-comprobar");
    }
  });

  it("un paso cumple solo con todos sus requisitos en verde", () => {
    const firewall = PASOS_EMPUJE_VM.find((p) => p.id === "firewall")!;
    expect(estadoPasoEmpuje(firewall, todoVerde)).toBe("cumple");
    expect(
      estadoPasoEmpuje(firewall, [
        { id: "puerto445", ok: true },
        { id: "scm", ok: false },
        { id: "sesion", ok: true },
        { id: "instalado", ok: true },
      ]),
    ).toBe("no-cumple");
    // Falta un requisito (la comprobación se detuvo antes):
    expect(
      estadoPasoEmpuje(firewall, [{ id: "puerto445", ok: true }]),
    ).toBe("sin-comprobar");
  });

  it("la preparación cumple sin exigir el paso «sin-agente»", () => {
    expect(pasosPreparacionCumplen(todoVerde)).toBe(true);
    const conAgente = todoVerde.map((c) =>
      c.id === "instalado" ? { ...c, ok: false } : c,
    );
    expect(pasosPreparacionCumplen(conAgente)).toBe(true);
    expect(pasosPreparacionCumplen(null)).toBe(false);
  });
});

describe("interpretarLineaEmpujador", () => {
  it("lee progreso y resultado del protocolo JSON", () => {
    expect(
      interpretarLineaEmpujador(
        '{"tipo":"progreso","etapa":"copia","detalle":"Copiando… 42 %","porcentaje":42}',
      ),
    ).toEqual({
      tipo: "progreso",
      etapa: "copia",
      detalle: "Copiando… 42 %",
      porcentaje: 42,
    });
    const r = interpretarLineaEmpujador(
      '{"tipo":"resultado","success":true,"message":"Bien","checks":[{"id":"scm","ok":true}],"yaInstalado":false}',
    );
    expect(r?.tipo).toBe("resultado");
    if (r?.tipo === "resultado") {
      expect(r.resultado.success).toBe(true);
      expect(r.resultado.yaInstalado).toBe(false);
      expect(r.resultado.checks?.[0].id).toBe("scm");
    }
  });

  it("ignora ruido que no sea JSON del empujador", () => {
    expect(interpretarLineaEmpujador("texto suelto")).toBeNull();
    expect(interpretarLineaEmpujador('{"tipo":"otro"}')).toBeNull();
    expect(interpretarLineaEmpujador("{roto")).toBeNull();
    expect(interpretarLineaEmpujador("")).toBeNull();
  });
});

describe("tareaPuedeBorrarse", () => {
  it("una tarea completada con destinos finales se puede borrar", () => {
    expect(
      tareaPuedeBorrarse({
        status: "COMPLETADA",
        estadosDestinos: ["INSTALADO", "OMITIDO"],
        enEjecucion: false,
      }),
    ).toBe(true);
  });

  it("una tarea con errores también (son las que se acumulan)", () => {
    expect(
      tareaPuedeBorrarse({
        status: "CON_ERRORES",
        estadosDestinos: ["ERROR", "INTERRUMPIDO"],
        enEjecucion: false,
      }),
    ).toBe(true);
  });

  it("una tarea EN_CURSO no se borra nunca", () => {
    expect(
      tareaPuedeBorrarse({
        status: "EN_CURSO",
        estadosDestinos: ["INSTALADO"],
        enEjecucion: false,
      }),
    ).toBe(false);
  });

  it("con un destino a medias no se borra aunque la tarea diga otra cosa", () => {
    expect(
      tareaPuedeBorrarse({
        status: "CON_ERRORES",
        estadosDestinos: ["INSTALADO", "COPIANDO"],
        enEjecucion: false,
      }),
    ).toBe(false);
  });

  it("si el ejecutor la tiene entre manos, no se borra", () => {
    expect(
      tareaPuedeBorrarse({
        status: "COMPLETADA",
        estadosDestinos: ["INSTALADO"],
        enEjecucion: true,
      }),
    ).toBe(false);
  });
});
