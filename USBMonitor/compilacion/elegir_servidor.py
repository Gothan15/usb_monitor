# -*- coding: utf-8 -*-
"""Ventana para elegir el servidor del agente antes de compilar.

La llama Build-All.ps1 con -ElegirServidor. Guarda la elección en
USBMonitor/server.json (junto a las fuentes); Build-All copia ese
archivo junto a los ejecutables del servicio y del compañero, y el
agente lo lee con prioridad sobre las variables de entorno del
sistema. Así la carpeta compilada queda autocontenida: copiarla a
otra PC no exige configurar variables de entorno.

Código de salida: 0 = guardado, 2 = cancelado, 3 = sin interfaz.
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

RAIZ = Path(__file__).resolve().parent.parent
DESTINO = RAIZ / "server.json"
ACERO = "#33566e"


def leer_actual() -> dict:
    try:
        if DESTINO.is_file():
            data = json.loads(DESTINO.read_text(encoding="utf-8"))
            if isinstance(data, dict):
                return data
    except Exception:
        pass
    return {}


def main() -> int:
    try:
        import tkinter as tk
        from tkinter import messagebox
    except Exception:
        print("Este equipo no tiene tkinter: no se puede abrir la ventana.")
        return 3

    actual = leer_actual()
    host_inicial = str(actual.get("serverHost") or "localhost")
    puerto_inicial = str(actual.get("serverPort") or 3000)

    ventana = tk.Tk()
    ventana.title("USBMonitor — Servidor del agente")
    ventana.resizable(False, False)
    ventana.configure(bg="#f4f5f6")

    resultado = {"codigo": 2}

    marco = tk.Frame(ventana, bg="#f4f5f6", padx=22, pady=18)
    marco.pack()

    tk.Label(
        marco,
        text="¿A qué servidor se conectará el agente?",
        font=("Segoe UI", 12, "bold"),
        bg="#f4f5f6",
        fg="#1c2733",
    ).pack(anchor="w")
    tk.Label(
        marco,
        text=(
            "Se guarda en server.json junto a los ejecutables.\n"
            "No necesitas variables de entorno del sistema."
        ),
        font=("Segoe UI", 9),
        bg="#f4f5f6",
        fg="#5a6a78",
        justify="left",
    ).pack(anchor="w", pady=(4, 14))

    tk.Label(
        marco, text="IP o nombre del servidor", font=("Segoe UI", 9),
        bg="#f4f5f6", fg="#1c2733",
    ).pack(anchor="w")
    var_host = tk.StringVar(value=host_inicial)
    entrada_host = tk.Entry(
        marco, textvariable=var_host, font=("Consolas", 11), width=34,
    )
    entrada_host.pack(anchor="w", pady=(2, 10), ipady=3)

    tk.Label(
        marco, text="Puerto", font=("Segoe UI", 9),
        bg="#f4f5f6", fg="#1c2733",
    ).pack(anchor="w")
    var_puerto = tk.StringVar(value=puerto_inicial)
    tk.Entry(
        marco, textvariable=var_puerto, font=("Consolas", 11), width=10,
    ).pack(anchor="w", pady=(2, 16), ipady=3)

    def guardar() -> None:
        host = var_host.get().strip()
        if not host:
            messagebox.showwarning(
                "Servidor vacío", "Escribe la IP o el nombre del servidor."
            )
            return
        try:
            puerto = int(var_puerto.get().strip())
            if not (1 <= puerto <= 65535):
                raise ValueError
        except ValueError:
            messagebox.showwarning(
                "Puerto inválido", "El puerto debe ser un número entre 1 y 65535."
            )
            return
        datos = leer_actual()
        datos["serverHost"] = host
        datos["serverPort"] = puerto
        datos.setdefault("serverScheme", "http")
        try:
            DESTINO.write_text(
                json.dumps(datos, indent=2, ensure_ascii=False), encoding="utf-8"
            )
        except Exception as exc:
            messagebox.showerror("No se pudo guardar", str(exc))
            return
        resultado["codigo"] = 0
        ventana.destroy()

    def cancelar() -> None:
        resultado["codigo"] = 2
        ventana.destroy()

    botones = tk.Frame(marco, bg="#f4f5f6")
    botones.pack(anchor="e")
    tk.Button(
        botones, text="Cancelar", command=cancelar,
        font=("Segoe UI", 9), padx=12, pady=4,
    ).pack(side="left", padx=(0, 8))
    tk.Button(
        botones, text="Guardar y compilar", command=guardar,
        font=("Segoe UI", 9, "bold"), padx=12, pady=4,
        bg=ACERO, fg="white", activebackground=ACERO, activeforeground="white",
    ).pack(side="left")

    ventana.protocol("WM_DELETE_WINDOW", cancelar)
    ventana.bind("<Return>", lambda _e: guardar())
    ventana.bind("<Escape>", lambda _e: cancelar())
    entrada_host.focus_set()
    entrada_host.selection_range(0, "end")
    ventana.mainloop()
    return resultado["codigo"]


if __name__ == "__main__":
    sys.exit(main())
