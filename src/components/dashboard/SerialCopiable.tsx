"use client";

import { useEffect, useRef, useState } from "react";
import { Check, Copy } from "lucide-react";

// Serial con copia en un clic: al pulsarlo se copia y el
// icono se vuelve una marca un momento. El panel se sirve
// por HTTP en la red local, donde navigator.clipboard no
// existe (exige HTTPS o localhost): si la API moderna no
// está o falla, se cae al método clásico con un textarea
// temporal, que funciona en cualquier contexto.
export function SerialCopiable({
  serial,
  className = "",
}: {
  serial: string;
  className?: string;
}) {
  const [copiado, setCopiado] = useState(false);
  const temporizador = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (temporizador.current) clearTimeout(temporizador.current);
    },
    [],
  );

  const copiar = async () => {
    let ok = false;
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(serial);
        ok = true;
      }
    } catch {
      ok = false;
    }
    if (!ok) {
      try {
        const area = document.createElement("textarea");
        area.value = serial;
        area.style.position = "fixed";
        area.style.opacity = "0";
        document.body.appendChild(area);
        area.select();
        ok = document.execCommand("copy");
        area.remove();
      } catch {
        ok = false;
      }
    }
    if (ok) {
      setCopiado(true);
      if (temporizador.current) clearTimeout(temporizador.current);
      temporizador.current = setTimeout(() => setCopiado(false), 1500);
    }
  };

  return (
    <span className={`inline-flex items-center gap-1.5 ${className}`}>
      <span className="font-mono">{serial}</span>
      <button
        type="button"
        onClick={copiar}
        title={copiado ? "Copiado" : "Copiar serial"}
        aria-label={`Copiar el serial ${serial}`}
        className="shrink-0 text-muted-foreground transition-colors hover:text-foreground"
      >
        {copiado ? (
          <Check className="size-3.5 text-success" />
        ) : (
          <Copy className="size-3.5" />
        )}
      </button>
    </span>
  );
}
