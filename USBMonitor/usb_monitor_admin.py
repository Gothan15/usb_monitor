"""Herramienta gráfica de gestión del Monitor USB (Fase 6).

Aquí vive la interfaz de escritorio que antes estaba dentro de
usb_monitor_service.py: el servicio (sesión 0) ya no importa tkinter
ni se conecta a la base de datos; esta herramienta se ejecuta en la
sesión del usuario, importa los ayudantes del módulo del servicio y
se lanza con «usb_monitor_admin.py» o con el argumento «gui» del
propio servicio.

El configurador de API key es MANUAL desde la Fase 6: antes listaba
todos los usuarios y sus claves leyendo PostgreSQL en directo; ahora
se pega la clave y se guarda (cifrada) con run_setx, como siempre se
aplicó. En instalaciones modernas el agente se autentica con el token
por equipo y esta clave es el camino heredado.
"""

from __future__ import annotations

import os
import sys
import threading
import time
import tkinter as tk
from tkinter import messagebox, simpledialog, ttk
from tkinter.scrolledtext import ScrolledText
from typing import Callable, Optional

from usb_monitor_service import *  # noqa: F401,F403 - ayudantes y constantes del servicio
from usb_monitor_service import (
    LOGGER,
    is_user_admin,
    run_setx,
    _execute_service_command,
    _get_service_autostart_status,
    _query_service_state,
    _set_server_host,
    _toggle_server_scheme,
    _toggle_service_autostart,
    _toggle_ssl_verify,
)


class ApiKeyConfiguratorDialog(tk.Toplevel):
    """Ventana para pegar y aplicar la API key del agente (manual)."""

    def __init__(
        self,
        parent: tk.Misc,
        *,
        on_log: Optional[Callable[[str], None]] = None,
    ):
        super().__init__(parent)
        self.on_log = on_log
        self.title("USB Monitor - Configurar API Key")
        self.geometry("560x240")
        self.resizable(False, False)
        self.transient(parent)

        frame = ttk.Frame(self, padding=16)
        frame.pack(fill="both", expand=True)

        ttk.Label(
            frame,
            text=(
                "Pega la API key del usuario del agente. Se guardará cifrada "
                "como variable de máquina USB_MONITOR_API_KEY (setx) y el "
                "servicio la usará al reiniciar."
            ),
            wraplength=520,
            justify="left",
        ).pack(anchor="w")

        self.key_var = tk.StringVar()
        self.entry = ttk.Entry(frame, textvariable=self.key_var, show="•", width=64)
        self.entry.pack(fill="x", pady=(12, 6))
        self.entry.focus_set()

        self.show_var = tk.BooleanVar(value=False)
        ttk.Checkbutton(
            frame,
            text="Mostrar la clave",
            variable=self.show_var,
            command=lambda: self.entry.configure(show="" if self.show_var.get() else "•"),
        ).pack(anchor="w")

        buttons = ttk.Frame(frame)
        buttons.pack(fill="x", pady=(14, 0))
        ttk.Button(buttons, text="Cancelar", command=self.destroy).pack(side="right")
        ttk.Button(buttons, text="Aplicar", command=self._apply).pack(
            side="right", padx=(0, 8)
        )

    def _emit_log(self, text: str) -> None:
        if self.on_log:
            self.on_log(text)

    def _apply(self) -> None:
        api_key = self.key_var.get().strip()
        if not api_key:
            messagebox.showerror(
                "Falta la clave", "Escribe o pega la API key antes de aplicar.", parent=self
            )
            return
        try:
            run_setx(api_key)
        except Exception as exc:
            LOGGER.error("No se pudo guardar la API key: %s", exc)
            messagebox.showerror(
                "No se pudo guardar",
                f"setx falló al escribir la variable de máquina.\n\nDetalles: {exc}",
                parent=self,
            )
            self._emit_log("No se pudo aplicar la API key (setx falló).")
            return
        self._emit_log("API key aplicada (USB_MONITOR_API_KEY); reinicia el servicio para usarla.")
        messagebox.showinfo(
            "API key guardada",
            "La clave quedó guardada. Reinicia el servicio para que la use.",
            parent=self,
        )
        self.destroy()


def launch_api_key_configurator(
    parent: tk.Misc,
    *,
    on_log: Optional[Callable[[str], None]] = None,
) -> None:
    if not is_user_admin():
        messagebox.showerror(
            "Permisos requeridos",
            "Ejecuta esta herramienta como administrador para escribir variables de entorno de sistema.",
            parent=parent,
        )
        if on_log:
            on_log("No se pudo abrir el configurador de API key: se requieren privilegios de administrador.")
        return
    dialog = ApiKeyConfiguratorDialog(parent, on_log=on_log)
    dialog.wait_visibility()


