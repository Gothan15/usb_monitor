"""USB Monitor - Proceso compañero (petición de contraseña).

El servicio USBMonitorService corre en la sesión 0 de Windows y no puede
mostrar ventanas. Este proceso ligero corre en segundo plano dentro de la
sesión del usuario (lo arranca la tarea programada "USBMonitorPrompt" al
iniciar sesión y el servicio lo relanza si se cierra) y hace una sola
cosa: cuando el servicio bloquea un dispositivo USB, mostrar la ventana
que pide la contraseña del dueño de la PC (o del admin) y enviarla
directo al servidor para su verificación.

Reglas de seguridad:
    - Esta ventana NO decide nada: la contraseña se verifica en el
      servidor (POST /api/usb-auth) y es el servicio quien desbloquea el
      dispositivo tras confirmarlo con el servidor por su propio polling.
    - Cerrar esta ventana no desbloquea nada: el bloqueo lo mantiene el
      servicio.
    - La contraseña solo viaja al servidor; nunca se guarda en disco.

Comunicación con el servicio: el registro local que el servicio escribe
en C:\\ProgramData\\USBMonitor\\pending_local.json (este proceso no lee
browser_signal.json: ese archivo queda como señal histórica sin
consumidor en esta fase).

Requisitos:
    pip install requests   (tkinter viene con Python)

Variables de entorno (las mismas que usa el servicio):
    USB_MONITOR_SERVER_HOST    -> host del backend (defecto 172.20.10.12)
    USB_MONITOR_SERVER_PORT    -> puerto del backend (defecto 3000)
    USB_MONITOR_SERVER_SCHEME  -> http | https (defecto https)
    USB_MONITOR_SSL_VERIFY     -> true | false (solo HTTPS)
    USB_MONITOR_SSL_CERT       -> ruta a un bundle de certificados (solo HTTPS)
"""

from __future__ import annotations

import ctypes
import json
import logging
from logging.handlers import RotatingFileHandler
import os
import queue
import socket
import threading
import webbrowser
from pathlib import Path
from typing import Any, Dict
from urllib.parse import quote

import requests
import tkinter as tk
from tkinter import ttk

# ---------------------------------------------------------------------------
# Configuración del servidor (misma lógica que usb_monitor_service.py)
# ---------------------------------------------------------------------------

DEFAULT_HOST = "localhost"  # Fase 5: antes la IP del hotspot; el instalador escribe el host real
DEFAULT_PORT = 3000

PROGRAM_DATA_DIR = Path(os.environ.get("ProgramData", "C:/ProgramData")) / "USBMonitor"
PENDING_LOCAL_FILE = (PROGRAM_DATA_DIR / "pending_local.json").resolve()

PC_NAME = (socket.gethostname() or "").strip() or "UNKNOWN_HOST"
POLL_INTERVAL_MS = 2000  # cada cuánto se revisa pending_local.json

LOGGER = logging.getLogger("usb_prompt")

# ---------------------------------------------------------------------------
# Sistema visual «Herencia» (misma paleta que el panel web)
# ---------------------------------------------------------------------------

HERENCIA = {
    "fondo": "#EDF0F4",
    "panel": "#F7F9FB",
    "superficie": "#E4EAF1",
    "borde": "#C2CEDC",
    "laton": "#5F7CA6",
    "texto": "#1B2330",
    "suave": "#5B6B7F",
    "verde": "#486581",
    "verde_activo": "#57748F",
    "exito": "#3E6B4F",
    "aviso": "#68809B",
    "peligro": "#8C3B2E",
}


