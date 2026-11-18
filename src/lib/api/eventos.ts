// Servicio de eventos USB: por ahora, la limpieza del
// historial que ofrece el menú del panel. La lista de eventos
// la sirve el proveedor de datos con React Query.

import { mutacionJson } from "@/lib/http";

/** Borra el historial de eventos USB. */
export function limpiarHistorial() {
  return mutacionJson<{ ok: boolean; deletedEvents?: number }>(
    "/api/usb-event",
    "DELETE",
  );
}
