"use client";

import { useEffect, useState } from "react";
import type { HistoryRange } from "@/components/dashboard/types";

const STORAGE_KEY = "usb-history-range";

function coerceRange(value: unknown): HistoryRange {
  const n = Number(value);
  if (n === 7 || n === 30) return n;
  return 1;
}

export function useUsbHistoryRange(): [
  HistoryRange,
  (next: HistoryRange) => void
] {
  const [range, setRange] = useState<HistoryRange>(() => {
    if (typeof window === "undefined") return 1;
    try {
      const raw = window.localStorage.getItem(STORAGE_KEY);
      return coerceRange(raw);
    } catch {
      return 1;
    }
  });

  useEffect(() => {
    try {
      window.localStorage.setItem(STORAGE_KEY, String(range));
    } catch {
      // ignore
    }
  }, [range]);

  return [range, setRange];
}
