import type { LucideIcon } from "lucide-react";

/**
 * Canal de avisos entre capas: el proveedor de datos en vivo vive POR
 * ENCIMA del proveedor de notificaciones en el árbol, así que no puede
 * usar su contexto. Este bus mínimo desacopla emisor y receptor.
 */
export interface NotificationDraft {
  title: string;
  description?: string;
  icon?: LucideIcon;
  tone?: "default" | "success" | "warning" | "danger" | "info";
}

type Listener = (n: NotificationDraft) => void;

const listeners = new Set<Listener>();

export function onNotification(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function emitNotification(n: NotificationDraft): void {
  listeners.forEach((listener) => listener(n));
}