def aplicar_estilos_herencia(root: tk.Misc) -> None:
    """Configura los estilos ttk (tema clam) con la paleta Herencia."""
    try:
        style = ttk.Style(root)
        if "clam" in style.theme_names():
            style.theme_use("clam")
        style.configure("Fondo.TFrame", background=HERENCIA["fondo"])
        style.configure("Herencia.TFrame", background=HERENCIA["panel"])
        style.configure(
            "Titulo.TLabel",
            background=HERENCIA["panel"],
            foreground=HERENCIA["texto"],
            font=("Georgia", 15, "bold"),
        )
        style.configure(
            "Suave.TLabel",
            background=HERENCIA["panel"],
            foreground=HERENCIA["suave"],
            font=("Segoe UI", 10),
        )
        style.configure(
            "Campo.TLabel",
            background=HERENCIA["panel"],
            foreground=HERENCIA["texto"],
            font=("Segoe UI", 10, "bold"),
        )
        style.configure(
            "Estado.TLabel",
            background=HERENCIA["panel"],
            foreground=HERENCIA["peligro"],
            font=("Segoe UI", 10),
        )
        style.configure(
            "Info.TLabel",
            background=HERENCIA["panel"],
            foreground=HERENCIA["laton"],
            font=("Segoe UI", 10),
        )
        style.configure(
            "Exito.TLabel",
            background=HERENCIA["panel"],
            foreground=HERENCIA["exito"],
            font=("Segoe UI", 10, "bold"),
        )
        style.configure(
            "Principal.TButton",
            background=HERENCIA["verde"],
            foreground=HERENCIA["fondo"],
            font=("Segoe UI", 11, "bold"),
            padding=(20, 10),
            borderwidth=0,
            focusthickness=0,
        )
        style.map(
            "Principal.TButton",
            background=[
                ("active", HERENCIA["verde_activo"]),
                ("disabled", HERENCIA["superficie"]),
            ],
            foreground=[
                ("active", HERENCIA["fondo"]),
                ("disabled", HERENCIA["suave"]),
            ],
        )
        style.configure(
            "Secundario.TButton",
            background=HERENCIA["superficie"],
            foreground=HERENCIA["texto"],
            font=("Segoe UI", 10),
            padding=(16, 9),
            borderwidth=0,
            focusthickness=0,
        )
        style.map(
            "Secundario.TButton",
            background=[("active", HERENCIA["borde"])],
        )
        style.configure(
            "Herencia.TEntry",
            fieldbackground=HERENCIA["panel"],
            foreground=HERENCIA["texto"],
            bordercolor=HERENCIA["borde"],
            lightcolor=HERENCIA["borde"],
            darkcolor=HERENCIA["borde"],
            padding=9,
            font=("Segoe UI", 10),
        )
        style.map(
            "Herencia.TEntry",
            bordercolor=[("focus", HERENCIA["laton"])],
        )
        style.configure(
            "Herencia.TCheckbutton",
            background=HERENCIA["panel"],
            foreground=HERENCIA["suave"],
            font=("Segoe UI", 10),
        )
        style.map(
            "Herencia.TCheckbutton",
            foreground=[("active", HERENCIA["texto"])],
        )
    except tk.TclError:
        LOGGER.debug("No se pudieron aplicar los estilos Herencia", exc_info=True)


def get_server_host() -> str:
    return os.environ.get("USB_MONITOR_SERVER_HOST", DEFAULT_HOST)


def get_server_port() -> int:
    try:
        return int(os.environ.get("USB_MONITOR_SERVER_PORT", str(DEFAULT_PORT)))
    except ValueError:
        return DEFAULT_PORT


def build_url(endpoint: str) -> str:
    """Réplica de build_url del servicio (esquema http/https por entorno)."""
    scheme = (os.environ.get("USB_MONITOR_SERVER_SCHEME", "http") or "").lower().strip()
    if scheme not in ("http", "https"):
        scheme = "https"
    return f"{scheme}://{get_server_host()}:{get_server_port()}{endpoint}"


def get_requests_verify() -> Any:
    """Réplica simplificada de la verificación TLS del servicio."""
    scheme = (os.environ.get("USB_MONITOR_SERVER_SCHEME", "http") or "").lower().strip()
    if scheme == "http":
        return True
    cert_path = os.environ.get("USB_MONITOR_SSL_CERT", "").strip()
    if cert_path:
        p = Path(cert_path)
        if p.exists() and p.is_file():
            return str(p)
    return os.environ.get("USB_MONITOR_SSL_VERIFY", "true").lower() != "false"


