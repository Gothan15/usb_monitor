"use client";

import { motion } from "framer-motion";
import { Skeleton } from "@/components/ui/skeleton";
import { GlassPanel } from "@/components/ui/glass-panel";

const stagger = {
  hidden: { opacity: 0 },
  show: {
    opacity: 1,
    transition: { staggerChildren: 0.08 },
  },
};

const fadeUp = {
  hidden: { opacity: 0, y: 8 },
  show: {
    opacity: 1,
    y: 0,
    transition: { duration: 0.35, ease: [0.16, 1, 0.3, 1] as const },
  },
};

/** Skeleton matching StatsCards layout (4 KPI cards) */
function StatsCardsSkeleton() {
  return (
    <div className="grid gap-4 lg:grid-cols-4">
      {[...Array(4)].map((_, i) => (
        <motion.div key={i} variants={fadeUp}>
          <GlassPanel variant="default" className="p-5 space-y-3">
            <Skeleton className="h-3 w-20" />
            <Skeleton className="h-7 w-24" />
            <Skeleton className="h-2 w-full" />
          </GlassPanel>
        </motion.div>
      ))}
    </div>
  );
}

/** Skeleton matching chart + sidebar panel */
function ChartSkeleton() {
  return (
    <div className="grid gap-6 xl:grid-cols-[2fr_1fr]">
      <motion.div variants={fadeUp}>
        <GlassPanel
          variant="elevated"
          padding="none"
          className="overflow-hidden"
        >
          <div className="border-b border-border/50 px-5 py-4">
            <Skeleton className="h-4 w-48" />
            <Skeleton className="mt-1.5 h-3 w-64" />
          </div>
          <div className="p-4">
            <Skeleton className="h-[260px] w-full rounded-lg" />
          </div>
        </GlassPanel>
      </motion.div>
      <motion.div variants={fadeUp}>
        <GlassPanel variant="elevated" padding="none">
          <div className="border-b border-border/50 px-5 py-4">
            <Skeleton className="h-4 w-32" />
          </div>
          <div className="space-y-3 p-4">
            {[...Array(4)].map((_, i) => (
              <Skeleton key={i} className="h-14 w-full rounded-lg" />
            ))}
          </div>
        </GlassPanel>
      </motion.div>
    </div>
  );
}

/** Skeleton matching a table with header and rows */
function TableSkeleton({ rows = 6 }: { rows?: number }) {
  return (
    <motion.div variants={fadeUp}>
      <GlassPanel variant="elevated" padding="none" className="overflow-hidden">
        <div className="border-b border-border/50 px-5 py-4 flex items-center justify-between">
          <Skeleton className="h-4 w-40" />
          <Skeleton className="h-8 w-24 rounded-md" />
        </div>
        <div className="p-4 space-y-2">
          {/* Header row */}
          <div className="flex gap-4 px-3 py-2">
            {[120, 80, 160, 100, 60].map((w, i) => (
              <Skeleton key={i} className="h-3" style={{ width: w }} />
            ))}
          </div>
          {/* Data rows */}
          {[...Array(rows)].map((_, i) => (
            <Skeleton key={i} className="h-11 w-full rounded-lg" />
          ))}
        </div>
      </GlassPanel>
    </motion.div>
  );
}

/** Full dashboard overview skeleton */
export function DashboardSkeleton() {
  return (
    <motion.div
      variants={stagger}
      initial="hidden"
      animate="show"
      className="space-y-6"
    >
      <StatsCardsSkeleton />
      <ChartSkeleton />
      <div className="grid gap-6 xl:grid-cols-2">
        <motion.div variants={fadeUp}>
          <GlassPanel variant="elevated" className="space-y-3 p-4">
            <Skeleton className="h-4 w-32" />
            {[...Array(3)].map((_, i) => (
              <div key={i} className="flex gap-3">
                <Skeleton className="size-9 rounded-lg shrink-0" />
                <div className="flex-1 space-y-1.5">
                  <Skeleton className="h-3 w-2/3" />
                  <Skeleton className="h-2 w-1/2" />
                </div>
              </div>
            ))}
          </GlassPanel>
        </motion.div>
        <motion.div variants={fadeUp}>
          <GlassPanel variant="elevated" className="space-y-3 p-4">
            <Skeleton className="h-4 w-28" />
            <Skeleton className="h-[140px] w-full rounded-lg" />
          </GlassPanel>
        </motion.div>
      </div>
    </motion.div>
  );
}

/** Table page skeleton (Events, Computers, Users, Whitelist) */
export function TablePageSkeleton() {
  return (
    <motion.div
      variants={stagger}
      initial="hidden"
      animate="show"
      className="space-y-4"
    >
      {/* Quick filters bar */}
      <motion.div variants={fadeUp} className="flex gap-2">
        {[120, 100, 140].map((w, i) => (
          <Skeleton key={i} className="h-9 rounded-md" style={{ width: w }} />
        ))}
        <div className="flex-1" />
        <Skeleton className="h-9 w-28 rounded-md" />
      </motion.div>
      <TableSkeleton rows={8} />
    </motion.div>
  );
}
