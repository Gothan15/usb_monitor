"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { HTMLAttributes } from "react";
import { cn } from "@/lib/utils";

type ScrollbarHandlers = Pick<
  HTMLAttributes<HTMLElement>,
  | "onScroll"
  | "onMouseEnter"
  | "onMouseLeave"
  | "onFocusCapture"
  | "onBlurCapture"
>;

interface UseAmbientScrollbarOptions {
  /**
   * Time in milliseconds that the scrollbar remains visible after user interaction.
   * @default 700
   */
  timeout?: number;
}

interface UseAmbientScrollbarResult {
  scrollbarClassName: string;
  containerProps: ScrollbarHandlers;
  isActive: boolean;
}

export function useAmbientScrollbar(
  options: UseAmbientScrollbarOptions = {}
): UseAmbientScrollbarResult {
  const { timeout = 700 } = options;
  const [isActive, setIsActive] = useState(false);
  const hideTimeoutRef = useRef<number | null>(null);

  const clearHideTimeout = useCallback(() => {
    if (hideTimeoutRef.current) {
      window.clearTimeout(hideTimeoutRef.current);
      hideTimeoutRef.current = null;
    }
  }, []);

  const showScrollbars = useCallback(() => {
    clearHideTimeout();
    setIsActive(true);
  }, [clearHideTimeout]);

  const scheduleHideScrollbars = useCallback(() => {
    clearHideTimeout();
    hideTimeoutRef.current = window.setTimeout(() => {
      setIsActive(false);
      hideTimeoutRef.current = null;
    }, timeout);
  }, [clearHideTimeout, timeout]);

  const handleScroll: ScrollbarHandlers["onScroll"] = useCallback(() => {
    showScrollbars();
    scheduleHideScrollbars();
  }, [scheduleHideScrollbars, showScrollbars]);

  const handlePointerEnter: ScrollbarHandlers["onMouseEnter"] =
    useCallback(() => {
      showScrollbars();
    }, [showScrollbars]);

  const handlePointerLeave: ScrollbarHandlers["onMouseLeave"] =
    useCallback(() => {
      scheduleHideScrollbars();
    }, [scheduleHideScrollbars]);

  const handleFocus: ScrollbarHandlers["onFocusCapture"] = useCallback(() => {
    showScrollbars();
  }, [showScrollbars]);

  const handleBlur: ScrollbarHandlers["onBlurCapture"] = useCallback(() => {
    scheduleHideScrollbars();
  }, [scheduleHideScrollbars]);

  useEffect(() => {
    return () => {
      clearHideTimeout();
    };
  }, [clearHideTimeout]);

  const containerProps: ScrollbarHandlers = useMemo(
    () => ({
      onScroll: handleScroll,
      onMouseEnter: handlePointerEnter,
      onMouseLeave: handlePointerLeave,
      onFocusCapture: handleFocus,
      onBlurCapture: handleBlur,
    }),
    [
      handleBlur,
      handleFocus,
      handlePointerEnter,
      handlePointerLeave,
      handleScroll,
    ]
  );

  const scrollbarClassName = useMemo(
    () =>
      cn("scrollbar-ambient", isActive ? "scrollbar-active" : "scrollbar-idle"),
    [isActive]
  );

  return { scrollbarClassName, containerProps, isActive };
}
