"use client";

import type { ReactNode } from "react";
import type { LucideIcon } from "lucide-react";

/* ── Widget registry types ── */

export type WidgetSize = "sm" | "md" | "lg" | "full";

export interface WidgetDefinition {
  id: string;
  label: string;
  description: string;
  icon: LucideIcon;
  /** Default column span: sm=1, md=1, lg=2, full=3 */
  defaultSize: WidgetSize;
  /** The component that renders the widget content */
  component: React.ComponentType<WidgetContentProps>;
}

export interface WidgetContentProps {
  /** Whether the widget panel is collapsed */
  collapsed?: boolean;
}

export interface WidgetInstance {
  /** Unique instance ID */
  id: string;
  /** Reference to the widget definition type */
  type: string;
  /** Current column span override */
  size: WidgetSize;
  /** Whether collapsed */
  collapsed: boolean;
  /** Position order */
  order: number;
}

/* ── Size → col span mapping ── */

export const sizeToColSpan: Record<WidgetSize, string> = {
  sm: "xl:col-span-1",
  md: "xl:col-span-1",
  lg: "xl:col-span-2",
  full: "xl:col-span-3",
};

/* ── Layout persistence ── */

const STORAGE_KEY = "usb-monitor:dashboard-layout";

export function loadLayout(): WidgetInstance[] | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as WidgetInstance[];
  } catch {
    return null;
  }
}

export function saveLayout(layout: WidgetInstance[]): void {
  if (typeof window === "undefined") return;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(layout));
}

export function clearLayout(): void {
  if (typeof window === "undefined") return;
  localStorage.removeItem(STORAGE_KEY);
}
