"use client";

import { useEffect, useState } from "react";
import dynamic from "next/dynamic";

/**
 * Carga perezosa de la paleta de comandos.
 *
 * La paleta (cmdk + menús) pesaba ~75 kB de JS (~23 kB gzip) en el
 * paquete inicial de TODAS las páginas del panel y del área de
 * usuario, se abriera o no: era parte del layout. Ahora el layout
 * monta solo este envoltorio mínimo, que escucha la invocación
 * (Ctrl/⌘+K — también el evento sintético que despacha el botón de
 * la lupa en la cabecera) y recién entonces descarga y monta la
 * paleta de verdad, ya abierta. La primera apertura paga una
 * descarga pequeña por la red local; las siguientes son al momento
 * porque el chunk queda en caché, y quien nunca usa la lupa no la
 * descarga nunca.
 */
const CommandPalette = dynamic(
  () => import("./CommandPalette").then((m) => m.CommandPalette),
  { ssr: false },
);

interface CommandPaletteLazyProps {
  /** Rol del usuario actual, determina qué navegación muestra */
  role?: "ADMIN" | "USER" | null;
}

export function CommandPaletteLazy({ role }: CommandPaletteLazyProps) {
  const [activada, setActivada] = useState(false);

  // Hasta la primera invocación, el único trabajo es escuchar la
  // misma combinación que antes escuchaba la paleta. Al activarse,
  // este oyente se retira: del Ctrl/⌘+K pasa a encargarse la paleta
  // montada (que nace abierta gracias a «abiertaAlMontar», así el
  // primer toque no se pierde ni se cuenta dos veces).
  useEffect(() => {
    if (activada) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        setActivada(true);
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [activada]);

  if (!activada) return null;
  return <CommandPalette role={role} abiertaAlMontar />;
}
