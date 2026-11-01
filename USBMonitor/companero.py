# -*- coding: utf-8 -*-
"""Compañero USBMonitor v2: la ventana de la contraseña.

Vive en la sesión del usuario (el servicio, en sesión 0, no puede
mostrar ventanas). No detecta nada por sí solo: lee cada 2 segundos
el `pending_local.json` que el servicio escribe de forma atómica, y
muestra los dispositivos bloqueados que esperan contraseña.

Reglas (las del panel, que es quien decide):
  - Fuera de la lista blanca: solo el aviso de bloqueo, sin campos.
  - La contraseña se envía a /api/usb-auth; el servidor responde 200
    (autorizado), 403 con su mensaje (fuera de la whitelist o
    desbloqueo desactivado) o 401 genérico (credenciales o cuenta
    sin derecho sobre esta PC: el servidor no distingue, a propósito).
  - Un solo envío en vuelo: el botón se deshabilita al enviar.
"""
from __future__ import annotations

import json
import os
import sys
import threading
import time
from pathlib import Path
from typing import Dict, List, Optional

sys.path.insert(0, str(Path(__file__).resolve().parent))

from nucleo import registro
from nucleo.api import ClientePanel
from nucleo.registro import PROGRAM_DATA_DIR

LOG = registro.configurar("companero.log")
ARCHIVO_PENDIENTES = PROGRAM_DATA_DIR / "pending_local.json"

FONDO = "#232a31"
PANEL = "#2b333b"
TEXTO = "#e8edf1"
TENUE = "#9fb0bd"
ACERO = "#4d7ca6"
VERDE = "#3fa46a"
AMBAR = "#d9a13b"
ROJO = "#c0453e"
MONO = ("Consolas", 10)
NORMAL = ("Segoe UI", 10)
TITULO = ("Segoe UI", 13, "bold")


def leer_pendientes() -> List[Dict]:
    try:
        datos = json.loads(ARCHIVO_PENDIENTES.read_text(encoding="utf-8"))
        if isinstance(datos, list):
            return datos
    except Exception:
        pass
    return []