def run_gui() -> None:
    root = tk.Tk()
    root.title("USB Monitor Service")
    root.resizable(False, False)

    # --- Sistema visual: neutros azulados y acero, como el panel web ---
    # Los estilos por defecto (TFrame/TLabel/TButton/TEntry/Treeview) los
    # hereda también el configurador de API key, que cuelga de esta raíz.
    try:
        estilo = ttk.Style(root)
        if "clam" in estilo.theme_names():
            estilo.theme_use("clam")
        estilo.configure("TFrame", background="#F7F9FB")
        estilo.configure(
            "TLabel",
            background="#F7F9FB",
            foreground="#1B2330",
            font=("Segoe UI", 10),
        )
        estilo.configure(
            "TButton",
            background="#E4EAF1",
            foreground="#1B2330",
            bordercolor="#C2CEDC",
            focusthickness=0,
            padding=(12, 7),
            font=("Segoe UI", 10),
        )
        estilo.map(
            "TButton",
            background=[("active", "#C2CEDC"), ("disabled", "#F7F9FB")],
            foreground=[("disabled", "#5B6B7F")],
        )
        estilo.configure(
            "Accent.TButton",
            background="#486581",
            foreground="#EDF0F4",
            font=("Segoe UI", 10, "bold"),
        )
        estilo.map(
            "Accent.TButton",
            background=[("active", "#57748F"), ("disabled", "#E4EAF1")],
            foreground=[("active", "#EDF0F4"), ("disabled", "#5B6B7F")],
        )
        estilo.configure(
            "TEntry",
            fieldbackground="#F7F9FB",
            foreground="#1B2330",
            bordercolor="#C2CEDC",
            padding=6,
        )
        estilo.configure(
            "Treeview",
            background="#F7F9FB",
            fieldbackground="#F7F9FB",
            foreground="#1B2330",
            bordercolor="#C2CEDC",
            rowheight=24,
            font=("Segoe UI", 9),
        )
        estilo.configure(
            "Treeview.Heading",
            background="#E4EAF1",
            foreground="#5B6B7F",
            font=("Segoe UI", 9, "bold"),
        )
        estilo.map(
            "Treeview",
            background=[("selected", "#486581")],
            foreground=[("selected", "#EDF0F4")],
        )
        estilo.configure(
            "TScrollbar",
            background="#E4EAF1",
            troughcolor="#EDF0F4",
            bordercolor="#C2CEDC",
            arrowcolor="#5B6B7F",
        )
        estilo.configure(
            "TCheckbutton", background="#F7F9FB", foreground="#1B2330"
        )
        root.configure(bg="#EDF0F4")
    except tk.TclError:
        LOGGER.debug("No se pudieron aplicar los estilos Herencia", exc_info=True)

    icon_path = get_app_directory() / "usb_monitor_service.ico"
    if icon_path.exists():
        try:
            root.iconbitmap(default=str(icon_path))
        except Exception as exc:
            LOGGER.debug("No se pudo establecer el icono de la app: %s", exc)

    root.columnconfigure(0, weight=1)
    root.rowconfigure(0, weight=1)

    container = ttk.Frame(root, padding=20)
    container.grid(row=0, column=0, sticky="nsew")
    container.columnconfigure(0, weight=1)
    container.columnconfigure(1, weight=1)
    container.rowconfigure(3, weight=1)

    status_var = tk.StringVar()
    status_label = ttk.Label(container, textvariable=status_var, font=("Segoe UI", 11, "bold"))
    status_label.grid(row=0, column=0, columnspan=2, sticky="w", pady=(0, 2))

    # Variable para mostrar el estado del inicio automático
    autostart_status_var = tk.StringVar()
    autostart_status_label = ttk.Label(
        container,
        textvariable=autostart_status_var,
        font=("Segoe UI", 9),
        foreground="#5B6B7F",
    )
    autostart_status_label.grid(row=1, column=0, columnspan=2, sticky="w")

    # Estado de esquema y SSL verify junto a "Inicio automático"
    scheme_status_var = tk.StringVar()
    ssl_status_var = tk.StringVar()

    scheme_ssl_frame = ttk.Frame(container)
    scheme_ssl_frame.grid(row=2, column=0, columnspan=2, sticky="w", pady=(2, 6))

    scheme_status_label = ttk.Label(
        scheme_ssl_frame,
        textvariable=scheme_status_var,
        font=("Segoe UI", 9),
        foreground="#5B6B7F",
        wraplength=360,
    )
    scheme_status_label.pack(anchor="w")

    ssl_status_label = ttk.Label(
        scheme_ssl_frame,
        textvariable=ssl_status_var,
        font=("Segoe UI", 9),
        foreground="#5B6B7F",
        wraplength=360,
    )
    ssl_status_label.pack(anchor="w")

    info_label = ttk.Label(
        container,
        text="Ejecuta esta herramienta como administrador para instalar o controlar el servicio.",
        wraplength=360,
        foreground="#5B6B7F",
    )
    info_label.grid(row=3, column=0, columnspan=2, pady=(6, 10), sticky="w")

    log_box = ScrolledText(
        container,
        height=8,
        width=52,
        state="disabled",
        wrap="word",
        background="#F7F9FB",
        foreground="#1B2330",
        insertbackground="#1B2330",
        selectbackground="#5F7CA6",
        selectforeground="#F7F9FB",
        relief="flat",
        borderwidth=1,
        highlightthickness=1,
        highlightbackground="#C2CEDC",
        highlightcolor="#5F7CA6",
        font=("Segoe UI", 9),
    )
    log_box.grid(row=3, column=0, columnspan=2, pady=(0, 12), sticky="nsew")

    command_buttons: list[ttk.Button] = []

    def append_log(text: str) -> None:
        timestamp = time.strftime("%H:%M:%S")
        log_box.configure(state="normal")
        log_box.insert("end", f"[{timestamp}] {text}\n")
        log_box.see("end")
        log_box.configure(state="disabled")
        LOGGER.info("GUI: %s", text)

    def set_buttons_state(state: str) -> None:
        for btn in command_buttons:
            btn.configure(state=state)

    def update_status() -> None:
        state, description = _query_service_state()
        status_var.set(f"Estado del servicio: {description}")
        if state == win32service.SERVICE_RUNNING:
            status_label.configure(foreground="#3E6B4F")
        elif state == win32service.SERVICE_STOPPED:
            status_label.configure(foreground="#8C3B2E")
        elif state is None:
            status_label.configure(foreground="#8C3B2E")
        else:
            status_label.configure(foreground="#68809B")
        
        # Actualizar estado del inicio automático
        success, start_type = _get_service_autostart_status()
        if success and start_type is not None:
            if start_type == win32service.SERVICE_AUTO_START:
                autostart_status_var.set("Inicio automático: ✓ Activado")
            elif start_type == win32service.SERVICE_DEMAND_START:
                autostart_status_var.set("Inicio automático: ✗ Desactivado (Manual)")
            else:
                autostart_status_var.set(f"Inicio automático: Tipo {start_type}")
        else:
            autostart_status_var.set("Inicio automático: Estado desconocido")

        # Actualizar esquema y verificación SSL
        scheme = os.environ.get("USB_MONITOR_SERVER_SCHEME", "http").lower()
        scheme_status_var.set(f"Esquema del backend: {scheme.upper()}")
        cert_path = os.environ.get("USB_MONITOR_SSL_CERT", "").strip()
        verify_env = os.environ.get("USB_MONITOR_SSL_VERIFY", "true").lower()
        if cert_path and Path(cert_path).exists():
            ssl_status_var.set(f"Verificación SSL: CA personalizada ({cert_path})")
        else:
            ssl_status_var.set("Verificación SSL: Activada" if verify_env != "false" else "Verificación SSL: Desactivada")

    def finish_command(success: bool, message: str) -> None:
        set_buttons_state("normal")
        append_log(message)
        update_status()
        if not success:
            messagebox.showerror("USB Monitor Service", message, parent=root)
            LOGGER.error("GUI: comando finalizado con error - %s", message)
        else:
            LOGGER.info("GUI: comando finalizado correctamente - %s", message)

    def run_command_async(command: str) -> None:
        def worker() -> None:
            success, message = _execute_service_command(command)
            root.after(0, lambda: finish_command(success, message))

        append_log(f"Ejecutando '{command}'...")
        LOGGER.info("GUI: se solicitó ejecución del comando '%s'", command)
        set_buttons_state("disabled")
        threading.Thread(target=worker, daemon=True).start()

    def configure_autostart_async() -> None:
        def worker() -> None:
            success, message = _toggle_service_autostart()
            root.after(0, lambda: finish_command(success, message))

        append_log("Alternando configuración de inicio automático...")
        LOGGER.info("GUI: se solicitó alternar inicio automático")
        set_buttons_state("disabled")
        threading.Thread(target=worker, daemon=True).start()

    def configure_server_host() -> None:
        current_host = os.environ.get("USB_MONITOR_SERVER_HOST", get_server_host())
        prompt = "Ingresa la nueva dirección IP o hostname del servidor backend:"
        new_host = simpledialog.askstring(
            "Configurar IP del servidor",
            prompt,
            initialvalue=current_host,
            parent=root,
        )
        if new_host is None:
            return

        value = new_host.strip()
        if not value:
            messagebox.showerror(
                "Valor inválido",
                "Debes ingresar una IP o hostname válido.",
                parent=root,
            )
            return

        def worker() -> None:
            success, message = _set_server_host(value)
            root.after(0, lambda: finish_command(success, message))

        append_log(f"Actualizando IP del servidor a '{value}'...")
        LOGGER.info("GUI: se solicitó actualizar USB_MONITOR_SERVER_HOST a %s", value)
        set_buttons_state("disabled")
        threading.Thread(target=worker, daemon=True).start()

    def configure_server_scheme_async() -> None:
        def worker() -> None:
            success, message = _toggle_server_scheme()
            root.after(0, lambda: finish_command(success, message))

        append_log("Alternando esquema HTTP/HTTPS...")
        LOGGER.info("GUI: se solicitó alternar USB_MONITOR_SERVER_SCHEME")
        set_buttons_state("disabled")
        threading.Thread(target=worker, daemon=True).start()

    def configure_ssl_verify_async() -> None:
        def worker() -> None:
            success, message = _toggle_ssl_verify()
            root.after(0, lambda: finish_command(success, message))

        append_log("Alternando verificación SSL...")
        LOGGER.info("GUI: se solicitó alternar USB_MONITOR_SSL_VERIFY")
        set_buttons_state("disabled")
        threading.Thread(target=worker, daemon=True).start()

    def open_api_key_configurator_dialog() -> None:
        append_log("Abriendo configurador de API key...")
        try:
            launch_api_key_configurator(root, on_log=append_log)
        except Exception as exc:  # pragma: no cover - errores inesperados de GUI
            LOGGER.error("GUI: error al abrir configurador de API key: %s", exc, exc_info=True)
            messagebox.showerror(
                "USB Monitor Service",
                f"No se pudo abrir el configurador de API key.\n\nDetalles: {exc}",
                parent=root,
            )

    commands = [
        ("Instalar servicio", "install"),
        ("Iniciar servicio", "start"),
        ("Detener servicio", "stop"),
        ("Desinstalar servicio", "remove"),
    ]

    for idx, (label, command) in enumerate(commands):
        row = 4 + idx // 2
        column = idx % 2
        btn = ttk.Button(container, text=label, command=lambda c=command: run_command_async(c))
        btn.grid(row=row, column=column, padx=4, pady=4, sticky="ew")
        command_buttons.append(btn)

    autostart_button = ttk.Button(
        container,
        text="Alternar inicio automático",
        command=configure_autostart_async,
    )
    autostart_button.grid(row=6, column=0, columnspan=2, padx=4, pady=(8, 0), sticky="ew")
    command_buttons.append(autostart_button)

    server_host_button = ttk.Button(
        container,
        text="Configurar IP del servidor",
        command=configure_server_host,
    )
    server_host_button.grid(row=7, column=0, columnspan=2, padx=4, pady=(8, 0), sticky="ew")
    command_buttons.append(server_host_button)

    api_key_button = ttk.Button(
        container,
        text="Configurar API key del backend",
        command=open_api_key_configurator_dialog,
    )
    api_key_button.grid(row=8, column=0, columnspan=2, padx=4, pady=(8, 0), sticky="ew")
    command_buttons.append(api_key_button)

    scheme_button = ttk.Button(
        container,
        text="Alternar HTTP/HTTPS",
        command=configure_server_scheme_async,
    )
    scheme_button.grid(row=12, column=0, columnspan=2, padx=4, pady=(8, 0), sticky="ew")
    command_buttons.append(scheme_button)

    ssl_button = ttk.Button(
        container,
        text="Alternar verificación SSL",
        command=configure_ssl_verify_async,
    )
    ssl_button.grid(row=13, column=0, columnspan=2, padx=4, pady=(8, 0), sticky="ew")
    command_buttons.append(ssl_button)

    refresh_button = ttk.Button(
        container, text="Actualizar estado", command=update_status, style="Accent.TButton"
    )
    refresh_button.grid(row=9, column=0, columnspan=2, pady=(8, 0), sticky="ew")

    append_log("Interfaz iniciada.")
    update_status()

    def periodic_status_refresh() -> None:
        update_status()
        root.after(5000, periodic_status_refresh)

    root.after(5000, periodic_status_refresh)

    root.mainloop()

if __name__ == "__main__":
    run_gui()
