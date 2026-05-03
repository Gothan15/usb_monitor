"use client";

import { useEffect, useState } from "react";

export type PaginationStyle = "floating" | "static";

export interface PaginationPosition {
  x: number;
  y: number;
}

export function usePaginationSettings() {
  const [style, setStyle] = useState<PaginationStyle>("floating");
  const [position, setPosition] = useState<PaginationPosition | null>(null);
  const [isLoaded, setIsLoaded] = useState(false);

  // Cargar de localStorage en el montaje
  useEffect(() => {
    try {
      const savedStyle = localStorage.getItem("pagination_style") as PaginationStyle;
      if (savedStyle && (savedStyle === "floating" || savedStyle === "static")) {
        setStyle(savedStyle);
      }

      const savedPos = localStorage.getItem("pagination_position");
      if (savedPos) {
        setPosition(JSON.parse(savedPos));
      }
    } catch (error) {
      console.warn("Failed to parse pagination settings from localStorage", error);
    }
    setIsLoaded(true);
  }, []);

  // Sync to localStorage
  const handleSetStyle = (newStyle: PaginationStyle) => {
    setStyle(newStyle);
    localStorage.setItem("pagination_style", newStyle);
  };

  const handleSetPosition = (newPos: PaginationPosition | null) => {
    setPosition(newPos);
    if (newPos) {
      localStorage.setItem("pagination_position", JSON.stringify(newPos));
    } else {
      localStorage.removeItem("pagination_position");
    }
  };

  return {
    style,
    setStyle: handleSetStyle,
    position,
    setPosition: handleSetPosition,
    isLoaded,
  };
}
