"use client";
import React from "react";

// Premium spinner with smooth animations and modern design
// Accessible: includes aria-label and role="status"
export function Spinner({ size = 48 }: { size?: number }) {
  const px = `${size}px`;
  return (
    <div
      className="relative inline-block"
      style={{ width: px, height: px }}
      role="status"
      aria-label="Cargando"
    >
      {/* Base circle with subtle shadow */}
      <div
        className="absolute inset-0 rounded-full border-[3px] border-muted/20 shadow-inner"
        aria-hidden="true"
      />
      {/* Primary animated arc with gradient */}
      <div
        className="absolute inset-0 rounded-full border-[3px] border-transparent border-t-primary border-r-primary/60 animate-spin"
        aria-hidden="true"
        style={{ 
          animationDuration: "0.8s",
          animationTimingFunction: "cubic-bezier(0.4, 0, 0.2, 1)"
        }}
      />
      {/* Inner arc creating double-ring effect */}
      <div
        className="absolute inset-[6px] rounded-full border-[3px] border-transparent border-b-accent border-l-accent/60 animate-spin"
        aria-hidden="true"
        style={{ 
          animationDuration: "1.2s",
          animationTimingFunction: "cubic-bezier(0.4, 0, 0.2, 1)",
          animationDirection: "reverse"
        }}
      />
      {/* Subtle pulsing center */}
      <div className="absolute inset-0 flex items-center justify-center">
        <div className="h-1/3 w-1/3 rounded-full bg-gradient-to-br from-primary/70 to-accent/70 animate-pulse" 
          style={{
            animationDuration: "2s",
            animationTimingFunction: "cubic-bezier(0.4, 0, 0.6, 1)"
          }}
        />
      </div>
      <span className="sr-only">Cargando</span>
    </div>
  );
}

export function FullscreenSpinner({ label }: { label?: string }) {
  return (
    <div className="flex flex-col gap-6 items-center justify-center min-h-screen select-none bg-background">
      <div className="fade-in">
        <Spinner size={64} />
      </div>
      <div className="flex flex-col items-center text-center fade-in" style={{ animationDelay: "0.1s" }}>
        <p className="text-sm font-medium text-foreground tracking-wide">
          {label || "Verificando sesión"}
        </p>
        <p className="text-xs text-muted-foreground mt-2">
          Seguridad en curso…
        </p>
      </div>
    </div>
  );
}
