"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
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
      {/* El mismo desplegable que el de ordenación y que el
          selector de adaptadores del Escáner: el Select (Radix)
          con caja en tamaño sm, no el <select> nativo con
          subrayado de antes. */}
      <Select value={rango} onValueChange={setRango}>
        <SelectTrigger
          size="sm"
          className="min-w-[160px]"
          aria-label="Rango de la exportación"
        >
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="hoy">Hoy</SelectItem>
          <SelectItem value="7d">Últimos 7 días</SelectItem>
          <SelectItem value="30d">Últimos 30 días</SelectItem>
          <SelectItem value="todo">Todo</SelectItem>
        </SelectContent>
      </Select>
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
