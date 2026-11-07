"use client";

import { useTheme } from "next-themes";
import { useSyncExternalStore } from "react";
import { Moon, Sun } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export function ThemeToggle({ className }: { className?: string }) {
  const { theme, setTheme } = useTheme();
  const mounted = useSyncExternalStore(
    () => () => {},
    () => true,
    () => false
  );

  const isDark = theme === "dark" || (!theme && mounted);

  return (
    <Button
      type="button"
      variant="ghost"
      size="icon"
      aria-label="Cambiar tema"
      className={cn("size-9", className)}
      onClick={() => setTheme(isDark ? "light" : "dark")}
    >
      <span className="sr-only">Cambiar tema</span>
      {mounted ? (
        isDark ? (
          <Sun className="size-4" />
        ) : (
          <Moon className="size-4" />
        )
      ) : (
        <Sun className="size-4" />
      )}
    </Button>
  );
}