class VentanaCompanero:
    def __init__(self) -> None:
        import tkinter as tk

        self.tk = tk
        self.cliente = ClientePanel()
        self.raiz = tk.Tk()
        self.raiz.title("USBMonitor — Dispositivo bloqueado")
        self.raiz.configure(bg=FONDO)
        self.raiz.resizable(False, False)
        self.raiz.withdraw()
        try:
            self.raiz.iconbitmap(
                str(Path(__file__).with_name("usb_prompt.ico"))
            )
        except Exception:
            pass
        self._enviando = False
        self._clave_actual: Optional[str] = None
        self._pendientes: List[Dict] = []
        self._construir()
        self._vigilar_archivo()
        self.raiz.after(1000, self._latido_debug)

    def _construir(self) -> None:
        tk = self.tk
        marco = tk.Frame(self.raiz, bg=FONDO, padx=20, pady=16)
        marco.pack()
        self._titular = tk.Label(
            marco, text="Dispositivo bloqueado", font=TITULO, fg=TEXTO,
            bg=FONDO, anchor="w",
        )
        self._titular.pack(anchor="w")
        self._detalle = tk.Label(
            marco, text="", font=MONO, fg=TENUE, bg=FONDO, anchor="w",
            justify="left",
        )
        self._detalle.pack(anchor="w", pady=(2, 10))

        self._selector = tk.StringVar()
        self._menu = tk.OptionMenu(marco, self._selector, "")
        self._menu.configure(bg=PANEL, fg=TEXTO, font=NORMAL, bd=0)
        self._menu.pack(anchor="w", fill="x", pady=(0, 8))

        self._aviso = tk.Label(
            marco, text="", font=NORMAL, fg=AMBAR, bg=FONDO, anchor="w",
            justify="left", wraplength=380,
        )
        self._aviso.pack(anchor="w", pady=(0, 8))

        self._formulario = tk.Frame(marco, bg=FONDO)
        self._formulario.pack(anchor="w", fill="x")
        tk.Label(
            self._formulario, text="Usuario", font=NORMAL, fg=TEXTO, bg=FONDO
        ).pack(anchor="w")
        self._usuario = tk.Entry(self._formulario, font=NORMAL, width=38)
        self._usuario.pack(anchor="w", pady=(2, 8))
        tk.Label(
            self._formulario, text="Contraseña", font=NORMAL, fg=TEXTO, bg=FONDO
        ).pack(anchor="w")
        self._contrasena = tk.Entry(self._formulario, font=NORMAL, width=38, show="•")
        self._contrasena.pack(anchor="w", pady=(2, 10))
        self._boton = tk.Button(
            self._formulario, text="Desbloquear", command=self._enviar,
            bg=ACERO, fg="white", font=NORMAL, bd=0, padx=16, pady=5,
        )
        self._boton.pack(anchor="w")
        self._mensaje = tk.Label(
            marco, text="", font=NORMAL, fg=TENUE, bg=FONDO, anchor="w",
            justify="left", wraplength=380,
        )
        self._mensaje.pack(anchor="w", pady=(10, 0))
        self.raiz.bind("<Return>", lambda _e: self._enviar())
        self._selector.trace_add("write", lambda *_: self._al_elegir())

    # ── latido de depuración (1/s, a DEBUG en companero.log) ────
    def _latido_debug(self) -> None:
        """Una línea por segundo para saber si el compañero seguía
        vivo y qué veía. Un fallo del tick jamás tumba la ventana."""
        try:
            try:
                antiguedad = time.time() - ARCHIVO_PENDIENTES.stat().st_mtime
                texto_archivo = f"pending_local.json de hace {antiguedad:.0f} s"
            except FileNotFoundError:
                texto_archivo = "pending_local.json: sin archivo"
            except OSError as exc:
                texto_archivo = f"pending_local.json ilegible: {exc}"
            LOG.debug(
                "latido: pendientes=%s, %s, ventana %s",
                len(self._pendientes),
                texto_archivo,
                "visible" if self.raiz.winfo_ismapped() else "retirada",
            )
        except Exception as exc:
            try:
                LOG.debug("latido del compañero falló: %s", exc)
            except Exception:
                pass
        finally:
            try:
                self.raiz.after(1000, self._latido_debug)
            except Exception:
                pass

    # ── ciclo de vida ─────────────────────────────────────────────
    def _vigilar_archivo(self) -> None:
        pendientes = leer_pendientes()
        firma = json.dumps(pendientes, sort_keys=True)
        if firma != getattr(self, "_firma", None):
            self._firma = firma
            self._pendientes = pendientes
            self._refrescar()
        self.raiz.after(2000, self._vigilar_archivo)

    def _refrescar(self) -> None:
        if not self._pendientes:
            self.raiz.withdraw()
            self._clave_actual = None
            return
        menu = self._menu["menu"]
        menu.delete(0, "end")
        for p in self._pendientes:
            etiqueta = f"{p.get('nombre') or 'Dispositivo'} · {p.get('serial') or ''}"
            menu.add_command(
                label=etiqueta, command=lambda v=etiqueta: self._selector.set(v)
            )
        if self._clave_actual not in [p.get("clave") for p in self._pendientes]:
            primero = self._pendientes[0]
            self._selector.set(
                f"{primero.get('nombre') or 'Dispositivo'} · {primero.get('serial') or ''}"
            )
        self.raiz.deiconify()
        self.raiz.lift()
        self.raiz.attributes("-topmost", True)
        self.raiz.after(600, lambda: self.raiz.attributes("-topmost", False))
        self._al_elegir()

    def _actual(self) -> Optional[Dict]:
        elegido = self._selector.get()
        for p in self._pendientes:
            if f"{p.get('nombre') or 'Dispositivo'} · {p.get('serial') or ''}" == elegido:
                return p
        return self._pendientes[0] if self._pendientes else None

    def _al_elegir(self) -> None:
        actual = self._actual()
        if not actual:
            return
        self._clave_actual = actual.get("clave")
        letra = actual.get("letra") or "sin letra"
        self._detalle.configure(
            text=f"{actual.get('nombre') or 'Dispositivo'}\n"
            f"serial {actual.get('serial') or '—'} · unidad {letra}"
        )
        if actual.get("en_whitelist") is False:
            self._aviso.configure(
                text="USB no listado en la lista blanca: será bloqueado."
            )
            self._formulario.pack_forget()
        else:
            self._aviso.configure(text="")
            self._formulario.pack(anchor="w", fill="x")
            self._usuario.focus_set()

    # ── envío ─────────────────────────────────────────────────────
    def _enviar(self) -> None:
        if self._enviando:
            return
        actual = self._actual()
        if not actual:
            return
        usuario = self._usuario.get().strip()
        contrasena = self._contrasena.get()
        if not usuario or not contrasena:
            self._mensaje.configure(
                text="Escribe tu usuario y tu contraseña.", fg=AMBAR
            )
            return
        self._enviando = True
        self._boton.configure(state="disabled", text="Comprobando…")
        self._mensaje.configure(text="", fg=TENUE)

        def trabajo():
            respuesta = self.cliente.autenticar_desbloqueo(
                usuario,
                contrasena,
                letra=actual.get("letra"),
                serial=actual.get("serial"),
            )
            self.raiz.after(0, lambda: self._al_responder(respuesta))

        threading.Thread(target=trabajo, daemon=True).start()

    def _al_responder(self, respuesta: Dict) -> None:
        self._enviando = False
        self._boton.configure(state="normal", text="Desbloquear")
        codigo = respuesta.get("estado_http", 0)
        if respuesta.get("autorizado"):
            self._mensaje.configure(
                text="Autorizado. El dispositivo se está liberando…", fg=VERDE
            )
            self._contrasena.delete(0, "end")
            return
        if codigo == 403 and respuesta.get("mensaje"):
            self._mensaje.configure(text=respuesta["mensaje"], fg=AMBAR)
        elif codigo == 401:
            self._mensaje.configure(
                text="Usuario o contraseña incorrectos, o esa cuenta no es "
                "la dueña de esta PC ni administradora.",
                fg=ROJO,
            )
        elif codigo == 0:
            self._mensaje.configure(
                text="Sin conexión con el servidor. Si urge, usa la página "
                "de emergencia: http://localhost:5001/desbloquear",
                fg=AMBAR,
            )
        else:
            self._mensaje.configure(
                text=respuesta.get("mensaje") or "El servidor no autorizó.",
                fg=ROJO,
            )
        self._contrasena.delete(0, "end")
        self._contrasena.focus_set()

    def ejecutar(self) -> None:
        self.raiz.mainloop()


def main() -> None:
    # Una sola instancia: si ya hay compañero, este sale — pero ya
    # no en silencio: cada arranque y cada salida quedan en el log.
    import socket

    LOG.info("Compañero iniciado, pid %s", os.getpid())
    candado = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    try:
        candado.bind(("127.0.0.1", 50137))
    except OSError:
        LOG.warning("Ya hay un compañero en marcha: este proceso sale")
        return
    try:
        VentanaCompanero().ejecutar()
    except Exception:
        LOG.exception("EL COMPAÑERO SE CERRÓ POR UN ERROR")
    finally:
        LOG.info("Compañero terminado")


if __name__ == "__main__":
    main()
