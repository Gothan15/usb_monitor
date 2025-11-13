import { useMemo, useState } from "react";

export type SortDirection = "asc" | "desc" | null;

export interface SortConfig<T> {
  key: keyof T | null;
  direction: SortDirection;
}

export function useTableSort<T>(data: T[], initialKey?: keyof T) {
  const [sortConfig, setSortConfig] = useState<SortConfig<T>>({
    key: initialKey ?? null,
    direction: null,
  });

  const sortedData = useMemo(() => {
    if (!sortConfig.key || !sortConfig.direction) {
      return data;
    }

    const sorted = [...data].sort((a, b) => {
      const aValue = a[sortConfig.key!];
      const bValue = b[sortConfig.key!];

      // Handle null/undefined values
      if (aValue == null && bValue == null) return 0;
      if (aValue == null) return 1;
      if (bValue == null) return -1;

      // Handle nested objects (e.g., computer.name)
      const aVal =
        typeof aValue === "object" && aValue !== null && "name" in aValue
          ? (aValue as any).name
          : aValue;
      const bVal =
        typeof bValue === "object" && bValue !== null && "name" in bValue
          ? (bValue as any).name
          : bValue;

      // String comparison
      if (typeof aVal === "string" && typeof bVal === "string") {
        return sortConfig.direction === "asc"
          ? aVal.localeCompare(bVal, "es", { sensitivity: "base" })
          : bVal.localeCompare(aVal, "es", { sensitivity: "base" });
      }

      // Number comparison
      if (typeof aVal === "number" && typeof bVal === "number") {
        return sortConfig.direction === "asc" ? aVal - bVal : bVal - aVal;
      }

      // Boolean comparison
      if (typeof aVal === "boolean" && typeof bVal === "boolean") {
        return sortConfig.direction === "asc"
          ? Number(aVal) - Number(bVal)
          : Number(bVal) - Number(aVal);
      }

      // Date comparison
      if (aVal instanceof Date && bVal instanceof Date) {
        return sortConfig.direction === "asc"
          ? aVal.getTime() - bVal.getTime()
          : bVal.getTime() - aVal.getTime();
      }

      // String date comparison (ISO format)
      const aDate = new Date(aVal as any);
      const bDate = new Date(bVal as any);
      if (!isNaN(aDate.getTime()) && !isNaN(bDate.getTime())) {
        return sortConfig.direction === "asc"
          ? aDate.getTime() - bDate.getTime()
          : bDate.getTime() - aDate.getTime();
      }

      // Fallback to string comparison
      return sortConfig.direction === "asc"
        ? String(aVal).localeCompare(String(bVal), "es")
        : String(bVal).localeCompare(String(aVal), "es");
    });

    return sorted;
  }, [data, sortConfig]);

  const requestSort = (key: keyof T) => {
    let direction: SortDirection = "asc";

    if (sortConfig.key === key) {
      if (sortConfig.direction === "asc") {
        direction = "desc";
      } else if (sortConfig.direction === "desc") {
        direction = null;
      }
    }

    setSortConfig({ key: direction ? key : null, direction });
  };

  return { sortedData, sortConfig, requestSort };
}
