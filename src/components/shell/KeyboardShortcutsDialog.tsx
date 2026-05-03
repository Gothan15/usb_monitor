"use client";

import { Keyboard } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

interface KeyboardShortcutsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const shortcuts = [
  {
    keys: "Alt + 1..9",
    description: "Navegar entre secciones del panel",
  },
  {
    keys: "Alt + R",
    description: "Actualizar datos del panel",
  },
  {
    keys: "Ctrl/⌘ + K",
    description: "Abrir paleta de comandos",
  },
  {
    keys: "Ctrl/⌘ + /",
    description: "Abrir esta ayuda de atajos",
  },
  {
    keys: "Esc",
    description: "Cerrar paneles y diálogos abiertos",
  },
];

export function KeyboardShortcutsDialog({
  open,
  onOpenChange,
}: KeyboardShortcutsDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-base">
            <Keyboard className="size-4 text-primary" />
            Atajos de teclado
          </DialogTitle>
          <DialogDescription>
            Usa estos atajos para moverte mas rapido por el sistema.
          </DialogDescription>
        </DialogHeader>

        <div className="mt-1 divide-y divide-border/40 rounded-lg border border-border/50 bg-card/40">
          {shortcuts.map((shortcut) => (
            <div
              key={shortcut.keys}
              className="flex items-center justify-between gap-4 px-4 py-3"
            >
              <span className="text-xs text-foreground">{shortcut.description}</span>
              <kbd className="rounded-md border border-border/60 bg-muted/40 px-2 py-1 font-mono text-[11px] font-medium text-muted-foreground">
                {shortcut.keys}
              </kbd>
            </div>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}
