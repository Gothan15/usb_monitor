"use client";

import { AlertCircle, CheckCircle2, Circle } from "lucide-react";
import { Spinner } from "@/components/ui/spinner";
import {
  PASOS_WINRM_VM,
  estadoPasoWinRM,
  type PasoWinRM,
} from "@/lib/winrmChecklist";

/** Requisito tal como lo devuelve la fase «check» de remote-install. */
export interface RequisitoWinRMVista {
  id: string;
  ok: boolean;
  detalle: string;
  consejo?: string;
}

interface Props {
  /**
   * Último resultado de la comprobación en vivo. Si se omite, la
   * lista se enseña como guía (modo FAQ): pasos numerados con su
   * explicación y sus comandos, sin estados.
   */
  checks?: RequisitoWinRMVista[] | null;
  /** La comprobación está corriendo: los pasos aún sin estado definitivo muestran el spinner. */
  comprobando?: boolean;
}

/**
 * La lista de verificación de WinRM para una máquina recién
 * creada (src/lib/winrmChecklist.ts), en dos modos con el mismo
 * contenido: guía en el FAQ y en vivo en el diálogo de
 * instalación remota, donde cada paso se marca con el resultado
 * real de checkWinRMRequirements.
 */
export function WinRMChecklist({ checks, comprobando = false }: Props) {
  const enVivo = checks !== undefined;
  const porId = new Map((checks ?? []).map((c) => [c.id, c]));

  const icono = (paso: PasoWinRM, indice: number) => {
    if (!enVivo) {
      return (
        <span className="mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full border border-border text-[11px] font-semibold text-muted-foreground">
          {indice + 1}
        </span>
      );
    }
    const estado = estadoPasoWinRM(paso, checks ?? null);
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
      {PASOS_WINRM_VM.map((paso, i) => {
        const estado = enVivo
          ? estadoPasoWinRM(paso, checks ?? null)
          : "sin-comprobar";
        const fallidos = paso.checks
          .map((id) => porId.get(id))
          .filter((c): c is RequisitoWinRMVista => !!c && !c.ok);
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
