"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Download } from "lucide-react";

/**
 * Botón de exportar a CSV con rango rápido: hoy, 7 días,
 * 30 días o todo el historial. La descarga la sirve la ruta
 * que se le pase (con las fechas como AAAA-MM-DD); la sesión
 * viaja sola por ser una navegación del mismo origen.
 */
export function ExportarCsv({ ruta }: { ruta: string }) {
  const [rango, setRango] = useState("30d");

  const fechaLocal = (d: Date) =>
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

  const exportar = () => {
    const hoy = new Date();
    let desde = "1970-01-01";
    if (rango === "hoy") {
      desde = fechaLocal(hoy);
    } else if (rango === "7d" || rango === "30d") {
      const dias = rango === "7d" ? 6 : 29;
      desde = fechaLocal(new Date(hoy.getTime() - dias * 86_400_000));
    }
    const params = new URLSearchParams({
      desde,
      hasta: fechaLocal(hoy),
    });
    window.location.href = `${ruta}?${params.toString()}`;
  };

  return (
    <span className="inline-flex items-center gap-2">
      <select
        value={rango}
        onChange={(e) => setRango(e.target.value)}
        aria-label="Rango de la exportación"
        className="border border-border bg-transparent px-2 py-1.5 text-xs"
      >
        <option value="hoy">Hoy</option>
        <option value="7d">Últimos 7 días</option>
        <option value="30d">Últimos 30 días</option>
        <option value="todo">Todo</option>
      </select>
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="inline-flex items-center gap-2"
        onClick={exportar}
      >
        <Download className="size-3.5" />
        Exportar CSV
      </Button>
    </span>
  );
}
