"use client";

import {
  DashboardSkeleton,
  TablePageSkeleton,
} from "@/components/shared/DashboardSkeleton";

interface DashboardFallbackProps {
  label: string;
  variant?: "dashboard" | "table";
}

export function DashboardFallback({
  label,
  variant = "dashboard",
}: DashboardFallbackProps) {
  return (
    <div aria-label={label}>
      {variant === "table" ? <TablePageSkeleton /> : <DashboardSkeleton />}
    </div>
  );
}
