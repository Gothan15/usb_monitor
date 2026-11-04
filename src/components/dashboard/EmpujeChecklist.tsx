"use client";

import { AlertCircle, CheckCircle2, Circle } from "lucide-react";
import { Spinner } from "@/components/ui/spinner";
import {
  PASOS_EMPUJE_VM,
  estadoPasoEmpuje,
  type PasoEmpuje,
} from "@/lib/empujeChecklist";

/** Requisito tal como lo deja guardado la comprobación del empujador. */
export interface RequisitoEmpujeVista {
  id: string;
  ok: boolean;
  detalle: string;
  consejo?: string | null;
}

interface Props {
  /**
   * Último resultado de la comprobación en vivo. Si se omite, la
   * lista se enseña como guía (modo FAQ): pasos numerados con su
   * explicación y sus comandos, sin estados.
   */
  checks?: RequisitoEmpujeVista[] | null;
  /** La comprobación está corriendo: los pasos aún sin estado definitivo muestran el spinner. */
  comprobando?: boolean;
}

/**
 * La lista de verificación del empujón SMB para una máquina
 * recién creada (src/lib/empujeChecklist.ts), en dos modos con
 * el mismo contenido: guía en el FAQ y en vivo en la fila de
 * cada destino de una tarea, donde cada paso se marca con el
 * resultado real de USBMonitorEmpujador.exe --comprobar.
 */
export function EmpujeChecklist({ checks, comprobando = false }: Props) {
  const enVivo = checks !== undefined;
  const porId = new Map((checks ?? []).map((c) => [c.id, c]));

  const icono = (paso: PasoEmpuje, indice: number) => {
    if (!enVivo) {
      return (
        <span className="mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full border border-border text-[11px] font-semibold text-muted-foreground">
          {indice + 1}
        </span>
      );
    }
    const estado = estadoPasoEmpuje(paso, checks ?? null);
    if (estado === "cumple") {
      return (
        <CheckCircle2 className="mt-0.5 size-5 shrink-0 text-emerald-600" />
      );
    }
    if (estado === "no-cumple") {
      return <AlertCircle className="mt-0.5 size-5 shrink-0 text-rose-600" />;
    }
    if (comprobando)
      return (
        <span className="mt-0.5 shrink-0">
          <Spinner size={16} />
        </span>
      );
    return (
      <Circle className="mt-0.5 size-5 shrink-0 text-muted-foreground/50" />
    );
  };

  return (
    <ol className="space-y-3">
      {PASOS_EMPUJE_VM.map((paso, i) => {
        const estado = enVivo
          ? estadoPasoEmpuje(paso, checks ?? null)
          : "sin-comprobar";
        const fallidos = paso.checks
          .map((id) => porId.get(id))
          .filter((c): c is RequisitoEmpujeVista => !!c && !c.ok);
        return (
          <li key={paso.id} className="flex items-start gap-2.5">
            {icono(paso, i)}
            <div className="min-w-0">
              <p className="text-sm font-medium text-foreground">
                {paso.titulo}
                {enVivo && estado === "sin-comprobar" && !comprobando && (
                  <span className="ml-2 text-xs font-normal text-muted-foreground">
                    sin comprobar
                  </span>
                )}
              </p>
              {(!enVivo || estado === "no-cumple") && (
                <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">
                  {paso.descripcion}
                </p>
              )}
              {(!enVivo || estado === "no-cumple") &&
                paso.comandos.map((comando) => (
                  <code
                    key={comando}
                    className="mt-1 block overflow-x-auto whitespace-nowrap rounded bg-muted/60 px-2 py-1 font-mono text-[11px] text-foreground"
                  >
                    {comando}
                  </code>
                ))}
              {enVivo &&
                fallidos.map((c) => (
                  <p key={c.id} className="mt-0.5 text-xs text-muted-foreground">
                    {c.detalle}
                    {c.consejo && (
                      <span className="block font-mono text-[11px]">
                        {c.consejo}
                      </span>
                    )}
                  </p>
                ))}
            </div>
          </li>
        );
      })}
    </ol>
  );
}
