"use client";

import { useEffect } from "react";
import * as ajustesApi from "@/lib/api/ajustes";
import {
  aplicarApariencia,
  escalaLetraValida,
} from "@/lib/apariencia";

/**
 * Aplica la apariencia guardada (escala de la letra y
 * desenfoque de los diálogos) al entrar en el panel: lee los
 * ajustes una vez y los vuelca sobre el documento. Sin este
 * paso, los valores de Ajustes solo vivirían en la pestaña que
 * los edita. Si la lectura falla, quedan los valores por
 * defecto de la hoja de estilos, que son los mismos.
 *
 * No pinta nada: devuelve null.
 */
export function AplicadorApariencia() {
  useEffect(() => {
    let cancelado = false;
    void ajustesApi
      .leer()
      .then((datos) => {
        if (cancelado) return;
        aplicarApariencia({
          escalaLetra: escalaLetraValida(datos?.escalaLetra),
          desenfoqueDialogos: datos?.desenfoqueDialogos ?? true,
        });
      })
      .catch(() => undefined);
    return () => {
      cancelado = true;
    };
  }, []);

  return null;
}
