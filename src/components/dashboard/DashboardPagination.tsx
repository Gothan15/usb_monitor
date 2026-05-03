"use client";

import { useMemo, useState, useRef } from "react";
import { motion, AnimatePresence, useDragControls } from "framer-motion";
import { usePaginationSettings } from "@/hooks/usePaginationSettings";
import {
  Pagination,
  PaginationContent,
  PaginationItem,
} from "@/components/ui/pagination";
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
  MoreHorizontal,
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

/* ─── Sliding-window page algorithm ──────────────────────────── */
function buildPageNumbers(current: number, total: number): (number | "dots")[] {
  if (total <= 7) {
    return Array.from({ length: total }, (_, i) => i + 1);
  }

  const pages: (number | "dots")[] = [];

  // Always show page 1
  pages.push(1);

  if (current <= 4) {
    // Near the start: 1 2 3 4 5 … last
    for (let i = 2; i <= 5; i++) pages.push(i);
    pages.push("dots");
  } else if (current >= total - 3) {
    // Near the end: 1 … n-4 n-3 n-2 n-1 last
    pages.push("dots");
    for (let i = total - 4; i <= total - 1; i++) pages.push(i);
  } else {
    // Middle: 1 … current-1 current current+1 … last
    pages.push("dots");
    for (let i = current - 1; i <= current + 1; i++) pages.push(i);
    pages.push("dots");
  }

  // Always show last page
  pages.push(total);

  return pages;
}

/* ─── Motion variants ────────────────────────────────────────── */
const navButtonMotion = {
  whileHover: { scale: 1.1 },
  whileTap: { scale: 0.92 },
  transition: { type: "spring" as const, stiffness: 400, damping: 20 },
};