# ---------------------------------------------------------------------------
# Registro local de pendientes (lo escribe el servicio)
# ---------------------------------------------------------------------------

def load_local_pendings() -> list:
    """Lee pending_local.json. Tolerante a fallos (archivo a medias, etc.)."""
    try:
        if not PENDING_LOCAL_FILE.exists():
            return []
        data = json.loads(PENDING_LOCAL_FILE.read_text(encoding="utf-8"))
        return data if isinstance(data, list) else []
    except Exception:
        return []


def mark_local_pending_unlocked(drive_letter: str, serial: Any = None) -> None:
    """Marca una entrada como UNLOCKED releyendo el archivo antes de escribir.

    El servicio también actualiza el mismo archivo por su polling; por eso
    se relee justo antes de escribir, para no pisar sus cambios.
    """
    try:
        pendings = load_local_pendings()
        drive = (drive_letter or "").upper()
        changed = False
        for pending in pendings:
            entry_drive = str(pending.get("driveLetter") or "").upper()
            # Sin letra (móvil WPD): se casa por serial.
            coincide = (
                entry_drive == drive
                if entry_drive
                else bool(serial) and str(pending.get("serialNumber") or "") == str(serial)
            )
            if coincide and pending.get("status") == "BLOCKED":
                pending["status"] = "UNLOCKED"
                changed = True
        if changed:
            PENDING_LOCAL_FILE.write_text(
                json.dumps(pendings, indent=2, ensure_ascii=False), encoding="utf-8"
            )
    except Exception as exc:  # nunca debe romper la ventana
        LOGGER.warning("No se pudo actualizar pending_local.json: %s", exc)


# ---------------------------------------------------------------------------
# Verificación de la contraseña contra el servidor
# ---------------------------------------------------------------------------

def request_unlock(username: str, password: str, pending: Dict[str, Any]) -> str:
    """POST /api/usb-auth. Devuelve 'ok', 'denied', 'forbidden' o 'network_error'."""
    payload = {
        "username": username,
        "password": password,
        "pcName": PC_NAME,
        "serialNumber": pending.get("serialNumber"),
        "driveLetter": pending.get("driveLetter"),
    }
    try:
        response = requests.post(
            build_url("/api/usb-auth"),
            json=payload,
            timeout=10,
            verify=get_requests_verify(),
        )
    except requests.RequestException as exc:
        LOGGER.warning("Sin conexión con el servidor: %s", exc)
        return "network_error"
    if response.status_code == 200:
        return "ok"
    if response.status_code == 401:
        return "denied"
    if response.status_code == 403:
        # Prohibido de verdad (la contraseña no es del dueño ni de un
        # administrador, o el dispositivo no está en la lista blanca):
        # NO es un fallo de red y no debe ofrecer la página de emergencia
        # como si lo fuera (Fase 0).
        return "forbidden"
    LOGGER.warning("Respuesta inesperada del servidor: %s", response.status_code)
    return "network_error"


# ---------------------------------------------------------------------------
# Ventana de contraseña (una por dispositivo bloqueado)
# ---------------------------------------------------------------------------

