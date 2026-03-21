"use client";

import { useTheme } from "next-themes";
import { useEffect, useState } from "react";
import { Moon, Sun } from "lucide-react";
import { Button } from "@/components/ui/button";

export function ThemeToggle() {
  const { theme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);

  useEffect(() => setMounted(true), []);

  const isDark = theme === "dark" || (!theme && mounted);

  return (
    <Button
      type="button"
      variant="ghost"
      size="icon"
      aria-label="Cambiar tema"
      className="relative h-10 w-10 rounded-full border border-border/40 bg-card/80 text-muted-foreground backdrop-blur transition hover:bg-muted/60"
      onClick={() => setTheme(isDark ? "light" : "dark")}
    >
      <span className="sr-only">Cambiar tema</span>
      {mounted ? (
        isDark ? (
          <Sun className="h-4 w-4" />
        ) : (
          <Moon className="h-4 w-4" />
        )
      ) : (
        <Sun className="h-4 w-4" />
      )}
    </Button>
  );
}
