# -*- coding: utf-8 -*-
"""Visor de seriales USBMonitor v2.

Lista los dispositivos USB conectados con su serial, para copiarlo
y llevarlo a la lista blanca del panel. Nada más.
"""
from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from nucleo import pnp, registro
from nucleo.dispositivos import Detector

registro.configurar("visor.log")

FONDO = "#232a31"
PANEL = "#2b333b"
TEXTO = "#e8edf1"
TENUE = "#9fb0bd"
ACERO = "#4d7ca6"
MONO = ("Consolas", 10)
NORMAL = ("Segoe UI", 10)
TITULO = ("Segoe UI", 13, "bold")


def main() -> None:
    import tkinter as tk
    from tkinter import messagebox

    detector = Detector(pnp.ancestros)
    ventana = tk.Tk()
    ventana.title("USBMonitor — Seriales de dispositivos")
    ventana.configure(bg=FONDO)
    ventana.geometry("620x380")
    try:
        ventana.iconbitmap(str(Path(__file__).with_name("usb_monitor_service.ico")))
    except Exception:
        pass

    tk.Label(
        ventana, text="Dispositivos conectados", font=TITULO, fg=TEXTO,
        bg=FONDO, anchor="w",
    ).pack(anchor="w", padx=16, pady=(14, 2))
    tk.Label(
        ventana,
        text="Copia el serial de un dispositivo para agregarlo a la lista blanca.",
        font=NORMAL, fg=TENUE, bg=FONDO, anchor="w",
    ).pack(anchor="w", padx=16)

    lista = tk.Listbox(
        ventana, font=MONO, bg=PANEL, fg=TEXTO, height=11,
        activestyle="none", selectbackground=ACERO,
    )
    lista.pack(fill="both", expand=True, padx=16, pady=12)
    seriales: list[str] = []

    def refrescar():
        lista.delete(0, "end")
        seriales.clear()
        encontrados = detector.enumerar()
        for disp in encontrados.values():
            letra = disp.letra or "sin letra"
            lista.insert(
                "end",
                f"{disp.tipo:<9} {disp.serial or '—':<28} {letra:<5} {disp.nombre}",
            )
            seriales.append(disp.serial)
        if not encontrados:
            lista.insert("end", "Sin dispositivos vigilables conectados.")

    def copiar():
        seleccion = lista.curselection()
        if not seleccion:
            return
        serial = seriales[seleccion[0]]
        if not serial:
            messagebox.showwarning("Sin serial", "Ese dispositivo no reporta serial.")
            return
        ventana.clipboard_clear()
        ventana.clipboard_append(serial)
        messagebox.showinfo("Copiado", f"Serial copiado: {serial}")

    acciones = tk.Frame(ventana, bg=FONDO)
    acciones.pack(fill="x", padx=16, pady=(0, 14))
    tk.Button(
        acciones, text="Actualizar", command=refrescar, bg=PANEL, fg=TEXTO,
        font=NORMAL, bd=0, padx=14, pady=5,
    ).pack(side="left")
    tk.Button(
        acciones, text="Copiar serial", command=copiar, bg=ACERO, fg="white",
        font=NORMAL, bd=0, padx=14, pady=5,
    ).pack(side="left", padx=8)

    refrescar()
    ventana.mainloop()


if __name__ == "__main__":
    main()