class UnlockWindow:
    def __init__(self, app: "PromptApp", pending: Dict[str, Any]) -> None:
        self.app = app
        self.pending = pending
        self.drive_letter = str(pending.get("driveLetter") or "")
        self.serial = pending.get("serialNumber")
        self.key = (
            self.drive_letter.upper(),
            str(self.serial or ""),
            str(pending.get("createdAt") or ""),
        )
        self.closed = False

        win = tk.Toplevel(app.root)
        self.win = win
        win.title("USB bloqueado — se requiere contraseña")
        win.resizable(False, False)
        win.protocol("WM_DELETE_WINDOW", self.close)
        # Cerrar la ventana no desbloquea nada: el bloqueo es del servicio.
        win.attributes("-topmost", True)
        win.configure(bg=HERENCIA["fondo"])

        outer = ttk.Frame(win, padding=12, style="Fondo.TFrame")
        outer.grid(sticky="nsew")
        frame = ttk.Frame(outer, padding=26, style="Herencia.TFrame")
        frame.grid(sticky="nsew")

        known = bool(pending.get("whitelisted"))
        device_label = pending.get("deviceLabel") or "Dispositivo USB"

        header = ttk.Frame(frame, style="Herencia.TFrame")
        header.grid(row=0, column=0, columnspan=2, sticky="w")
        tk.Label(
            header,
            text="●",
            bg=HERENCIA["panel"],
            fg=HERENCIA["verde"] if known else HERENCIA["peligro"],
            font=("Segoe UI", 13),
        ).pack(side="left")
        ttk.Label(
            header,
            text=(
                f"Unidad {self.drive_letter} bloqueada"
                if self.drive_letter
                else f"{device_label} bloqueado"
            ),
            style="Titulo.TLabel",
        ).pack(side="left", padx=(9, 0))

        if not known:
            # Fuera de la whitelist NO hay contraseña que valga: el
            # dispositivo queda bloqueado y solo se muestra el cartel.
            win.title("USB no autorizado")
            ttk.Label(
                frame,
                text=(
                    f"{device_label}\n"
                    f"Serial: {self.serial or 'sin serial'}\n"
                    "USB no listado en la lista blanca: será bloqueado.\n"
                    "Este dispositivo no se puede usar en esta PC.\n"
                    "Si debería estar autorizado, el administrador debe\n"
                    "añadirlo a la lista blanca desde el panel."
                ),
                justify="left",
                style="Suave.TLabel",
                wraplength=420,
            ).grid(row=1, column=0, columnspan=2, sticky="w", pady=(10, 18))
            ttk.Button(
                frame, text="Entendido", command=self.close, style="Principal.TButton"
            ).grid(row=2, column=0, columnspan=2, sticky="e")
            return

        ttk.Label(
            frame,
            text=(
                f"{device_label}\n"
                f"Serial: {self.serial or 'sin serial'}\n"
                "Dispositivo conocido (en la lista autorizada)."
                "\nPara usarlo en esta PC, introduce la contraseña del"
                "\nusuario dueño de esta computadora o la del administrador."
            ),
            justify="left",
            style="Suave.TLabel",
            wraplength=420,
        ).grid(row=1, column=0, columnspan=2, sticky="w", pady=(10, 16))

        ttk.Label(frame, text="Usuario:", style="Campo.TLabel").grid(
            row=2, column=0, sticky="w", pady=5
        )
        self.username_var = tk.StringVar()
        self.username_entry = ttk.Entry(
            frame, textvariable=self.username_var, width=36, style="Herencia.TEntry"
        )
        self.username_entry.grid(row=2, column=1, sticky="ew", pady=5, padx=(12, 0))

        ttk.Label(frame, text="Contraseña:", style="Campo.TLabel").grid(
            row=3, column=0, sticky="w", pady=5
        )
        self.password_var = tk.StringVar()
        self.password_entry = ttk.Entry(
            frame,
            textvariable=self.password_var,
            width=36,
            show="•",
            style="Herencia.TEntry",
        )
        self.password_entry.grid(row=3, column=1, sticky="ew", pady=5, padx=(12, 0))

        self.show_password_var = tk.BooleanVar(value=False)
        ttk.Checkbutton(
            frame,
            text="Mostrar contraseña",
            variable=self.show_password_var,
            command=self._toggle_password,
            style="Herencia.TCheckbutton",
        ).grid(row=4, column=1, sticky="w", padx=(12, 0), pady=(4, 0))

        self.status_var = tk.StringVar(value="")
        self.status_label = ttk.Label(
            frame, textvariable=self.status_var, style="Estado.TLabel", wraplength=420
        )
        self.status_label.grid(row=5, column=0, columnspan=2, sticky="w", pady=(12, 0))

        buttons = ttk.Frame(frame, style="Herencia.TFrame")
        buttons.grid(row=6, column=0, columnspan=2, sticky="e", pady=(18, 0))
        ttk.Button(
            buttons,
            text="Abrir página de desbloqueo",
            command=self.open_web_page,
            style="Secundario.TButton",
        ).pack(side="left", padx=(0, 10))
        self.unlock_button = ttk.Button(
            buttons, text="Desbloquear", command=self.submit, style="Principal.TButton"
        )
        self.unlock_button.pack(side="left")
        # Botón de emergencia sin red: oculto salvo que el envío de la
        # contraseña falle por falta de conexión (ver handle_result).
        self.buttons_frame = buttons
        self.emergency_button = None

        win.bind("<Return>", lambda _event: self.submit())
        self.username_entry.focus_set()

    def _toggle_password(self) -> None:
        self.password_entry.configure(show="" if self.show_password_var.get() else "•")

    def open_web_page(self) -> None:
        """Abre la página de respaldo /desbloquear del panel en el navegador."""
        url = build_url(
            "/desbloquear?pc={}&drive={}&serial={}".format(
                quote(PC_NAME, safe=""),
                quote(self.drive_letter, safe=""),
                quote(str(self.serial or ""), safe=""),
            )
        )
        try:
            webbrowser.open(url)
        except Exception as exc:
            LOGGER.warning("No se pudo abrir el navegador: %s", exc)
            self.status_var.set("No se pudo abrir el navegador.")

    def open_local_emergency(self) -> None:
        """Abre la página local de emergencia del servicio (:5001).

        Es el respaldo sin red: el propio servicio verifica la
        contraseña contra el hash cacheado del dueño en esa página.
        """
        try:
            port = int(os.environ.get("USB_MONITOR_LISTEN_PORT", "5001"))
        except ValueError:
            port = 5001
        try:
            webbrowser.open(f"http://127.0.0.1:{port}/desbloquear")
        except Exception as exc:
            LOGGER.warning("No se pudo abrir el navegador: %s", exc)
            self.status_var.set("No se pudo abrir el navegador.")

    def submit(self) -> None:
        username = self.username_var.get().strip()
        password = self.password_var.get()
        if not username or not password:
            self.status_label.configure(style="Estado.TLabel")
            self.status_var.set("Escribe tu usuario y tu contraseña.")
            return
        self.unlock_button.configure(state="disabled")
        self.status_label.configure(style="Info.TLabel")
        self.status_var.set("Verificando con el servidor…")
        # La petición va en un hilo para no congelar la ventana; el
        # resultado vuelve a la interfaz por la cola de la aplicación.
        threading.Thread(
            target=self._submit_worker,
            args=(username, password),
            daemon=True,
        ).start()

    def _submit_worker(self, username: str, password: str) -> None:
        result = request_unlock(username, password, self.pending)
        self.app.results.put((self, result))

    def handle_result(self, result: str) -> None:
        if self.closed:
            return
        if result == "ok":
            # El servicio liberará la unidad al confirmarlo por su polling;
            # aquí solo se refleja en el registro local y se avisa.
            mark_local_pending_unlocked(self.drive_letter, self.serial)
            self.status_label.configure(style="Exito.TLabel")
            self.status_var.set("Contraseña aceptada. Desbloqueando el dispositivo…")
            self.win.after(2500, self.close)
        elif result == "denied":
            self.status_label.configure(style="Estado.TLabel")
            self.status_var.set("No autorizado. Revisa el usuario y la contraseña.")
            self.password_var.set("")
            self.unlock_button.configure(state="normal")
            self.password_entry.focus_set()
        elif result == "forbidden":
            self.status_label.configure(style="Estado.TLabel")
            self.status_var.set(
                "Esa contraseña no es la del dueño de este equipo ni la de un administrador."
            )
            self.password_var.set("")
            self.unlock_button.configure(state="normal")
            self.password_entry.focus_set()
        else:  # network_error
            self.status_label.configure(style="Estado.TLabel")
            self.status_var.set(
                "Sin conexión con el servidor. El dispositivo sigue bloqueado."
            )
            self.unlock_button.configure(state="normal")
            # Sin red queda un último recurso: la página local de
            # emergencia que sirve el propio servicio en esta PC.
            if self.emergency_button is None:
                self.emergency_button = ttk.Button(
                    self.buttons_frame,
                    text="Usar página local de emergencia",
                    command=self.open_local_emergency,
                    style="Secundario.TButton",
                )
                self.emergency_button.pack(
                    side="left", padx=(0, 8), before=self.unlock_button
                )

    def notify_unlocked_externally(self) -> None:
        """El registro local ya marca UNLOCKED (lo hizo el servicio)."""
        if self.closed:
            return
        self.status_label.configure(style="Exito.TLabel")
        self.status_var.set("Dispositivo desbloqueado.")
        self.win.after(2000, self.close)

    def close(self) -> None:
        if self.closed:
            return
        self.closed = True
        try:
            self.win.destroy()
        except tk.TclError:
            pass
        self.app.forget_window(self)


