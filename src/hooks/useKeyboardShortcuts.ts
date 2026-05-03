"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

function isEditableTarget(target: EventTarget | null): boolean {
  const element = target as HTMLElement | null;
  if (!element) return false;
  const tag = element.tagName;
  return (
    element.isContentEditable ||
    tag === "INPUT" ||
    tag === "TEXTAREA" ||
    tag === "SELECT"
  );
}

/**
 * Global keyboard shortcuts.
 * Numbers 1-9 navigate to navItems by index.
 * Must hold Alt (Windows) / Option (Mac) + digit.
 */
export function useKeyboardShortcuts(
  navItems: { href: string }[],
  opts?: { onRefresh?: () => void; onOpenShortcuts?: () => void },
) {
  const router = useRouter();

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (isEditableTarget(e.target)) return;

      /* Ctrl/Cmd+/ → open shortcuts help */
      if ((e.ctrlKey || e.metaKey) && e.key === "/" && opts?.onOpenShortcuts) {
        e.preventDefault();
        opts.onOpenShortcuts();
        return;
      }

      /* Alt+1…9 → navigate to section */
      if (e.altKey && !e.ctrlKey && !e.metaKey) {
        const num = parseInt(e.key, 10);
        if (num >= 1 && num <= 9) {
          const item = navItems[num - 1];
          if (item) {
            e.preventDefault();
            router.push(item.href);
          }
        }
      }

      /* Alt+R → refresh */
      if (e.altKey && e.key === "r" && opts?.onRefresh) {
        e.preventDefault();
        opts.onRefresh();
      }
    };

    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [navItems, opts?.onOpenShortcuts, opts?.onRefresh, router]);
}
