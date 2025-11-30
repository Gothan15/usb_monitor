"use client";

import { useMemo } from "react";
import {
  Pagination,
  PaginationContent,
  PaginationItem,
} from "@/components/ui/pagination";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import {
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
} from "lucide-react";

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
  const pageCount = useMemo(() => {
    if (totalItems === 0) return 1;
    return Math.max(1, Math.ceil(totalItems / safePageSize));
  }, [safePageSize, totalItems]);

  const currentPage = Math.min(Math.max(page, 1), pageCount);
  const startItem = totalItems === 0 ? 0 : (currentPage - 1) * safePageSize + 1;
  const endItem =
    totalItems === 0 ? 0 : Math.min(totalItems, currentPage * safePageSize);

  const showNavigation = pageCount > 1;

  return (
    <div
      className={cn(
        "flex flex-col gap-3 text-xs text-slate-600 dark:text-slate-300/80 md:flex-row md:items-center md:justify-between",
        className
      )}
    >
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-medium">
          Mostrando {startItem.toLocaleString()}-{endItem.toLocaleString()} de{" "}
          {totalItems.toLocaleString()} {label}
        </span>
        <Select
          value={String(safePageSize)}
          onValueChange={(value) => onPageSizeChange(Number(value))}
        >
          <SelectTrigger
            aria-label="Elementos por página"
            size="sm"
            className="h-8 rounded-full border-slate-200/70 bg-white/90 pr-7 text-xs font-medium dark:border-white/15 dark:bg-white/10"
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {pageSizeOptions.map((option) => (
              <SelectItem key={option} value={String(option)}>
                {option.toLocaleString()} por página
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {showNavigation && (
        <Pagination className="md:justify-end">
          <PaginationContent>
            <PaginationItem>
              <Button
                variant="ghost"
                size="icon"
                aria-label="Ir a la primera página"
                onClick={() => onPageChange(1)}
                disabled={currentPage === 1}
                className="rounded-full"
              >
                <ChevronsLeft className="size-4" />
              </Button>
            </PaginationItem>
            <PaginationItem>
              <Button
                variant="ghost"
                size="icon"
                aria-label="Ir a la página anterior"
                onClick={() => onPageChange(currentPage - 1)}
                disabled={currentPage === 1}
                className="rounded-full"
              >
                <ChevronLeft className="size-4" />
              </Button>
            </PaginationItem>
            <PaginationItem>
              <span className="rounded-full border border-slate-200/70 bg-white/80 px-3 py-1 font-medium text-slate-700 shadow-sm dark:border-white/15 dark:bg-white/10 dark:text-slate-200">
                Página {currentPage.toLocaleString()} de{" "}
                {pageCount.toLocaleString()}
              </span>
            </PaginationItem>
            <PaginationItem>
              <Button
                variant="ghost"
                size="icon"
                aria-label="Ir a la página siguiente"
                onClick={() => onPageChange(currentPage + 1)}
                disabled={currentPage === pageCount}
                className="rounded-full"
              >
                <ChevronRight className="size-4" />
              </Button>
            </PaginationItem>
            <PaginationItem>
              <Button
                variant="ghost"
                size="icon"
                aria-label="Ir a la última página"
                onClick={() => onPageChange(pageCount)}
                disabled={currentPage === pageCount}
                className="rounded-full"
              >
                <ChevronsRight className="size-4" />
              </Button>
            </PaginationItem>
          </PaginationContent>
        </Pagination>
      )}
    </div>
  );
}
