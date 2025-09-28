"use client";
import React from "react";

// Spinner moderno con anillos y gradiente suave.
// Accesible: incluye aria-label y role="status".
export function Spinner({ size = 48 }: { size?: number }) {
  const px = `${size}px`;
  return (
    <div
      className="relative inline-block"
      style={{ width: px, height: px }}
      role="status"
      aria-label="Cargando"
    >
      {/* Círculo base */}
      <div
        className="absolute inset-0 rounded-full border-[3px] border-muted/30"
        aria-hidden="true"
      />
      {/* Arco animado principal */}
      <div
        className="absolute inset-0 rounded-full border-[3px] border-transparent border-t-primary animate-spin"
        aria-hidden="true"
        style={{ animationDuration: "0.8s" }}
      />
      {/* Arco interior creando efecto de doble anillo */}
      <div
        className="absolute inset-[6px] rounded-full border-[3px] border-transparent border-b-primary/70 animate-spin"
        aria-hidden="true"
        style={{ animationDuration: "1.2s" }}
      />
      {/* Pulso suave en el centro */}
      <div className="absolute inset-0 flex items-center justify-center">
        <div className="h-1/3 w-1/3 rounded-full bg-primary/80 animate-pulse" />
      </div>
      <span className="sr-only">Cargando</span>
    </div>
  );
}

export function FullscreenSpinner({ label }: { label?: string }) {
  return (
    <div className="flex flex-col gap-4 items-center justify-center min-h-screen select-none">
      <Spinner size={56} />
      <div className="flex flex-col items-center text-center">
        <p className="text-sm font-medium text-foreground tracking-wide">
          {label || "Verificando sesión"}
        </p>
        <p className="text-xs text-muted-foreground mt-1">
          Seguridad en curso…
        </p>
      </div>
    </div>
  );
}
