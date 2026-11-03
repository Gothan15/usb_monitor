"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { cn } from "@/lib/utils";

/**
 * Selección por lotes para los registros del panel (equipos,
 * usuarios, whitelist): un conjunto de ids, casillas sobrias a
 * juego con el diseño de registro y una barra de acción con
 * confirmación en dos pasos, sin diálogos modales extra.
 */
export function useBulkSelection() {
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());

  const toggle = useCallback((id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }, []);

  const setMany = useCallback((ids: string[], on: boolean) => {
    setSelected((prev) => {
      const next = new Set(prev);
      for (const id of ids) {
        if (on) {
          next.add(id);
        } else {
          next.delete(id);
        }
      }
      return next;
    });
  }, []);

  const clear = useCallback(() => setSelected(new Set()), []);

  return { selected, toggle, setMany, clear, count: selected.size };
}

const checkboxClass =
  "size-4 shrink-0 cursor-pointer appearance-none border border-border bg-transparent align-middle transition-colors checked:border-[var(--acero)] checked:bg-[var(--acero)] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[var(--acero)]";

export function RowCheckbox({
  checked,
  onChange,
  label,
}: {
  checked: boolean;
  onChange: () => void;
  label: string;
}) {
  return (
    <input
      type="checkbox"
      aria-label={label}
      title={label}
      checked={checked}
      onChange={onChange}
      className={checkboxClass}
    />
  );
}

export function PageCheckbox({
  pageIds,
  selected,
  onChange,
}: {
  pageIds: string[];
  selected: ReadonlySet<string>;
  onChange: (ids: string[], on: boolean) => void;
}) {
  const ref = useRef<HTMLInputElement>(null);
  const selectedOnPage = pageIds.filter((id) => selected.has(id)).length;
  const all = pageIds.length > 0 && selectedOnPage === pageIds.length;

  useEffect(() => {
    if (ref.current) {
      ref.current.indeterminate = selectedOnPage > 0 && !all;
    }
  }, [selectedOnPage, all]);

  return (
    <label className="inline-flex cursor-pointer items-center gap-2">
      <input
        ref={ref}
        type="checkbox"
        aria-label="Seleccionar esta página"
        checked={all}
        onChange={(event) => onChange(pageIds, event.target.checked)}
        className={checkboxClass}
      />
      <span className="smallcaps text-muted-foreground">
        Seleccionar página
      </span>
    </label>
  );
}

export function BulkBar({
  count,
  unidad,
  busy,
  onConfirm,
  onCancel,
}: {
  count: number;
  unidad: string;
  busy: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const [confirmando, setConfirmando] = useState(false);

  useEffect(() => {
    if (!confirmando) return;
    const timer = setTimeout(() => setConfirmando(false), 5000);
    return () => clearTimeout(timer);
  }, [confirmando]);

  // Al vaciarse la selección se cancela la confirmación en curso:
  // ajuste durante el render al cambiar la prop, sin efecto.
  const [prevCount, setPrevCount] = useState(count);
  if (count !== prevCount) {
    setPrevCount(count);
    if (count === 0) setConfirmando(false);
  }

  if (count === 0) return null;

  return (
    <div
      className={cn(
        "sticky bottom-4 z-10 mt-6 flex flex-wrap items-center gap-x-5 gap-y-2",
        "border border-border bg-card px-4 py-3 shadow-lg",
      )}
      role="region"
      aria-label="Acciones por lotes"
    >
      <span className="text-sm text-foreground">
        <strong className="tabular-nums">{count}</strong>{" "}
        <span className="text-muted-foreground">
          {unidad} seleccionado{count === 1 ? "" : "s"}
        </span>
      </span>
      <span className="ml-auto flex items-center gap-1">
        {confirmando ? (
          <>
            <span className="mr-2 text-sm text-destructive">
              Esta acción no se puede deshacer.
            </span>
            <Button
              type="button"
              size="sm"
              disabled={busy}
              onClick={onConfirm}
              className="bg-rose-600 hover:bg-rose-700"
            >
              {busy ? <Spinner size={14} /> : `Eliminar ${count}`}
            </Button>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              disabled={busy}
              onClick={() => setConfirmando(false)}
            >
              Volver
            </Button>
          </>
        ) : (
          <>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              disabled={busy}
              onClick={() => setConfirmando(true)}
              className="text-destructive hover:text-destructive"
            >
              Eliminar seleccionados
            </Button>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              disabled={busy}
              onClick={onCancel}
            >
              Cancelar
            </Button>
          </>
        )}
      </span>
    </div>
  );
}
