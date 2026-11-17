import { describe, expect, it } from "vitest";

import {
  ESTADO_DESTINO,
  ESTADO_TAREA,
  ESTADOS_DESTINO_FINALES,
  ETIQUETA_ESTADO_DESTINO,
  ETIQUETA_ESTADO_TAREA,
  METODO,
  credencialesCompletas,
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

describe("credencialesCompletas", () => {
  const general = { usuario: "admin", clave: "general" };

  it("sin destinos no hay tarea que crear", () => {
    expect(credencialesCompletas(general, [])).toBe(false);
  });

  it("con la general completa, todos van cubiertos sin ajustes", () => {
    expect(credencialesCompletas(general, [undefined, null, {}])).toBe(true);
  });

  it("sin general, cada destino necesita la suya", () => {
    const vacia = { usuario: "", clave: "" };
    expect(
      credencialesCompletas(vacia, [
        { usuario: "robertico", clave: "suya" },
        { clave: "otra" },
      ]),
    ).toBe(false);
    expect(
      credencialesCompletas(
        { usuario: "admin", clave: "" },
        [
          { usuario: "robertico", clave: "suya" },
          { clave: "otra" },
        ],
      ),
    ).toBe(true);
  });

  it("una clave propia sin usuario se completa con el usuario general", () => {
    expect(credencialesCompletas(general, [{ clave: "suya" }])).toBe(true);
    expect(
      credencialesCompletas({ usuario: "", clave: "general" }, [
        { clave: "suya" },
      ]),
    ).toBe(false);
  });

  it("un usuario suelto sin clave no forma ajuste: manda la general", () => {
    expect(
      credencialesCompletas({ usuario: "", clave: "" }, [
        { usuario: "robertico" },
      ]),
    ).toBe(false);
    expect(credencialesCompletas(general, [{ usuario: "robertico" }])).toBe(
      true,
    );
  });

  it("basta un destino sin cubrir para bloquear la creación", () => {
    expect(
      credencialesCompletas({ usuario: "", clave: "" }, [
        { usuario: "uno", clave: "suya" },
        undefined,
      ]),
    ).toBe(false);
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
  it("CANCELADA si todos los destinos quedaron cancelados", () => {
    expect(estadoFinalTarea(["CANCELADO"])).toBe("CANCELADA");
    expect(estadoFinalTarea(["CANCELADO", "CANCELADO"])).toBe("CANCELADA");
  });
  it("CANCELADA si alguno se canceló y ninguno falló, aunque otro instalara", () => {
    expect(estadoFinalTarea(["INSTALADO", "CANCELADO"])).toBe("CANCELADA");
    expect(estadoFinalTarea(["OMITIDO", "CANCELADO"])).toBe("CANCELADA");
  });
  it("el error manda sobre la cancelación: CON_ERRORES", () => {
    expect(estadoFinalTarea(["ERROR", "CANCELADO"])).toBe("CON_ERRORES");
    expect(estadoFinalTarea(["INTERRUMPIDO", "CANCELADO"])).toBe(
      "CON_ERRORES",
    );
  });
});

describe("cancelación: estados y etiquetas", () => {
  it("CANCELADO es un estado de destino final", () => {
    expect(ESTADOS_DESTINO_FINALES).toContain(ESTADO_DESTINO.CANCELADO);
  });

  it("las etiquetas legibles existen en español", () => {
    expect(ETIQUETA_ESTADO_DESTINO[ESTADO_DESTINO.CANCELADO]).toBe(
      "Cancelado",
    );
    expect(ETIQUETA_ESTADO_TAREA[ESTADO_TAREA.CANCELADA]).toBe("Cancelada");
    expect(ETIQUETA_ESTADO_TAREA[ESTADO_TAREA.EN_CURSO]).toBe("En curso");
  });

  it("una tarea cancelada con destinos cancelados se puede borrar", () => {
    expect(
      tareaPuedeBorrarse({
        status: "CANCELADA",
        estadosDestinos: ["INSTALADO", "CANCELADO"],
        enEjecucion: false,
      }),
    ).toBe(true);
  });

  it("una tarea cancelada con un destino aún a medias no se borra", () => {
    expect(
      tareaPuedeBorrarse({
        status: "CANCELADA",
        estadosDestinos: ["CANCELADO", "ESPERANDO_SENAL"],
        enEjecucion: false,
      }),
    ).toBe(false);
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
