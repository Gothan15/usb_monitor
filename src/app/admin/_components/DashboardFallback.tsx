"use client";

interface DashboardFallbackProps {
  label: string;
}

export function DashboardFallback({ label }: DashboardFallbackProps) {
  return (
    <div className="flex min-h-[200px] items-center justify-center rounded-2xl border border-slate-200/60 bg-white/60 text-sm text-slate-500 shadow-sm dark:border-slate-800/60 dark:bg-slate-900/60 dark:text-slate-300">
      {label}
    </div>
  );
}