# ---------------------------------------------------------------------------
# Aplicación: vigila el registro local y abre ventanas cuando toca
# ---------------------------------------------------------------------------

class PromptApp:
    def __init__(self) -> None:
        self.root = tk.Tk()
        self.root.withdraw()  # sin ventana principal: solo ventanas por bloqueo
        self.root.title("USB Monitor — compañero")
        self.root.configure(bg=HERENCIA["fondo"])
        aplicar_estilos_herencia(self.root)
        self.results: "queue.Queue" = queue.Queue()
        self.windows: Dict[tuple, UnlockWindow] = {}
        # Claves ya mostradas (o descartadas por el usuario): no se reabre
        # la misma ventana una y otra vez por el mismo bloqueo.
        self.handled_keys: set = set()

    def forget_window(self, window: UnlockWindow) -> None:
        self.windows.pop(window.key, None)

    def _drain_results(self) -> None:
        try:
            while True:
                window, result = self.results.get_nowait()
                window.handle_result(result)
        except queue.Empty:
            pass

    def _tick(self) -> None:
        self._drain_results()
        for pending in load_local_pendings():
            if not isinstance(pending, dict):
                continue
            drive = str(pending.get("driveLetter") or "").upper()
            serial = str(pending.get("serialNumber") or "")
            if not drive and not serial:
                continue
            # Sin letra (móvil WPD), la identidad es el serial.
            key = (
                drive or f"SER:{serial}",
                serial,
                str(pending.get("createdAt") or ""),
            )
            status = pending.get("status")
            if status == "BLOCKED" and key not in self.handled_keys:
                self.handled_keys.add(key)
                if key not in self.windows:
                    self.windows[key] = UnlockWindow(self, pending)
            elif status == "UNLOCKED" and key in self.windows:
                self.windows[key].notify_unlocked_externally()
        self.root.after(POLL_INTERVAL_MS, self._tick)

    def run(self) -> None:
        self.root.after(300, self._tick)
        self.root.mainloop()


