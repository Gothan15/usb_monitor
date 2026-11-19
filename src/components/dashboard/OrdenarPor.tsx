import { ArrowDown, ArrowUp, ArrowUpDown } from "lucide-react";

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { SortConfig } from "@/hooks/useTableSort";

// Control de ordenación compartido por las listas del panel:
// un desplegable con la columna y un botón de dirección que
// cicla sube → baja → sin orden (el mismo ciclo que tenía la
// antigua fila de enlaces, donde el tercer clic quitaba el
// orden). Un solo componente para todas las pestañas, en vez
// de copiar el bloque en cada una.
//
// El desplegable es el mismo Select (Radix) que el selector
// de adaptadores de red de la pestaña Escáner: gatillo con
// caja en tamaño sm y panel flotante con las opciones, en vez
// del <select> nativo con subrayado que trajo el #213 — así
// todos los desplegables del panel se ven y se comportan
// igual (pedido de Gothan, 2026-11-19).
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
      <Select
        value={sortConfig.key ? String(sortConfig.key) : ""}
        onValueChange={(value) => {
          const key = value as keyof T;
          if (key && key !== sortConfig.key) onSort(key);
        }}
      >
        <SelectTrigger id={id} size="sm" className="min-w-[160px]">
          <SelectValue placeholder="Columna…" />
        </SelectTrigger>
        <SelectContent>
          {columnas.map((columna) => (
            <SelectItem key={String(columna.key)} value={String(columna.key)}>
              {columna.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
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
