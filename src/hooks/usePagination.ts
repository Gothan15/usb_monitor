"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

const DEFAULT_PAGE_SIZE_OPTIONS = [10, 20, 50, 100];

interface UsePaginationOptions {
  /** Total number of items (all pages) */
  totalItems: number;
  /** Starting page (default 1) */
  initialPage?: number;
  /** Starting page size (default 10) */
  initialPageSize?: number;
  /** Allowed page-size values */
  pageSizeOptions?: number[];
}

interface UsePaginationReturn {
  page: number;
  pageSize: number;
  pageCount: number;
  /** 1-based index of the first visible item (0 when empty) */
  startItem: number;
  /** 1-based index of the last visible item (0 when empty) */
  endItem: number;
  setPage: (page: number) => void;
  setPageSize: (size: number) => void;
  canPrevious: boolean;
  canNext: boolean;
  goFirst: () => void;
  goPrevious: () => void;
  goNext: () => void;
  goLast: () => void;
  pageSizeOptions: number[];
}

export function usePagination({
  totalItems,
  initialPage = 1,
  initialPageSize = 10,
  pageSizeOptions = DEFAULT_PAGE_SIZE_OPTIONS,
}: UsePaginationOptions): UsePaginationReturn {
  const [page, setPageRaw] = useState(initialPage);
  const [pageSize, setPageSizeRaw] = useState(initialPageSize);

  const safePageSize = Math.max(pageSize, 1);

  const pageCount = useMemo(() => {
    if (totalItems <= 0) return 1;
    return Math.ceil(totalItems / safePageSize);
  }, [totalItems, safePageSize]);

  // Clamp page when pageCount shrinks (e.g. after filtering / deleting)
  useEffect(() => {
    if (page > pageCount) {
      setPageRaw(pageCount);
    }
  }, [page, pageCount]);

  const currentPage = Math.min(Math.max(page, 1), pageCount);

  const startItem =
    totalItems === 0 ? 0 : (currentPage - 1) * safePageSize + 1;
  const endItem =
    totalItems === 0 ? 0 : Math.min(totalItems, currentPage * safePageSize);

  const setPage = useCallback(
    (next: number) => {
      setPageRaw(Math.min(Math.max(next, 1), pageCount));
    },
    [pageCount],
  );

  const setPageSize = useCallback((next: number) => {
    setPageSizeRaw(next);
    setPageRaw(1); // reset to first page on size change
  }, []);

  const canPrevious = currentPage > 1;
  const canNext = currentPage < pageCount;

  const goFirst = useCallback(() => setPageRaw(1), []);
  const goPrevious = useCallback(
    () => setPage(currentPage - 1),
    [currentPage, setPage],
  );
  const goNext = useCallback(
    () => setPage(currentPage + 1),
    [currentPage, setPage],
  );
  const goLast = useCallback(
    () => setPageRaw(pageCount),
    [pageCount],
  );

  return {
    page: currentPage,
    pageSize: safePageSize,
    pageCount,
    startItem,
    endItem,
    setPage,
    setPageSize,
    canPrevious,
    canNext,
    goFirst,
    goPrevious,
    goNext,
    goLast,
    pageSizeOptions,
  };
}
