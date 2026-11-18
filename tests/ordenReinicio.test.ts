/**
 * La regla pura del reinicio remoto del servicio: Equipos
 * enseña el botón «Reiniciar» con su ruleta mientras el equipo
 * tenga una orden «reiniciar» viva, y la ruta de creación no
 * la duplica.
 */
import { describe, expect, it } from "vitest";

import {
  ESTADO_ORDEN,
  TIPO_ORDEN_ACTUALIZAR,
  TIPO_ORDEN_REINICIAR,
  reinicioEnCurso,
} from "@/lib/agentCommands";

describe("reinicioEnCurso", () => {
  it("sin órdenes no hay reinicio", () => {
    expect(reinicioEnCurso([])).toBe(false);
  });

  it("una orden reiniciar en espera ya cuenta como en curso", () => {
    expect(
      reinicioEnCurso([
        { type: TIPO_ORDEN_REINICIAR, status: ESTADO_ORDEN.ESPERA },
      ]),
    ).toBe(true);
  });

  it("entregada y en curso también cuentan", () => {
    expect(
      reinicioEnCurso([
        { type: TIPO_ORDEN_REINICIAR, status: ESTADO_ORDEN.ENTREGADA },
      ]),
    ).toBe(true);
    expect(
      reinicioEnCurso([
        { type: TIPO_ORDEN_REINICIAR, status: ESTADO_ORDEN.EN_CURSO },
      ]),
    ).toBe(true);
  });

  it("una orden reiniciar terminada ya no cuenta", () => {
    expect(
      reinicioEnCurso([
        { type: TIPO_ORDEN_REINICIAR, status: ESTADO_ORDEN.HECHA },
      ]),
    ).toBe(false);
    expect(
      reinicioEnCurso([
        { type: TIPO_ORDEN_REINICIAR, status: ESTADO_ORDEN.ERROR },
      ]),
    ).toBe(false);
    expect(
      reinicioEnCurso([
        { type: TIPO_ORDEN_REINICIAR, status: ESTADO_ORDEN.CANCELADA },
      ]),
    ).toBe(false);
  });

  it("órdenes vivas de otro tipo no cuentan", () => {
    expect(
      reinicioEnCurso([
        { type: TIPO_ORDEN_ACTUALIZAR, status: ESTADO_ORDEN.EN_CURSO },
      ]),
    ).toBe(false);
  });
});
