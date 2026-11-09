"use client";

import { useRef, type ReactNode } from "react";
import { Search, X } from "lucide-react";

import { cn } from "@/lib/utils";

interface CampoBusquedaProps {
  /** Texto actual del campo (lo controla quien lo usa). */
  value: string;
  /** Llega con el texto nuevo en cada pulsación y al limpiar. */
  onChange: (valor: string) => void;
  placeholder?: string;
  /**
   * Control opcional pegado a la derecha (p. ej. un botón de
   * filtro con su menú). Va como elemento HERMANO dentro del
   * mismo contenedor: su hueco lo reserva el layout flex, igual
   * que el de la lupa y el de la ✕, así que ningún control puede
   * montarse sobre otro.
   */
  filtro?: ReactNode;
  /** Clases del contenedor (ancho, márgenes, orden en la barra). */
  className?: string;
  disabled?: boolean;
  autoFocus?: boolean;
  id?: string;
  "aria-label"?: string;
}

/**
 * Campo de búsqueda único del panel: lupa, texto, ✕ de limpiar
 * (solo con texto) y hueco opcional para el filtro, todo en una
 * sola fila flex dentro de un mismo contenedor.
 *
 * Sustituye a los buscadores artesanales que cada pestaña
 * componía con la lupa en posición absoluta y `pl-*`/`right-*`
 * calculados a mano: en cuanto convivían dos controles a la
 * derecha, el cálculo pensado para uno solo hacía que se
 * pisaran. Aquí no hay posiciones absolutas: el espacio de cada
 * control lo reserva el layout y el solape es imposible.
 *
 * Diseño: caja de h-9 (la altura de los demás controles de las
 * barras) con los mismos tokens que `ui/input` — borde `input`,
 * y al enfocar, borde `ring` y anillo dorado `ring/30`. El
 * input es `type="text"` a propósito: con `type="search"` el
 * navegador pinta su propia ✕, otro control fuera de nuestro
 * layout.
 */
export function CampoBusqueda({
  value,
  onChange,
  placeholder,
  filtro,
  className,
  disabled,
  autoFocus,
  id,
  "aria-label": ariaLabel,
}: CampoBusquedaProps) {
  const inputRef = useRef<HTMLInputElement>(null);

  // Limpiar devuelve el foco al campo: quien borra la búsqueda
  // suele seguir tecleando o revisando la lista completa.
  const limpiar = () => {
    onChange("");
    inputRef.current?.focus();
  };

  return (
    <div
      className={cn(
        "flex h-9 items-center gap-2 rounded-md border border-input bg-transparent px-3 transition-all duration-150 dark:bg-input/30",
        "focus-within:border-ring focus-within:ring-[3px] focus-within:ring-ring/30",
        disabled && "opacity-50",
        className,
      )}
    >
      <Search
        className="size-4 shrink-0 text-muted-foreground"
        aria-hidden="true"
      />
      <input
        ref={inputRef}
        id={id}
        type="text"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        disabled={disabled}
        autoFocus={autoFocus}
        aria-label={ariaLabel ?? placeholder}
        className="h-full min-w-0 flex-1 bg-transparent text-sm outline-none selection:bg-primary selection:text-primary-foreground placeholder:text-muted-foreground disabled:cursor-not-allowed"
      />
      {value && (
        <button
          type="button"
          onClick={limpiar}
          disabled={disabled}
          aria-label="Limpiar búsqueda"
          className="flex size-6 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:pointer-events-none disabled:opacity-50"
        >
          <X className="size-3.5" aria-hidden="true" />
        </button>
      )}
      {filtro}
    </div>
  );
}
