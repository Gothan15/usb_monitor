import { TableHead } from "@/components/ui/table";
import { cn } from "@/lib/utils";
import { ArrowDown, ArrowUp, ArrowUpDown } from "lucide-react";
import { type SortDirection } from "@/hooks/useTableSort";

interface SortableTableHeadProps<T> {
  column: keyof T;
  currentSortKey: keyof T | null;
  currentSortDirection: SortDirection;
  onSort: (key: keyof T) => void;
  children: React.ReactNode;
  className?: string;
  align?: "left" | "right" | "center";
}

export function SortableTableHead<T>({
  column,
  currentSortKey,
  currentSortDirection,
  onSort,
  children,
  className,
  align = "left",
}: SortableTableHeadProps<T>) {
  const isActive = currentSortKey === column;
  const isAsc = isActive && currentSortDirection === "asc";
  const isDesc = isActive && currentSortDirection === "desc";

  return (
    <TableHead
      className={cn(
        "group cursor-pointer select-none transition-colors hover:bg-slate-100/70 dark:hover:bg-white/5",
        align === "right" && "text-right",
        align === "center" && "text-center",
        className
      )}
      onClick={() => onSort(column)}
    >
      <div
        className={cn(
          "flex items-center gap-2",
          align === "right" && "justify-end",
          align === "center" && "justify-center"
        )}
      >
        <span>{children}</span>
        <span
          className={cn(
            "inline-flex size-4 items-center justify-center transition-all",
            isActive
              ? "text-slate-700 dark:text-slate-200"
              : "text-slate-400 opacity-0 group-hover:opacity-100 dark:text-slate-500"
          )}
        >
          {!isActive && <ArrowUpDown className="size-3.5" />}
          {isAsc && <ArrowUp className="size-3.5" />}
          {isDesc && <ArrowDown className="size-3.5" />}
        </span>
      </div>
    </TableHead>
  );
}