const pageButtonMotion = {
  initial: { opacity: 0, scale: 0.85 },
  animate: { opacity: 1, scale: 1 },
  exit: { opacity: 0, scale: 0.85 },
  transition: { duration: 0.15, ease: [0.16, 1, 0.3, 1] as [number, number, number, number] },
};

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
  const { style, position, setPosition, isLoaded } = usePaginationSettings();
  const dragControls = useDragControls();
  const [isLongPressing, setIsLongPressing] = useState(false);
  const [isDraggable, setIsDraggable] = useState(false);
  const timerRef = useRef<NodeJS.Timeout | null>(null);

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

  const pageNumbers = useMemo(
    () => buildPageNumbers(currentPage, pageCount),
    [currentPage, pageCount],
  );

  const canPrev = currentPage > 1;
  const canNext = currentPage < pageCount;

  // Render static right away if not loaded to prevent layout shift of the base content
  const isFloating = isLoaded ? style === "floating" : false;

  const handlePointerDown = (e: React.PointerEvent) => {
    if (!isFloating) return;
    setIsLongPressing(true);
    document.body.classList.add("select-none"); // Prevent global text selection while holding
    
    timerRef.current = setTimeout(() => {
      setIsDraggable(true);
      setIsLongPressing(false);
      dragControls.start(e, { snapToCursor: false });
    }, 3000);
  };

  const handlePointerUpOrCancel = () => {
    setIsLongPressing(false);
    if (!isDraggable) {
      document.body.classList.remove("select-none");
    }
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  };

  const handleDragEnd = (_event: any, info: any) => {
    setIsDraggable(false);
    document.body.classList.remove("select-none");
    setPosition({
      x: (position?.x || 0) + info.offset.x,
      y: (position?.y || 0) + info.offset.y,
    });
  };

  const content = (
    <div
      className={cn(
        "flex flex-col gap-3 text-xs text-muted-foreground md:flex-row md:items-center md:justify-between",
        isFloating 
          ? "pointer-events-auto items-center md:gap-6 select-none" 
          : "w-full",
        className,
      )}
    >
      {/* ── Left: info + page-size selector ── */}
      <div className="flex shrink-0 flex-wrap items-center gap-3">
        <span className="font-medium tabular-nums">
          Mostrando{" "}
          <span className="text-foreground">
            {startItem.toLocaleString()}–{endItem.toLocaleString()}
          </span>{" "}
          de{" "}
          <span className="text-foreground">
            {totalItems.toLocaleString()}
          </span>{" "}
          {label}
        </span>

        <Select
          value={String(safePageSize)}
          onValueChange={(value) => onPageSizeChange(Number(value))}
        >
          <SelectTrigger
            aria-label="Elementos por página"
            size="sm"
            className="h-7 rounded-full border-border/40 bg-card/60 pr-7 text-[11px] font-medium backdrop-blur-sm transition-colors hover:bg-card/90"
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

      {/* ── Right: navigation ── */}
      {showNavigation && (
        <Pagination className="justify-center md:justify-end">
          <PaginationContent className="gap-0.5">
            {/* First */}
            <PaginationItem>
              <motion.button
                {...navButtonMotion}
                type="button"
                aria-label="Ir a la primera página"
                disabled={!canPrev}
                onClick={() => onPageChange(1)}
                className={cn(
                  "inline-flex size-8 items-center justify-center rounded-full text-muted-foreground transition-colors",
                  canPrev
                    ? "hover:bg-accent/60 hover:text-foreground"
                    : "pointer-events-none opacity-35",
                )}
              >
                <ChevronsLeft className="size-3.5" />
              </motion.button>
            </PaginationItem>

            {/* Previous */}
            <PaginationItem>
              <motion.button
                {...navButtonMotion}
                type="button"
                aria-label="Ir a la página anterior"
                disabled={!canPrev}
                onClick={() => onPageChange(currentPage - 1)}
                className={cn(
                  "inline-flex size-8 items-center justify-center rounded-full text-muted-foreground transition-colors",
                  canPrev
                    ? "hover:bg-accent/60 hover:text-foreground"
                    : "pointer-events-none opacity-35",
                )}
              >
                <ChevronLeft className="size-3.5" />
              </motion.button>
            </PaginationItem>

            {/* ── Numbered pages (desktop) ── */}
            <div className="hidden items-center gap-0.5 md:flex">
              <AnimatePresence mode="popLayout">
                {pageNumbers.map((item, idx) =>
                  item === "dots" ? (
                    <PaginationItem key={`dots-${idx}`}>
                      <span className="inline-flex size-8 items-center justify-center text-muted-foreground/50">
                        <MoreHorizontal className="size-3.5" />
                      </span>
                    </PaginationItem>
                  ) : (
                    <PaginationItem key={item}>
                      <motion.button
                        {...pageButtonMotion}
                        layoutId={`page-${item}`}
                        type="button"
                        aria-label={`Ir a la página ${item}`}
                        aria-current={item === currentPage ? "page" : undefined}
                        onClick={() => onPageChange(item)}
                        className={cn(
                          "relative inline-flex size-8 items-center justify-center rounded-full text-xs font-medium tabular-nums transition-all duration-200",
                          item === currentPage
                            ? "text-primary"
                            : "text-muted-foreground hover:bg-accent/50 hover:text-foreground",
                        )}
                      >
                        {/* Active indicator pill */}
                        {item === currentPage && (
                          <motion.span
                            layoutId="active-page-bg"
                            className="absolute inset-0 rounded-full border border-primary/20 bg-primary/10 shadow-sm"
                            transition={{
                              type: "spring",
                              stiffness: 350,
                              damping: 30,
                            }}
                          />
                        )}
                        <span className="relative z-10">{item}</span>
                      </motion.button>
                    </PaginationItem>
                  ),
                )}
              </AnimatePresence>
            </div>

            {/* ── Compact indicator (mobile) ── */}
            <PaginationItem className="md:hidden">
              <span className="inline-flex items-center gap-1 rounded-full border border-border/40 bg-card/60 px-3 py-1 text-xs font-medium tabular-nums text-foreground backdrop-blur-sm">
                {currentPage}
                <span className="text-muted-foreground/60">/</span>
                {pageCount}
              </span>
            </PaginationItem>

            {/* Next */}
            <PaginationItem>
              <motion.button
                {...navButtonMotion}
                type="button"
                aria-label="Ir a la página siguiente"
                disabled={!canNext}
                onClick={() => onPageChange(currentPage + 1)}
                className={cn(
                  "inline-flex size-8 items-center justify-center rounded-full text-muted-foreground transition-colors",
                  canNext
                    ? "hover:bg-accent/60 hover:text-foreground"
                    : "pointer-events-none opacity-35",
                )}
              >
                <ChevronRight className="size-3.5" />
              </motion.button>
            </PaginationItem>

            {/* Last */}
            <PaginationItem>
              <motion.button
                {...navButtonMotion}
                type="button"
                aria-label="Ir a la última página"
                disabled={!canNext}
                onClick={() => onPageChange(pageCount)}
                className={cn(
                  "inline-flex size-8 items-center justify-center rounded-full text-muted-foreground transition-colors",
                  canNext
                    ? "hover:bg-accent/60 hover:text-foreground"
                    : "pointer-events-none opacity-35",
                )}
              >
                <ChevronsRight className="size-3.5" />
              </motion.button>
            </PaginationItem>
          </PaginationContent>
        </Pagination>
      )}
    </div>
  );

  if (!isLoaded) {
    // Return base content to prevent hydration mismatch before settings load
    return content;
  }

  if (isFloating) {
    return (
      <div className="pointer-events-none fixed bottom-6 left-0 right-0 z-50 flex justify-center px-4">
        <motion.div
          animate={{
            x: position?.x || 0,
            y: position?.y || 0,
            scale: isLongPressing ? 1.02 : 1,
            boxShadow: isLongPressing
              ? "0 0 0 2px rgba(56, 189, 248, 0.5)"
              : "0 0 0 0px rgba(56, 189, 248, 0)",
          }}
          transition={{ type: "spring", stiffness: 300, damping: 20 }}
          drag={isDraggable}
          dragControls={dragControls}
          dragListener={false}
          dragMomentum={false}
          onDragEnd={handleDragEnd}
          onPointerDown={handlePointerDown}
          onPointerUp={handlePointerUpOrCancel}
          onPointerCancel={handlePointerUpOrCancel}
          className={cn(
            "rounded-full border border-border/40 bg-card/80 p-2.5 px-5 shadow-2xl backdrop-blur-xl dark:bg-[oklch(0.125_0.02_250/0.8)]",
            isDraggable ? "cursor-grabbing" : isFloating ? "cursor-grab" : "",
          )}
        >
          {content}
        </motion.div>
      </div>
    );
  }

  return content;
}