def _acquire_single_instance() -> bool:
    """Evita dos compañeros a la vez (tarea programada + clave Run, etc.)."""
    try:
        kernel32 = ctypes.windll.kernel32  # type: ignore[attr-defined]
        kernel32.CreateMutexW(None, False, "USBMonitorPrompt_SingleInstance")
        return kernel32.GetLastError() != 183  # 183 = ERROR_ALREADY_EXISTS
    except Exception:
        return True  # si no se puede comprobar, se sigue igualmente


def _configure_logging() -> None:
    try:
        PROGRAM_DATA_DIR.mkdir(parents=True, exist_ok=True)
        # Fase 3: con rotación (antes usb_prompt.log crecía sin límite).
        logging.basicConfig(
            handlers=[
                RotatingFileHandler(
                    str(PROGRAM_DATA_DIR / "usb_prompt.log"),
                    maxBytes=2_000_000,
                    backupCount=3,
                    encoding="utf-8",
                )
            ],
            level=logging.INFO,
            format="%(asctime)s [%(levelname)s] %(message)s",
        )
    except Exception:
        logging.basicConfig(level=logging.INFO)


def main() -> None:
    _configure_logging()
    if not _acquire_single_instance():
        LOGGER.info("Ya hay un compañero en ejecución; saliendo")
        return
    LOGGER.info("Compañero USB Monitor iniciado en %s", PC_NAME)
    PromptApp().run()


if __name__ == "__main__":
    main()
