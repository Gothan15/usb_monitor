import { ArrowDown, ArrowUp, ArrowUpDown, ChevronDown } from "lucide-react";

import type { SortConfig } from "@/hooks/useTableSort";

// Control de ordenación compartido por las listas del panel:
// un desplegable con la columna y un botón de dirección que
// cicla sube → baja → sin orden (el mismo ciclo que tenía la
// antigua fila de enlaces, donde el tercer clic quitaba el
// orden). Un solo componente para todas las pestañas, en vez
// de copiar el bloque en cada una.
export function OrdenarPor<T>({
  id,
  columnas,
  sortConfig,
  onSort,
}: {
  id: string;
  columnas: { key: keyof T; label: string }[];
  sortConfig: SortConfig<T>;
  onSort: (key: keyof T) => void;
}) {
  return (
    <div className="inline-flex items-center gap-2">
      <label htmlFor={id} className="smallcaps text-muted-foreground/70">
        Ordenar por
      </label>
      {/* Sin caja: solo un subrayado fino, como los enlaces de
          ordenación de antes, y la flecha la pone el panel (la
          del sistema quedaba fuera de lugar). */}
      <div className="relative">
        <select
          id={id}
          value={sortConfig.key ? String(sortConfig.key) : ""}
          onChange={(e) => {
            const key = e.target.value as keyof T;
            if (key && key !== sortConfig.key) onSort(key);
          }}
          className="appearance-none border-b border-border bg-transparent py-1.5 pl-0.5 pr-6 text-xs text-foreground transition-colors focus:border-[var(--acero)] focus:outline-none"
        >
          <option value="" disabled>
            Columna…
          </option>
          {columnas.map((columna) => (
            <option key={String(columna.key)} value={String(columna.key)}>
              {columna.label}
            </option>
          ))}
        </select>
        <ChevronDown className="pointer-events-none absolute right-0.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
      </div>
      <button
        type="button"
        disabled={!sortConfig.key}
        onClick={() => sortConfig.key && onSort(sortConfig.key)}
        title="Dirección del orden: pulsa para cambiarla (sube, baja, sin orden)"
        aria-label="Dirección del orden"
        className="inline-flex items-center p-1.5 text-muted-foreground transition-colors hover:text-foreground disabled:opacity-40"
      >
        {sortConfig.direction === "desc" ? (
          <ArrowDown className="size-3.5" />
        ) : sortConfig.direction === "asc" ? (
          <ArrowUp className="size-3.5" />
        ) : (
          <ArrowUpDown className="size-3.5" />
        )}
      </button>
    </div>
  );
}
