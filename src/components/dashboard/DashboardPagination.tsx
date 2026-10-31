"use client";

import { useMemo } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";

interface DashboardPaginationProps {
  page: number;
  pageSize: number;
  totalItems: number;
  onPageChange: (page: number) => void;
  onPageSizeChange: (pageSize: number) => void;
  pageSizeOptions?: number[];
  className?: string;
  label?: string;
}

const DEFAULT_OPTIONS = [10, 20, 50, 100];

/* Ventana de páginas: 1 … 4 5 6 … 12 */
function buildPageNumbers(current: number, total: number): (number | "dots")[] {
  if (total <= 7) {
    return Array.from({ length: total }, (_, i) => i + 1);
  }
  const pages: (number | "dots")[] = [1];
  if (current <= 4) {
    for (let i = 2; i <= 5; i++) pages.push(i);
    pages.push("dots");
  } else if (current >= total - 3) {
    pages.push("dots");
    for (let i = total - 4; i <= total - 1; i++) pages.push(i);
  } else {
    pages.push("dots");
    for (let i = current - 1; i <= current + 1; i++) pages.push(i);
    pages.push("dots");
  }
  pages.push(total);
  return pages;
}

/**
 * Paginación mínima: una línea de texto sobre un filete.
 * «1–10 de 42 eventos» a la izquierda; números y Anterior/Siguiente
 * como texto a la derecha; el tamaño de página, un selector discreto.
 */
export function DashboardPagination({
  page,
  pageSize,
  totalItems,
  onPageChange,
  onPageSizeChange,
  pageSizeOptions = DEFAULT_OPTIONS,
  className,
  label = "registros",
}: DashboardPaginationProps) {
  const safePageSize = Math.max(pageSize, 1);
  const totalPages = Math.max(1, Math.ceil(totalItems / safePageSize));
  const safePage = Math.min(Math.max(page, 1), totalPages);
  const start = totalItems === 0 ? 0 : (safePage - 1) * safePageSize + 1;
  const end = Math.min(totalItems, safePage * safePageSize);

  const pageNumbers = useMemo(
    () => buildPageNumbers(safePage, totalPages),
    [safePage, totalPages],
  );

  if (totalItems === 0 || totalPages <= 1) return null;

  const pasoClase =
    "inline-flex items-center gap-1 text-[12px] font-medium text-muted-foreground transition-colors hover:text-foreground disabled:pointer-events-none disabled:opacity-35";

  return (
    <div
      className={cn(
        "mt-auto flex flex-wrap items-center gap-x-6 gap-y-2 border-t border-border pt-4 text-[12px]",
        className,
      )}
    >
      <span className="tabular-nums text-muted-foreground">
        {start}–{end} de {totalItems} {label}
      </span>

      <nav
        className="ml-auto flex items-center gap-1"
        aria-label="Paginación"
      >
        <button
          type="button"
          className={pasoClase}
          disabled={safePage <= 1}
          onClick={() => onPageChange(safePage - 1)}
        >
          <ChevronLeft className="size-3.5" />
          <span className="hidden sm:inline">Anterior</span>
        </button>

        <span className="mx-1.5 flex items-center gap-0.5">
          {pageNumbers.map((item, indice) =>
            item === "dots" ? (
              <span
                key={`dots-${indice}`}
                className="px-1 text-muted-foreground/60"
              >
                …
              </span>
            ) : (
              <button
                key={item}
                type="button"
                onClick={() => onPageChange(item)}
                aria-current={item === safePage ? "page" : undefined}
                className={cn(
                  "min-w-6 px-1 py-0.5 text-center tabular-nums transition-colors",
                  item === safePage
                    ? "font-bold text-foreground underline decoration-[var(--acero)] decoration-2 underline-offset-4"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                {item}
              </button>
            ),
          )}
        </span>

        <button
          type="button"
          className={pasoClase}
          disabled={safePage >= totalPages}
          onClick={() => onPageChange(safePage + 1)}
        >
          <span className="hidden sm:inline">Siguiente</span>
          <ChevronRight className="size-3.5" />
        </button>
      </nav>

      <label className="flex items-center gap-1.5 text-muted-foreground">
        Por página
        <select
          value={safePageSize}
          onChange={(e) => onPageSizeChange(Number(e.target.value))}
          className="cursor-pointer bg-transparent font-medium text-foreground outline-none"
          aria-label="Registros por página"
        >
          {pageSizeOptions.map((option) => (
            <option key={option} value={option}>
              {option}
            </option>
          ))}
        </select>
      </label>
    </div>
  );
}
