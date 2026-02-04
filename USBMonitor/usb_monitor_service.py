"""USB Monitor Windows Service

Este script implementa un servicio de Windows que detecta la conexión de unidades
USB, envía una notificación HTTP POST al backend de Monitor_USB y establece la
unidad detectada en modo solo lectura mediante `diskpart`.

Requisitos:
    pip install pywin32 wmi requests

Uso:
    python usb_monitor_service.py install   # Instala el servicio
    python usb_monitor_service.py start     # Inicia el servicio
    python usb_monitor_service.py stop      # Detiene el servicio
    python usb_monitor_service.py remove    # Elimina el servicio
    python usb_monitor_service.py debug     # Ejecuta en modo consola (debug)

Variables de entorno opcionales:
    USB_MONITOR_SERVER_HOST  -> host del backend (por defecto 172.20.10.12)
    USB_MONITOR_SERVER_PORT  -> puerto del backend (por defecto 3000)
    USB_MONITOR_ENDPOINT     -> ruta del endpoint (por defecto /api/usb-event)
    USB_MONITOR_LOG_PATH     -> ruta del archivo de log

"""
from __future__ import annotations

import ctypes
import getpass
import json
import logging
import os
import re
import socket
import subprocess
import sys
import tempfile
import threading
import time
from concurrent.futures import Future
from queue import Queue, Full
from contextlib import redirect_stderr, redirect_stdout
from http.server import BaseHTTPRequestHandler, HTTPServer
from pathlib import Path
from typing import Any, Callable, Dict, List, Optional, Set, Tuple
from urllib.parse import urlparse, parse_qs, quote

import pythoncom  # type: ignore
import requests
import servicemanager  # type: ignore
import win32event  # type: ignore
import win32service  # type: ignore
import win32serviceutil  # type: ignore
import wmi  # type: ignore
import winerror

try:  # pragma: no cover - pywintypes siempre se instala con pywin32
    import pywintypes
except ImportError:  # pragma: no cover
    pywintypes = None  # type: ignore

import tkinter as tk
from tkinter import messagebox, simpledialog, ttk
from tkinter.scrolledtext import ScrolledText

import base64

# Importar cryptography para encriptación
try:
    from cryptography.fernet import Fernet
    from cryptography.hazmat.primitives import hashes
    from cryptography.hazmat.primitives.kdf.pbkdf2 import PBKDF2HMAC
    CRYPTOGRAPHY_AVAILABLE = True
except ImportError as e:
    CRYPTOGRAPHY_AVAILABLE = False
    Fernet = None  # type: ignore
    PBKDF2HMAC = None  # type: ignore
    hashes = None  # type: ignore

psycopg = None  # type: ignore
psycopg2 = None  # type: ignore
RealDictCursor = None  # type: ignore

try:  # pragma: no cover - dependencias opcionales
    import psycopg
    from psycopg.rows import dict_row

    DATABASE_DRIVER = "psycopg"
except ImportError:  # pragma: no cover
    try:
        import psycopg2
        from psycopg2.extras import RealDictCursor

        DATABASE_DRIVER = "psycopg2"
    except ImportError:  # pragma: no cover
        DATABASE_DRIVER = None


DEFAULT_HOST = "172.20.10.12"
DEFAULT_PORT = 3000
DEFAULT_ENDPOINT = "/api/usb-event"
PROGRAM_DATA_DIR = Path(os.environ.get("ProgramData", "C:/ProgramData")) / "USBMonitor"
LOG_FILE_NAME = "usb_monitor_service.log"
LEGACY_LOG_FILE_NAME = "usb_monitor.log"
SERVICE_API_VERSION = "1.0.0"
DATABASE_URL_ENV_VAR = "USB_MONITOR_DATABASE_URL"
DEFAULT_DATABASE_URL = "postgresql://usb_app:usbapp123@localhost:5432/monitor_usb?schema=public"

# Cache para evitar registrar advertencias duplicadas al descartar discos no USB
DISCARDED_DISK_CACHE: Set[str] = set()

RESOLVE_IP_CACHE_TTL = 300.0  # seconds
WHITELIST_POSITIVE_TTL = 300.0
WHITELIST_NEGATIVE_TTL = 60.0
UNLOCK_NEGATIVE_BACKOFF = 5.0

# Definir fallback IPv4 antes de usarlo en cachés
DEFAULT_IPV4_FALLBACK = "127.0.0.1"

_resolved_ip_cache: Dict[str, Any] = {"value": DEFAULT_IPV4_FALLBACK, "expires_at": 0.0}
_whitelist_cache: Dict[str, Tuple[float, bool, Optional[Dict[str, Any]]]] = {}
_unlock_backoff: Dict[str, Tuple[float, bool, Optional[str]]] = {}

NetworkTask = Tuple[Callable[..., Any], Tuple[Any, ...], Dict[str, Any], Optional[Future]]
NETWORK_QUEUE: "Queue[NetworkTask]" = Queue(maxsize=512)


def _start_network_worker() -> None:
    def worker() -> None:
        while True:
            func, args, kwargs, future = NETWORK_QUEUE.get()
            try:
                result = func(*args, **kwargs)
                if future is not None:
                    future.set_result(result)
            except Exception as exc:  # pragma: no cover - defensive logging
                LOGGER.error("Error en tarea de red %s: %s", getattr(func, "__name__", func), exc)
                if future is not None:
                    future.set_exception(exc)
            finally:
                NETWORK_QUEUE.task_done()

    thread = threading.Thread(target=worker, name="usb-monitor-network-worker", daemon=True)
    thread.start()


_start_network_worker()


def submit_network_task(
    func: Callable[..., Any],
    *args: Any,
    expect_result: bool = False,
    **kwargs: Any,
) -> Optional[Future]:
    future = Future() if expect_result else None
    try:
        NETWORK_QUEUE.put_nowait((func, args, kwargs, future))
    except Full:
        LOGGER.warning("Cola de red llena, ejecutando %s síncronamente", getattr(func, "__name__", func))
        try:
            result = func(*args, **kwargs)
            if future is not None:
                future.set_result(result)
        except Exception as exc:  # pragma: no cover - fallback path
            LOGGER.error("Error ejecutando %s fuera de la cola: %s", getattr(func, "__name__", func), exc)
            if future is not None:
                future.set_exception(exc)
    return future


def get_app_directory() -> Path:
    if getattr(sys, "frozen", False):
        return Path(sys.executable).resolve().parent
    return Path(__file__).resolve().parent


def get_log_file_name() -> str:
    return LOG_FILE_NAME if getattr(sys, "frozen", False) else LEGACY_LOG_FILE_NAME


def get_default_log_path() -> Path:
    if getattr(sys, "frozen", False):
        base_dir = get_app_directory()
    else:
        base_dir = PROGRAM_DATA_DIR
    return (base_dir / get_log_file_name()).resolve()


DEFAULT_LISTEN_PORT = 5001  # Puerto donde el servicio escuchará peticiones
SIGNAL_FILE = (PROGRAM_DATA_DIR / "browser_signal.json").resolve()
HOSTNAME_RAW = (socket.gethostname() or "").strip() or "UNKNOWN_HOST"

# Plan de telemetría (próxima iteración):
#   - Registrar latencia de `unlock_usb` midiendo `time.perf_counter()` y enviar a `/api/metrics`:
#     ```python
#     def push_metric(name: str, value: float) -> None:
#         submit_network_task(
#             requests.post,
#             build_url("/api/metrics"),
#             expect_result=False,
#             json={"name": name, "value": value},
#             headers=get_auth_headers(),
#             timeout=5,
#         )
#     ```
#   - Incluir contador de consultas whitelist/pendientes en `send_event` para comparar contra el tamaño
#     de la caché y ajustar `WHITELIST_POSITIVE_TTL` durante despliegues futuros.

CONTROL_CHARS_REGEX = re.compile(r"[\x00-\x1F\x7F]")
VALID_IPV4_REGEX = re.compile(r"^(?:\d{1,3}\.){3}\d{1,3}$")
SERIAL_ALLOWED_CHARS_REGEX = re.compile(r"[^0-9A-Za-z._-]")
SERIAL_SENTINELS = {
    "",
    "UNKNOWN",
    "UNAVAILABLE",
    "UNKNOW",
    "NONE",
    "N/A",
    "NOTAPPLICABLE",
    "NOTAVAILABLE",
}


def get_machine_identifier() -> bytes:
    """Obtiene un identificador único de la máquina para derivar la clave de encriptación."""
    try:
        # Intentar obtener el UUID de la máquina desde WMI
        pythoncom.CoInitialize()
        try:
            c = wmi.WMI()
            for item in c.Win32_ComputerSystemProduct():
                uuid = getattr(item, "UUID", None)
                if uuid:
                    return uuid.encode('utf-8')
        finally:
            pythoncom.CoUninitialize()
    except Exception:
        pass
    
    # Fallback: usar el nombre del host y el nombre del usuario
    fallback = f"{socket.gethostname()}-{os.environ.get('COMPUTERNAME', 'UNKNOWN')}"
    return fallback.encode('utf-8')


def get_encryption_key() -> bytes:
    """Genera una clave de encriptación derivada del identificador de la máquina."""
    if not CRYPTOGRAPHY_AVAILABLE:
        raise ImportError("El módulo cryptography no está disponible. Instala con: pip install cryptography")
    
    machine_id = get_machine_identifier()
    # Usar un salt fijo (en producción, esto debería ser más robusto)
    salt = b'USBMonitor_Salt_V1'
    
    kdf = PBKDF2HMAC(
        algorithm=hashes.SHA256(),
        length=32,
        salt=salt,
        iterations=100000,
    )
    key = base64.urlsafe_b64encode(kdf.derive(machine_id))
    return key


def encrypt_api_key(api_key: str) -> str:
    """Encripta una API key para almacenamiento seguro."""
    if not CRYPTOGRAPHY_AVAILABLE:
        LOGGER.warning("Cryptography no disponible, la API key no será encriptada")
        return api_key
    
    try:
        key = get_encryption_key()
        fernet = Fernet(key)
        encrypted = fernet.encrypt(api_key.encode('utf-8'))
        # Agregar un prefijo para identificar que está encriptada
        return f"ENC:{encrypted.decode('utf-8')}"
    except Exception as exc:
        LOGGER.error("Error al encriptar API key: %s", exc)
        return api_key


def decrypt_api_key(encrypted_api_key: str) -> str:
    """Desencripta una API key almacenada."""
    if not encrypted_api_key:
        return ""
    
    # Si no tiene el prefijo ENC:, asumimos que no está encriptada
    if not encrypted_api_key.startswith("ENC:"):
        return encrypted_api_key
    
    if not CRYPTOGRAPHY_AVAILABLE:
        LOGGER.warning("Cryptography no disponible, no se puede desencriptar la API key")
        return encrypted_api_key
    
    try:
        # Remover el prefijo ENC:
        encrypted_data = encrypted_api_key[4:]
        key = get_encryption_key()
        fernet = Fernet(key)
        decrypted = fernet.decrypt(encrypted_data.encode('utf-8'))
        return decrypted.decode('utf-8')
    except Exception as exc:
        LOGGER.error("Error al desencriptar API key: %s", exc)
        # Si falla la desencriptación, retornar el valor original
        return encrypted_api_key


class DatabaseConfig:
    """Almacena parámetros de conexión a la base de datos."""

    def __init__(
        self,
        user: str,
        password: str,
        host: str,
        port: int,
        database: str,
        options: Optional[str],
    ):
        self.user = user
        self.password = password
        self.host = host
        self.port = port
        self.database = database
        self.options = options


class DatabaseClient:
    """Envoltura mínima sobre psycopg/psycopg2 para listar usuarios."""

    def __init__(self, config: DatabaseConfig):
        self.config = config
        self.conn: Any = None

    def connect(self) -> None:
        if DATABASE_DRIVER is None:
            raise RuntimeError(
                "No se encontró un driver de PostgreSQL. Instala psycopg[binary] o psycopg2-binary."
            )

        connect_args: Dict[str, Any] = {
            "dbname": self.config.database,
            "user": self.config.user,
            "password": self.config.password,
            "host": self.config.host,
            "port": self.config.port,
        }
        if self.config.options:
            connect_args["options"] = self.config.options

        if DATABASE_DRIVER == "psycopg":
            if psycopg is None:
                raise RuntimeError("psycopg no está disponible.")
            self.conn = psycopg.connect(row_factory=dict_row, **connect_args)  # type: ignore[arg-type]
        elif DATABASE_DRIVER == "psycopg2":
            if psycopg2 is None:
                raise RuntimeError("psycopg2 no está disponible.")
            self.conn = psycopg2.connect(**connect_args)  # type: ignore[attr-defined]
        else:
            raise RuntimeError("Driver de base de datos desconocido.")

    def fetch_users(self) -> List[Dict[str, Any]]:
        if self.conn is None:
            raise RuntimeError("Database connection not established.")

        query = (
            'SELECT "User"."id", "User"."username", "User"."apiKey", "User"."role", '
            '"User"."createdAt", c."name" AS computer_name, c."ipAddress" AS ip_address, '
            'c."isActive" AS is_active '
            'FROM "User" LEFT JOIN "computers" c ON c."id" = "User"."computerId" '
            'ORDER BY "User"."createdAt" ASC'
        )

        rows: List[Dict[str, Any]]
        if DATABASE_DRIVER == "psycopg":
            with self.conn.cursor() as cur:  # type: ignore[call-arg]
                cur.execute(query)
                fetched = cur.fetchall()
        elif DATABASE_DRIVER == "psycopg2":
            if RealDictCursor is None:
                raise RuntimeError("psycopg2 no soporta RealDictCursor en este entorno.")
            with self.conn.cursor(cursor_factory=RealDictCursor) as cur:  # type: ignore[attr-defined]
                cur.execute(query)
                fetched = cur.fetchall()
        else:
            raise RuntimeError("No hay driver de base de datos disponible.")

        rows = []
        for record in fetched:
            row_dict = dict(record)
            rows.append(
                {
                    "id": row_dict.get("id"),
                    "username": row_dict.get("username"),
                    "apiKey": row_dict.get("apiKey"),
                    "role": row_dict.get("role"),
                    "createdAt": row_dict.get("createdAt"),
                    "computer": row_dict.get("computer_name"),
                    "ipAddress": row_dict.get("ip_address"),
                    "isActive": row_dict.get("is_active"),
                }
            )
        return rows

    def close(self) -> None:
        if self.conn is not None:
            try:
                self.conn.close()
            finally:
                self.conn = None


def run_setx(api_key: str) -> None:
    env_name = "USB_MONITOR_API_KEY"
    # Encriptar la API key antes de guardarla
    encrypted_key = encrypt_api_key(api_key)
    completed = subprocess.run(
        ["setx", env_name, encrypted_key, "/M"],
        capture_output=True,
        text=True,
        encoding='cp850',  # Codificación de consola de Windows en español
        check=True,
    )
    if completed.stdout:
        LOGGER.info("setx stdout: %s", completed.stdout.strip())
    if completed.stderr:
        LOGGER.debug("setx stderr: %s", completed.stderr.strip())


def parse_database_url(url: str) -> DatabaseConfig:
    parsed = urlparse(url)
    if parsed.scheme not in ("postgresql", "postgres"):
        raise ValueError("DATABASE_URL debe usar el esquema postgresql://")
    if not parsed.path:
        raise ValueError("DATABASE_URL no incluye el nombre de la base de datos.")
    database = parsed.path.lstrip("/")
    if not database:
        raise ValueError("DATABASE_URL no incluye el nombre de la base de datos.")

    user = parsed.username or ""
    password = parsed.password or ""
    host = parsed.hostname or "localhost"
    port = parsed.port or 5432
    params = parse_qs(parsed.query)
    schema = params.get("schema", [None])[0]
    options = f"-c search_path={schema}" if schema else None
    return DatabaseConfig(
        user=user,
        password=password,
        host=host,
        port=port,
        database=database,
        options=options,
    )


class ApiKeyConfiguratorDialog(tk.Toplevel):
    """Ventana secundaria para seleccionar y aplicar una API key."""

    def __init__(
        self,
        parent: tk.Misc,
        db_client: DatabaseClient,
        *,
        on_log: Optional[Callable[[str], None]] = None,
    ):
        super().__init__(parent)
        self.parent = parent
        self.db_client = db_client
        self.on_log = on_log
        self.users: Dict[str, Dict[str, Any]] = {}

        self.title("USB Monitor - Configurar API Key")
        self.geometry("940x520")
        self.resizable(True, True)
        self.transient(parent)

        self._build_widgets()
        self.protocol("WM_DELETE_WINDOW", self._on_close)
        self._populate_users()
        self._emit_log("Configurador de API key abierto.")
        self.grab_set()
        self.focus_set()

    def _build_widgets(self) -> None:
        header = ttk.Label(self, text="Selecciona un usuario para usar su API key.")
        header.pack(pady=(10, 5))

        columns_frame = ttk.Frame(self)
        columns_frame.pack(fill=tk.BOTH, expand=True, padx=12, pady=5)

        self.tree = ttk.Treeview(columns_frame, columns=(
            "username",
            "role",
            "api_key",
            "computer",
            "ip_address",
            "status",
            "created_at",
        ), show="headings", height=16)
        self.tree.heading("username", text="Usuario")
        self.tree.heading("role", text="Rol")
        self.tree.heading("api_key", text="API key")
        self.tree.heading("computer", text="Computadora")
        self.tree.heading("ip_address", text="IP")
        self.tree.heading("status", text="Estado")
        self.tree.heading("created_at", text="Creado")

        self.tree.column("username", width=140, anchor=tk.W)
        self.tree.column("role", width=80, anchor=tk.CENTER)
        self.tree.column("api_key", width=260, anchor=tk.W)
        self.tree.column("computer", width=140, anchor=tk.W)
        self.tree.column("ip_address", width=110, anchor=tk.CENTER)
        self.tree.column("status", width=90, anchor=tk.CENTER)
        self.tree.column("created_at", width=160, anchor=tk.CENTER)
        self.tree.pack(fill=tk.BOTH, expand=True, side=tk.LEFT)

        scrollbar = ttk.Scrollbar(columns_frame, orient=tk.VERTICAL, command=self.tree.yview)
        scrollbar.pack(fill=tk.Y, side=tk.RIGHT)
        self.tree.configure(yscrollcommand=scrollbar.set)

        buttons_frame = ttk.Frame(self)
        buttons_frame.pack(fill=tk.X, padx=12, pady=10)

        self.refresh_button = ttk.Button(buttons_frame, text="Refrescar", command=self._handle_refresh)
        self.refresh_button.pack(side=tk.LEFT)

        self.apply_button = ttk.Button(
            buttons_frame,
            text="Usar API key seleccionada",
            command=self._handle_apply,
        )
        self.apply_button.pack(side=tk.RIGHT)

        # Bloque de entrada manual correctamente indentado
        manual_frame = ttk.Frame(self)
        manual_frame.pack(fill=tk.X, padx=12, pady=(0, 12))

        manual_label = ttk.Label(manual_frame, text="Pegar API key manualmente:")
        manual_label.pack(anchor=tk.W)

        self.manual_api_key = tk.StringVar()
        manual_entry = ttk.Entry(manual_frame, textvariable=self.manual_api_key, width=60)
        manual_entry.pack(side=tk.LEFT, padx=(0, 8))

        manual_button = ttk.Button(
            manual_frame,
            text="Usar API key pegada",
            command=self._handle_apply_manual,
        )
        manual_button.pack(side=tk.LEFT)

        self.status_var = tk.StringVar(value="Listo.")
        status_label = ttk.Label(self, textvariable=self.status_var, anchor=tk.W)
        status_label.pack(fill=tk.X, padx=12, pady=(0, 12))

    def _handle_refresh(self) -> None:
        self._set_status("Actualizando usuarios...")
        self.after(50, self._populate_users)

    def _handle_apply(self) -> None:
        selection = self.tree.selection()
        if not selection:
            messagebox.showinfo("Selección requerida", "Selecciona un usuario primero.", parent=self)
            return

        item_id = selection[0]
        record = self.users.get(item_id)
        if not record:
            messagebox.showerror("Error", "No se pudo recuperar la información del usuario.", parent=self)
            return

        api_key = record.get("apiKey")
        username = record.get("username", "")
        if not api_key:
            messagebox.showerror("Error", "El usuario seleccionado no tiene API key disponible.", parent=self)
            return

        confirm = messagebox.askyesno(
            "Confirmar",
            f"Se configurará la API key del usuario '{username}'.\n\n¿Continuar?",
            parent=self,
        )
        if not confirm:
            return

        try:
            run_setx(str(api_key))
        except subprocess.CalledProcessError as exc:
            messagebox.showerror(
                "Error",
                "Falló la ejecución de setx. Asegúrate de contar con permisos de administrador.\n\n"
                f"Código de salida: {exc.returncode}\nSalida: {exc.stderr}",
                parent=self,
            )
            self._set_status("Error al configurar la API key.")
            return
        except Exception as exc:  # pragma: no cover - errores inesperados
            messagebox.showerror("Error", f"No se pudo configurar la API key.\n\nDetalles: {exc}", parent=self)
            self._set_status("Error al configurar la API key.")
            return

        self._set_status(f"API key configurada para {username}. Reinicia el servicio para aplicar cambios.")
        messagebox.showinfo(
            "Éxito",
            "API key configurada correctamente. Reinicia el servicio USBMonitorService para aplicar cambios.",
            parent=self,
        )
        self._emit_log(f"API key configurada para {username}.")

    def _handle_apply_manual(self) -> None:
        api_key = self.manual_api_key.get().strip()

        if not api_key:
            messagebox.showerror(
                "API key vacía",
                "Debes pegar una API key válida.",
                parent=self,
            )
            return

        confirm = messagebox.askyesno(
            "Confirmar",
            "Se configurará la API key pegada manualmente.\n\n¿Continuar?",
            parent=self,
        )
        if not confirm:
            return

        try:
            run_setx(api_key)
        except Exception as exc:
            messagebox.showerror(
                "Error",
                f"No se pudo configurar la API key.\n\nDetalles: {exc}",
                parent=self,
            )
            self._set_status("Error al configurar la API key manual.")
            return

        self._set_status("API key configurada manualmente. Reinicia el servicio para aplicar cambios.")
        messagebox.showinfo(
            "Éxito",
            "API key configurada correctamente. Reinicia el servicio USBMonitorService para aplicar cambios.",
            parent=self,
        )
        self._emit_log("API key manual aplicada correctamente.")

    def _populate_users(self) -> None:
        try:
            records = self.db_client.fetch_users()
        except Exception as exc:  # pragma: no cover - depende de la base de datos
            self._set_status(f"Error al cargar usuarios: {exc}")
            messagebox.showerror("Error", f"No se pudieron cargar los usuarios.\n\nDetalles: {exc}", parent=self)
            return

        self.tree.delete(*self.tree.get_children())
        self.users.clear()

        for record in records:
            computer = record.get("computer") or "Sin asignar"
            ip_address = record.get("ipAddress") or "-"
            is_active = record.get("isActive")
            status = "Activa" if is_active else ("Inactiva" if is_active is not None else "-")
            created_at = self._format_timestamp(record.get("createdAt"))
            item_values = (
                record.get("username", ""),
                record.get("role", ""),
                "••••••••" if record.get("apiKey") else "",
                computer,
                ip_address,
                status,
                created_at,
            )
            item_id = self.tree.insert("", tk.END, values=item_values)
            self.users[item_id] = record

        self._set_status(f"Usuarios cargados: {len(records)}")

    def _format_timestamp(self, value: Any) -> str:
        if value is None:
            return "-"
        return str(value)

    def _set_status(self, message: str) -> None:
        self.status_var.set(message)

    def _emit_log(self, text: str) -> None:
        if self.on_log:
            try:
                self.on_log(text)
            except Exception:
                LOGGER.debug("No se pudo reenviar mensaje al log de la GUI principal: %s", text, exc_info=True)

    def _on_close(self) -> None:
        try:
            self.db_client.close()
        finally:
            self._emit_log("Configurador de API key cerrado.")
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

    db_url = os.environ.get(DATABASE_URL_ENV_VAR, DEFAULT_DATABASE_URL)
    if not db_url:
        messagebox.showerror(
            "Configuración inválida",
            "No se encontró una cadena de conexión válida en USB_MONITOR_DATABASE_URL.",
            parent=parent,
        )
        if on_log:
            on_log("No se pudo abrir el configurador de API key: DATABASE_URL ausente.")
        return

    try:
        config = parse_database_url(db_url)
    except Exception as exc:
        messagebox.showerror(
            "Configuración inválida",
            f"No se pudo interpretar la cadena de conexión.\n\nDetalles: {exc}",
            parent=parent,
        )
        LOGGER.error("No se pudo interpretar DATABASE_URL: %s", exc)
        if on_log:
            on_log("No se pudo abrir el configurador de API key: cadena de conexión inválida.")
        return

    client = DatabaseClient(config)
    try:
        client.connect()
    except Exception as exc:
        client.close()
        messagebox.showerror(
            "Conexión fallida",
            "No se pudo conectar a la base de datos.\n\nRevisa USB_MONITOR_DATABASE_URL y que la base de datos esté en ejecución.\n\n"
            f"Detalles: {exc}",
            parent=parent,
        )
        LOGGER.error("No se pudo conectar a la base de datos: %s", exc)
        if on_log:
            on_log("No se pudo abrir el configurador de API key: error de conexión.")
        return

    dialog = ApiKeyConfiguratorDialog(parent, client, on_log=on_log)
    dialog.wait_visibility()


def _sanitize_string(value: Optional[str], max_length: int) -> Optional[str]:
    if not isinstance(value, str):
        return None
    sanitized = CONTROL_CHARS_REGEX.sub("", value).strip()
    if not sanitized:
        return None
    return sanitized[:max_length]


def sanitize_required_string(
    value: Optional[str], *, max_length: int, fallback: str
) -> str:
    sanitized = _sanitize_string(value, max_length)
    if sanitized is None:
        return _sanitize_string(fallback, max_length) or fallback
    return sanitized


def sanitize_optional_string(value: Optional[str], max_length: int) -> Optional[str]:
    return _sanitize_string(value, max_length)


def sanitize_drive_letter(value: Optional[str]) -> Optional[str]:
    cleaned = sanitize_optional_string(value, 3)
    if not cleaned:
        return None
    candidate = cleaned.upper()
    if len(candidate) == 2 and candidate[1] == ":" and candidate[0].isalpha():
        return candidate
    return None


def normalize_serial_candidate(serial: Optional[str]) -> Optional[str]:
    if not isinstance(serial, str):
        return None
    stripped = CONTROL_CHARS_REGEX.sub("", serial).strip()
    if not stripped:
        return None
    collapsed = re.sub(r"\s+", "", stripped)
    sanitized = SERIAL_ALLOWED_CHARS_REGEX.sub("", collapsed.upper())
    if not sanitized:
        return None
    if sanitized in SERIAL_SENTINELS:
        return None
    if len(sanitized) < 4:
        return None
    return sanitized[:128]


def extract_serial_from_device_id(device_id: Optional[str]) -> Optional[str]:
    if not isinstance(device_id, str):
        return None
    tail = device_id.split("\\")[-1]
    for token in reversed(re.split(r"[&/_]", tail)):
        candidate = normalize_serial_candidate(token)
        if candidate:
            return candidate
    return normalize_serial_candidate(tail)


def is_valid_ipv4(value: str) -> bool:
    if not VALID_IPV4_REGEX.match(value):
        return False
    try:
        return all(0 <= int(part) <= 255 for part in value.split("."))
    except ValueError:
        return False


def ensure_ipv4(value: Optional[str], default: str = DEFAULT_IPV4_FALLBACK) -> str:
    candidate = sanitize_optional_string(value, 15)
    if candidate and is_valid_ipv4(candidate):
        return candidate
    return default


HOSTNAME = sanitize_required_string(
    HOSTNAME_RAW, max_length=120, fallback="UNKNOWN_HOST"
)


def get_server_host() -> str:
    return os.environ.get("USB_MONITOR_SERVER_HOST", DEFAULT_HOST)


def get_server_port() -> int:
    try:
        return int(os.environ.get("USB_MONITOR_SERVER_PORT", str(DEFAULT_PORT)))
    except ValueError:
        LOGGER.warning(
            "Valor inválido para USB_MONITOR_SERVER_PORT, usando puerto por defecto %s",
            DEFAULT_PORT,
        )
        return DEFAULT_PORT


def get_listen_port() -> int:
    """Obtiene el puerto donde el servicio escuchará peticiones HTTP."""
    try:
        return int(os.environ.get("USB_MONITOR_LISTEN_PORT", str(DEFAULT_LISTEN_PORT)))
    except ValueError:
        LOGGER.warning(
            "Valor inválido para USB_MONITOR_LISTEN_PORT, usando puerto por defecto %s",
            DEFAULT_LISTEN_PORT,
        )
        return DEFAULT_LISTEN_PORT


def build_url(endpoint: str) -> str:
    host = get_server_host()
    port = get_server_port()
    scheme_env = os.environ.get("USB_MONITOR_SERVER_SCHEME", "https")
    scheme = (scheme_env or "").lower().strip()
    if scheme not in ("http", "https"):
        LOGGER.warning(
            "USB_MONITOR_SERVER_SCHEME inválido ('%s'), usando HTTPS por defecto",
            scheme_env,
        )
        scheme = "https"
    return f"{scheme}://{host}:{port}{endpoint}"


def get_requests_verify() -> any:
    """Determina el valor para el parámetro 'verify' de requests.
    
    Reglas:
      - Sólo aplica para HTTPS. Para HTTP se retorna True (no hay verificación TLS).
      - Si USB_MONITOR_SSL_CERT está definido y apunta a un archivo existente,
        se retorna esa ruta (requests verificará contra ese bundle personalizado).
      - Si USB_MONITOR_SSL_VERIFY == 'false' (case-insensitive), retorna False.
      - En cualquier otro caso, retorna True.
    """
    # Si el esquema es HTTP, la verificación SSL no aplica
    scheme = (os.environ.get("USB_MONITOR_SERVER_SCHEME", "https") or "").lower().strip()
    if scheme == "http":
        return True

    cert_path = os.environ.get("USB_MONITOR_SSL_CERT", "").strip()
    if cert_path:
        p = Path(cert_path)
        if p.exists() and p.is_file():
            return str(p)
    verify_env = os.environ.get("USB_MONITOR_SSL_VERIFY", "true").lower()
    return verify_env != "false"


def get_auth_headers() -> Dict[str, str]:
    headers: Dict[str, str] = {}
    api_key_raw = os.environ.get("USB_MONITOR_API_KEY")
    if not api_key_raw:
        return headers

    api_key_encrypted = api_key_raw.strip()
    if not api_key_encrypted:
        return headers

    # Desencriptar la API key
    api_key = decrypt_api_key(api_key_encrypted)

    # Permite que el valor ya incluya el prefijo "ApiKey" y evita duplicarlo
    if api_key.lower().startswith("apikey "):
        api_key = api_key.split(" ", 1)[1].strip()

    if api_key:
        headers["Authorization"] = f"ApiKey {api_key}"
    return headers


def resolve_log_path() -> Path:
    custom_path = os.environ.get("USB_MONITOR_LOG_PATH")
    if custom_path:
        path = Path(custom_path)
        if path.suffix:
            path.parent.mkdir(parents=True, exist_ok=True)
            return path.resolve()
        path.mkdir(parents=True, exist_ok=True)
        return (path / get_log_file_name()).resolve()

    default_path = get_default_log_path()
    try:
        default_path.parent.mkdir(parents=True, exist_ok=True)
        return default_path
    except OSError:
        if getattr(sys, "frozen", False):
            fallback_dir = PROGRAM_DATA_DIR
        else:
            fallback_dir = get_app_directory() / "logs"
        fallback_dir.mkdir(parents=True, exist_ok=True)
        return (fallback_dir / get_log_file_name()).resolve()


def get_logger() -> logging.Logger:
    """Configura y devuelve un logger compartido."""
    logger = logging.getLogger("usb_monitor_service")
    if not logger.handlers:
        logger.setLevel(logging.INFO)
        log_file = resolve_log_path()
        pending_warning: Optional[str] = None

        try:
            handler: logging.Handler = logging.FileHandler(log_file, encoding="utf-8")
        except OSError as exc:
            fallback_paths = [
                (PROGRAM_DATA_DIR / get_log_file_name()).resolve(),
                (get_app_directory() / "logs" / get_log_file_name()).resolve(),
            ]
            handler = None
            last_exc: Optional[Exception] = exc
            for candidate in fallback_paths:
                if candidate == log_file:
                    continue
                try:
                    candidate.parent.mkdir(parents=True, exist_ok=True)
                    handler = logging.FileHandler(candidate, encoding="utf-8")
                    pending_warning = (
                        "No se pudo crear el log en %s (%s). Se usará %s."
                        % (log_file, exc, candidate)
                    )
                    break
                except OSError as fallback_exc:
                    last_exc = fallback_exc
            if handler is None:
                handler = logging.StreamHandler()
                pending_warning = (
                    "No se pudo crear el archivo de log (%s). Se registrará sólo en la consola."
                    % last_exc
                )

        formatter = logging.Formatter(
            "%(asctime)s | %(levelname)s | %(message)s",
            datefmt="%Y-%m-%d %H:%M:%S",
        )
        handler.setFormatter(formatter)
        logger.addHandler(handler)
        if len(sys.argv) > 1 and sys.argv[1].lower() == "debug":
            stream_handler = logging.StreamHandler()
            stream_handler.setFormatter(formatter)
            logger.addHandler(stream_handler)
        destination = getattr(getattr(handler, "stream", handler), "name", None)
        if isinstance(destination, str):
            logger.info("Registro inicializado en %s", destination)
        else:
            logger.info("Registro inicializado (%s)", type(handler).__name__)
        if pending_warning:
            logger.warning(pending_warning)
    return logger


LOGGER = get_logger()


def is_user_admin() -> bool:
    if os.name != "nt":
        return True
    try:
        return bool(ctypes.windll.shell32.IsUserAnAdmin())
    except Exception:
        return False


def ensure_admin_or_exit() -> None:
    if is_user_admin():
        return
    message = (
        "Este programa debe ejecutarse con permisos de administrador. "
        "Cierra y vuelve a abrirlo con privilegios elevados."
    )
    LOGGER.critical(message)
    root: Optional[tk.Tk] = None
    try:
        root = tk.Tk()
        root.withdraw()
        messagebox.showerror("USB Monitor Service", message, parent=root)
    except Exception:
        pass
    finally:
        if root is not None:
            root.destroy()
    print(message, file=sys.stderr)
    sys.exit(5)


def log_initial_configuration() -> None:
    if getattr(LOGGER, "_config_logged", False):
        return

    try:
        api_key_present = "sí" if os.environ.get("USB_MONITOR_API_KEY") else "no"
        LOGGER.info(
            "Configuración inicial | frozen=%s | destino=%s:%s | endpoint=%s | puerto_http=%s | api_key=%s",
            getattr(sys, "frozen", False),
            get_server_host(),
            get_server_port(),
            os.environ.get("USB_MONITOR_ENDPOINT", DEFAULT_ENDPOINT),
            get_listen_port(),
            api_key_present,
        )
        LOGGER.debug("Ruta efectiva de log: %s", resolve_log_path())
        LOGGER.debug("Argumentos de ejecución: %s", sys.argv)
    except Exception as exc:  # pragma: no cover - logging inicial no debe fallar
        LOGGER.debug("No se pudo registrar la configuración inicial: %s", exc)
    finally:
        setattr(LOGGER, "_config_logged", True)


log_initial_configuration()


def resolve_ip(force_refresh: bool = False) -> str:
    """Obtiene la IP más razonable asociada al host local con caché de corta duración."""
    now = time.time()
    if not force_refresh and _resolved_ip_cache["expires_at"] > now:
        return str(_resolved_ip_cache["value"])
    try:
        hostname = socket.gethostname()
        addresses = socket.gethostbyname_ex(hostname)[2]
        for addr in addresses:
            if not isinstance(addr, str):
                continue
            candidate = ensure_ipv4(addr, default="")
            if candidate and not candidate.startswith("127."):
                _resolved_ip_cache["value"] = candidate
                _resolved_ip_cache["expires_at"] = now + RESOLVE_IP_CACHE_TTL
                return candidate
        with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as s:
            s.connect(("8.8.8.8", 80))
            candidate = ensure_ipv4(s.getsockname()[0], default="")
            if candidate:
                _resolved_ip_cache["value"] = candidate
                _resolved_ip_cache["expires_at"] = now + RESOLVE_IP_CACHE_TTL
                return candidate
    except Exception as exc:
        LOGGER.warning("No se pudo resolver IP local: %s", exc)
    _resolved_ip_cache["value"] = DEFAULT_IPV4_FALLBACK
    _resolved_ip_cache["expires_at"] = now + RESOLVE_IP_CACHE_TTL
    return DEFAULT_IPV4_FALLBACK


def build_payload(
    event: Any,
    drive_descriptor: Optional[str] = None,
    readonly_status: Optional[str] = None,
    serial_number: Optional[str] = None,
    whitelisted: bool = False,
) -> Dict[str, Any]:
    descriptor_candidate = drive_descriptor
    if not descriptor_candidate:
        for attr in ("DriveName", "VolumeName", "DeviceID"):
            value = getattr(event, attr, None)
            if value:
                descriptor_candidate = str(value)
                break

    descriptor_clean = sanitize_required_string(
        descriptor_candidate,
        max_length=120,
        fallback="Unknown",
    )

    readonly_clean = sanitize_optional_string(readonly_status, 120)
    drive_letter_clean = sanitize_drive_letter(drive_descriptor)
    serial_clean = sanitize_optional_string(serial_number, 128)

    event_parts = [f"USB inserted: {descriptor_clean}"]
    if readonly_clean:
        event_parts.append(readonly_clean)
    if whitelisted:
        event_parts.append("WHITELIST")

    event_message = sanitize_required_string(
        " | ".join(event_parts),
        max_length=512,
        fallback="USB event detected",
    )

    payload: Dict[str, Any] = {
        "pc_name": HOSTNAME,
        "pc_ip": resolve_ip(),
        "pc_user": sanitize_required_string(
            getpass.getuser(), max_length=120, fallback="UNKNOWN_USER"
        ),
        "drive_letter": drive_letter_clean,
        "readonly_status": readonly_clean,
        "event": event_message,
    }

    if serial_clean:
        payload["serial_number"] = serial_clean
    if whitelisted:
        payload["whitelisted"] = True

    return payload


def _send_event_request(payload: Dict[str, Any]) -> None:
    endpoint = os.environ.get("USB_MONITOR_ENDPOINT", DEFAULT_ENDPOINT)
    url = build_url(endpoint)
    headers = {"Content-Type": "application/json"}
    headers.update(get_auth_headers())

    try:
        verify = get_requests_verify()
        response = requests.post(url, json=payload, headers=headers, timeout=10, verify=verify)
        response.raise_for_status()
        LOGGER.info("Evento USB enviado correctamente: %s", json.dumps(payload))
    except Exception as exc:
        LOGGER.error("Error al enviar evento USB: %s", exc)


def send_event(payload: Dict[str, Any]) -> None:
    """Encola el envío para no bloquear el hilo principal del servicio."""
    submit_network_task(_send_event_request, payload)


def resolve_drive_letter(event: Any, conn: wmi.WMI) -> Optional[str]:
    LOGGER.debug(
        "Resolviendo letra de unidad | DriveName=%s | VolumeName=%s | DeviceID=%s",
        getattr(event, "DriveName", None),
        getattr(event, "VolumeName", None),
        getattr(event, "DeviceID", None),
    )
    drive_name = getattr(event, "DriveName", None)
    if isinstance(drive_name, str) and len(drive_name) >= 2 and drive_name[1] == ":":
        resolved = drive_name[:2].upper()
        LOGGER.info("Letra de unidad determinada directamente: %s", resolved)
        return resolved

    candidate = getattr(event, "VolumeName", None) or getattr(event, "DeviceID", None)
    if not isinstance(candidate, str):
        LOGGER.debug("Evento sin candidate válido para letra: %s", candidate)
        return None

    try:
        normalized = candidate.replace("\\", "\\\\")
        volumes = conn.query(
            f"SELECT DriveLetter FROM Win32_Volume WHERE DeviceID='{normalized}'"
        )
        for volume in volumes:
            drive_letter = getattr(volume, "DriveLetter", None)
            if drive_letter:
                resolved = str(drive_letter).upper()
                LOGGER.info("Letra de unidad resuelta vía WMI: %s", resolved)
                return resolved
    except Exception as exc:
        LOGGER.warning("No se pudo resolver letra de unidad para %s: %s", candidate, exc)

    LOGGER.debug("No se encontró letra de unidad para el evento.")
    return None


def resolve_disk_number(drive_letter: str, conn: wmi.WMI) -> Optional[str]:
    LOGGER.debug("Resolviendo número de disco para la unidad %s", drive_letter)
    try:
        logical = conn.Win32_LogicalDisk(DeviceID=f"{drive_letter}:")
        if not logical:
            LOGGER.debug("No se encontró Win32_LogicalDisk para %s", drive_letter)
            return None
        partitions = logical[0].associators(wmi_result_class="Win32_DiskPartition")
        for partition in partitions:
            disks = partition.associators(wmi_result_class="Win32_DiskDrive")
            for disk in disks:
                index = getattr(disk, "Index", None)
                if index is not None:
                    resolved = str(index)
                    LOGGER.info(
                        "Número de disco para %s resuelto vía asociación directa: %s",
                        drive_letter,
                        resolved,
                    )
                    return resolved
        # Fallback manual join via Win32_LogicalDiskToPartition
        rels = conn.query(
            "SELECT * FROM Win32_LogicalDiskToPartition WHERE Antecedent LIKE '%{}%'".format(
                drive_letter
            )
        )
        for rel in rels:
            antecedent = getattr(rel, "Antecedent", "")
            disk_part = antecedent.split("\\")[-1]
            disk_info = conn.query(
                "SELECT * FROM Win32_DiskDrive WHERE DeviceID LIKE '%{}%'".format(
                    disk_part
                )
            )
            for disk in disk_info:
                index = getattr(disk, "Index", None)
                if index is not None:
                    resolved = str(index)
                    LOGGER.info(
                        "Número de disco para %s resuelto vía fallback: %s",
                        drive_letter,
                        resolved,
                    )
                    return resolved
    except Exception as exc:
        LOGGER.warning(
            "No se pudo resolver el número de disco para la unidad %s: %s",
            drive_letter,
            exc,
        )
    LOGGER.debug("No se pudo determinar el número de disco para %s", drive_letter)
    return None


def run_diskpart(commands: str) -> subprocess.CompletedProcess[str]:
    script_content = commands if commands.endswith("\n") else commands + "\n"
    with tempfile.NamedTemporaryFile("w", suffix=".txt", delete=False) as script_file:
        script_file.write(script_content)
        script_path = script_file.name

    try:
        LOGGER.info("Ejecutando diskpart con script temporal %s", script_path)
        LOGGER.debug("Contenido de script diskpart:\n%s", script_content.strip())
        result = subprocess.run(
            ["diskpart", "/s", script_path],
            text=True,
            capture_output=True,
            check=False,
            timeout=30,
            encoding='cp850',  # Codificación de consola de Windows
        )
    finally:
        try:
            os.remove(script_path)
        except OSError:
            pass

    return result


def resolve_disk_number_with_fallback(
    letter: str, conn: Optional[wmi.WMI]
) -> Optional[str]:
    """Resuelve el número de disco intentando reusar la conexión WMI y, si falla,
    crea una nueva conexión dentro del mismo hilo."""

    disk_number: Optional[str] = None

    if conn is not None:
        disk_number = resolve_disk_number(letter, conn)
        if disk_number:
            return disk_number

    LOGGER.debug(
        "Reintentando resolver disco %s con nueva conexión WMI en este hilo",
        letter,
    )

    temp_conn: Optional[wmi.WMI] = None
    initialized = False
    try:
        pythoncom.CoInitialize()
        initialized = True
    except pythoncom.com_error as exc:
        LOGGER.debug("CoInitialize adicional devolvió error (se ignora): %s", exc)

    try:
        temp_conn = wmi.WMI()
        disk_number = resolve_disk_number(letter, temp_conn)
    except Exception as exc:
        LOGGER.warning(
            "No se pudo resolver el número de disco %s con nueva conexión WMI: %s",
            letter,
            exc,
        )
        disk_number = None
    finally:
        if initialized:
            pythoncom.CoUninitialize()

    return disk_number


def set_disk_readonly(drive_letter: str, conn: wmi.WMI) -> Tuple[bool, str]:
    letter = drive_letter.rstrip(":").upper()
    if len(letter) != 1 or not letter.isalpha():
        msg = f"Letra de unidad inválida ({drive_letter})"
        LOGGER.warning("%s", msg)
        return False, msg

    disk_number = resolve_disk_number_with_fallback(letter, conn)
    if not disk_number:
        msg = f"No se pudo resolver el disco asociado a la unidad {drive_letter}"
        LOGGER.warning("%s", msg)
        return False, msg

    script = f"select disk {disk_number}\nattributes disk set readonly\nexit\n"

    try:
        result = run_diskpart(script)
        stdout_lower = result.stdout.lower()
        stderr_lower = result.stderr.lower()
        if (
            result.returncode == 0
            and "error" not in stdout_lower
            and "error" not in stderr_lower
        ):
            msg = f"readonly aplicado al disco {disk_number} (unidad {drive_letter})"
            LOGGER.info(
                "Disco %s (unidad %s) establecido en modo solo lectura. Salida: %s",
                disk_number,
                drive_letter,
                result.stdout.strip(),
            )
            return True, msg

        LOGGER.error(
            "diskpart devolvió código %s al bloquear disco %s (unidad %s). Stdout: %s | Stderr: %s",
            result.returncode,
            disk_number,
            drive_letter,
            result.stdout.strip(),
            result.stderr.strip(),
        )
        msg = (
            f"Fallo al aplicar readonly en disco {disk_number} para unidad {drive_letter}"
        )
        return False, msg
    except FileNotFoundError:
        msg = "diskpart no está disponible en el sistema"
        LOGGER.error("%s. No se puede bloquear escritura.", msg)
        return False, msg
    except subprocess.TimeoutExpired:
        msg = f"diskpart tardó demasiado en proteger la unidad {drive_letter}"
        LOGGER.error("%s. Operación cancelada.", msg)
        return False, msg
    except Exception as exc:
        msg = f"Error inesperado al establecer unidad {drive_letter} solo lectura: {exc}"
        LOGGER.error("%s", msg)
        return False, msg


def clear_disk_readonly(drive_letter: str, conn: wmi.WMI) -> Tuple[bool, str]:
    """Remueve el atributo de solo lectura del disco que contiene la unidad USB."""
    letter = drive_letter.rstrip(":").upper()
    if len(letter) != 1 or not letter.isalpha():
        msg = f"Letra de unidad inválida ({drive_letter})"
        LOGGER.warning("%s", msg)
        return False, msg

    disk_number = resolve_disk_number_with_fallback(letter, conn)
    if not disk_number:
        msg = f"No se pudo resolver el disco asociado a la unidad {drive_letter}"
        LOGGER.warning("%s", msg)
        return False, msg

    script = f"select disk {disk_number}\nattributes disk clear readonly\nexit\n"

    try:
        result = run_diskpart(script)
        stdout_lower = result.stdout.lower()
        stderr_lower = result.stderr.lower()

        if (
            result.returncode == 0
            and "error" not in stdout_lower
            and "error" not in stderr_lower
        ):
            msg = f"readonly removido del disco {disk_number} (unidad {drive_letter})"
            LOGGER.info(
                "Disco %s (unidad %s) desbloqueado. Salida: %s",
                disk_number,
                drive_letter,
                result.stdout.strip(),
            )
            return True, msg

        LOGGER.error(
            "diskpart devolvió código %s al desbloquear disco %s (unidad %s). Stdout: %s | Stderr: %s",
            result.returncode,
            disk_number,
            drive_letter,
            result.stdout.strip(),
            result.stderr.strip(),
        )
        msg = f"Fallo al remover readonly en disco {disk_number} para unidad {drive_letter}"
        return False, msg

    except FileNotFoundError:
        msg = "diskpart no está disponible en el sistema"
        LOGGER.error("%s. No se puede desbloquear.", msg)
        return False, msg
    except subprocess.TimeoutExpired:
        msg = f"diskpart tardó demasiado en desbloquear la unidad {drive_letter}"
        LOGGER.error("%s. Operación cancelada.", msg)
        return False, msg
    except Exception as exc:
        msg = f"Error inesperado al desbloquear unidad {drive_letter}: {exc}"
        LOGGER.error("%s", msg)
        return False, msg


def protect_usb_media(
    drive_letter: Optional[str],
    conn: wmi.WMI,
) -> Tuple[Optional[str], bool, str]:
    LOGGER.debug("  Resolviendo disco para unidad: %s", drive_letter)
    if not drive_letter:
        msg = "No se determinó la letra de unidad"
        LOGGER.warning("    ✗ %s", msg)
        return None, False, msg

    success, detail = set_disk_readonly(drive_letter, conn)
    if success:
        LOGGER.info("    ✓ Disco protegido exitosamente | %s", detail)
    else:
        LOGGER.error("    ✗ Fallo al proteger disco | %s", detail)
    
    return drive_letter, success, detail


def schedule_shutdown(delay_seconds: int = 3) -> None:
    """Programa el apagado del equipo."""
    try:
        LOGGER.warning(
            "  ⚠  Dispositivo no autorizado. Apagado programado en %s segundos.",
            delay_seconds,
        )
        subprocess.Popen(
            ["shutdown", "/s", "/t", str(max(delay_seconds, 0))],
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
        )
    except Exception as exc:
        LOGGER.error("  ✗ No se pudo programar el apagado automático: %s", exc)


def create_browser_signal(pc_name: str, drive_letter: str) -> None:
    """Crea el archivo de señal para que el agente muestre el login."""
    try:
        LOGGER.debug(
            "    → Creando archivo de señal para %s en unidad %s", pc_name, drive_letter
        )
        SIGNAL_FILE.parent.mkdir(parents=True, exist_ok=True)
        
        signal_data = {
            "pc_name": pc_name,
            "drive_letter": drive_letter,
            "timestamp": time.time(),
            "processed": False,
        }
        
        with open(SIGNAL_FILE, "w", encoding="utf-8") as f:
            json.dump(signal_data, f, indent=2)
        
        LOGGER.info("    ✓ Archivo de señal creado: %s", SIGNAL_FILE)
    except Exception as exc:
        LOGGER.error("    ✗ Error al crear archivo de señal: %s", exc)


def _create_pending_unlock_request(pc_name: str, drive_letter: str) -> bool:
    # Legacy deshabilitado: se usa solo whitelist. No-op.
    LOGGER.debug(
        "    [Legacy OFF] pending-unlock omitido para PC=%s | Unidad=%s",
        pc_name,
        drive_letter,
    )
    return False


def create_pending_unlock(pc_name: str, drive_letter: str) -> bool:
    # Legacy deshabilitado: no se crean pending unlocks.
    LOGGER.debug("    [Legacy OFF] create_pending_unlock omitido")
    return False


def _check_whitelist_remote(normalized_serial: str) -> Tuple[bool, Optional[Dict[str, Any]]]:
    encoded_serial = quote(normalized_serial, safe="")
    endpoint = f"/api/whitelist/check?serial={encoded_serial}"
    url = build_url(endpoint)
    headers = get_auth_headers()

    LOGGER.debug("    [Whitelist] Enviando petición GET a: %s", endpoint)
    verify = get_requests_verify()
    response = requests.get(url, headers=headers, timeout=8, verify=verify)
    response.raise_for_status()

    data = response.json()
    allowed = bool(data.get("allowed"))
    entry = data.get("entry") if allowed else None

    if allowed:
        label_info = f" | Etiqueta: {entry.get('label')}" if entry and entry.get("label") else ""
        notes_info = f" | Notas: {entry.get('notes')}" if entry and entry.get("notes") else ""
        LOGGER.info(
            "    [Whitelist] ✓ Serial %s AUTORIZADO%s%s",
            normalized_serial,
            label_info,
            notes_info,
        )
    else:
        LOGGER.warning("    [Whitelist] ✗ Serial %s NO ENCONTRADO en whitelist", normalized_serial)

    return allowed, entry


def check_whitelist(serial_number: Optional[str]) -> Tuple[bool, Optional[Dict[str, Any]]]:
    """Consulta el backend para verificar si el serial está autorizado con caché y backoff."""
    normalized_serial = normalize_serial_candidate(serial_number)
    if not normalized_serial:
        LOGGER.debug("    [Whitelist] Serial no puede ser normalizado (valor vacío o inválido)")
        return False, None

    cached = _whitelist_cache.get(normalized_serial)
    now = time.time()
    if cached and cached[0] > now:
        return cached[1], cached[2]

    future = submit_network_task(
        _check_whitelist_remote,
        normalized_serial,
        expect_result=True,
    )

    allowed: bool
    entry: Optional[Dict[str, Any]]
    if future is not None:
        try:
            allowed, entry = future.result(timeout=10)
        except Exception as exc:
            LOGGER.error(
                "    [Whitelist] ✗ Error al obtener whitelist (cola): %s",
                exc,
            )
            return False, None
    else:
        try:
            allowed, entry = _check_whitelist_remote(normalized_serial)
        except Exception as exc:  # pragma: no cover - redundante
            LOGGER.error("    [Whitelist] ✗ Error al consultar whitelist directamente: %s", exc)
            return False, None

    ttl = WHITELIST_POSITIVE_TTL if allowed else WHITELIST_NEGATIVE_TTL
    _whitelist_cache[normalized_serial] = (now + ttl, allowed, entry)
    return allowed, entry


def _check_unlock_status_remote(pc_name: str) -> Tuple[bool, Optional[str]]:
    # Legacy deshabilitado: no se consulta estado de desbloqueo.
    LOGGER.debug("    [Legacy OFF] check_unlock_status omitido para PC=%s", pc_name)
    return False, None


def check_unlock_status(pc_name: str) -> Tuple[bool, Optional[str]]:
    """Verifica si el backend ha autorizado el desbloqueo aplicando backoff en respuestas negativas."""
    now = time.time()
    cached = _unlock_backoff.get(pc_name)
    if cached and cached[0] > now:
        return cached[1], cached[2]

    future = submit_network_task(
        _check_unlock_status_remote,
        pc_name,
        expect_result=True,
    )

    unlocked: bool
    drive_letter: Optional[str]
    if future is not None:
        try:
            unlocked, drive_letter = future.result(timeout=10)
        except Exception as exc:
            LOGGER.debug("    [Desbloqueo] Error al obtener estado (cola): %s", exc)
            _unlock_backoff[pc_name] = (now + UNLOCK_NEGATIVE_BACKOFF, False, None)
            return False, None
    else:
        try:
            unlocked, drive_letter = _check_unlock_status_remote(pc_name)
        except Exception as exc:
            LOGGER.debug("    [Desbloqueo] Error al verificar desbloqueo directamente: %s", exc)
            _unlock_backoff[pc_name] = (now + UNLOCK_NEGATIVE_BACKOFF, False, None)
            return False, None

    if unlocked:
        _unlock_backoff.pop(pc_name, None)
    else:
        _unlock_backoff[pc_name] = (now + UNLOCK_NEGATIVE_BACKOFF, False, None)
    return unlocked, drive_letter


def unlock_usb(drive_letter: str, conn: wmi.WMI) -> bool:
    """Desbloquea una unidad USB removiendo el atributo readonly."""
    LOGGER.info("  → Iniciando desbloqueo de unidad %s", drive_letter)
    
    success, msg = clear_disk_readonly(drive_letter, conn)
    
    if success:
        LOGGER.info("  ✓ Unidad %s desbloqueada: %s", drive_letter, msg)
    else:
        LOGGER.error("  ✗ Fallo al desbloquear unidad %s: %s", drive_letter, msg)
    
    return success


USB_BUS_TYPE_IDS = {7}


def _shorten(value: Optional[str], *, limit: int = 120) -> str:
    if not value:
        return ""
    value = value.strip()
    if len(value) <= limit:
        return value
    return value[: limit - 3] + "..."


def _classify_disk_as_usb(disk: Any) -> Tuple[bool, List[str], Dict[str, Any]]:
    interface_type_raw = getattr(disk, "InterfaceType", None)
    interface_type = str(interface_type_raw).strip() if interface_type_raw else ""
    interface_type_upper = interface_type.upper()

    bus_type_raw = getattr(disk, "BusType", None)
    bus_type: Optional[int] = None
    bus_type_label: Optional[str] = None
    if isinstance(bus_type_raw, (int, float)):
        bus_type = int(bus_type_raw)
    elif isinstance(bus_type_raw, str) and bus_type_raw.strip():
        bus_type_label = bus_type_raw.strip()

    pnp_device_id_raw = getattr(disk, "PNPDeviceID", None)
    pnp_device_id = str(pnp_device_id_raw).strip() if pnp_device_id_raw else ""
    pnp_device_id_upper = pnp_device_id.upper()

    device_id_raw = getattr(disk, "DeviceID", None)
    device_id = str(device_id_raw).strip() if device_id_raw else ""
    device_id_upper = device_id.upper()

    media_type_raw = getattr(disk, "MediaType", None)
    media_type = str(media_type_raw).strip() if media_type_raw else ""

    reasons: List[str] = []

    if interface_type_upper == "USB":
        reasons.append("InterfaceType=USB")

    if bus_type is not None and bus_type in USB_BUS_TYPE_IDS:
        reasons.append(f"BusType={bus_type}")
    elif bus_type_label and bus_type_label.upper() == "USB":
        reasons.append("BusTypeLabel=USB")

    if "USBSTOR" in pnp_device_id_upper:
        reasons.append("PNPDeviceID contiene USBSTOR")
    elif "USB" in pnp_device_id_upper:
        reasons.append("PNPDeviceID contiene USB")

    if "\\USB" in device_id_upper or device_id_upper.startswith("USB"):
        reasons.append("DeviceID contiene USB")

    is_usb = bool(reasons)

    metadata = {
        "interfaceType": interface_type or None,
        "busType": bus_type if bus_type is not None else (bus_type_label or None),
        "mediaType": media_type or None,
        "pnpDeviceId": pnp_device_id or None,
        "deviceId": device_id or None,
    }

    return is_usb, reasons, metadata


def get_connected_usb_drives(conn: wmi.WMI) -> list:
    """Obtiene información de todas las unidades USB conectadas actualmente."""
    usb_drives: list[Dict[str, Any]] = []

    disks = conn.Win32_DiskDrive()
    for disk in disks:
        disk_index = getattr(disk, "Index", None)
        if disk_index is None:
            continue

        is_usb, reasons, metadata = _classify_disk_as_usb(disk)
        disk_identifier = f"{disk_index}:{metadata.get('deviceId') or metadata.get('pnpDeviceId') or 'UNKNOWN'}"

        if not is_usb:
            cache_key = f"skip:{disk_identifier}"
            if cache_key not in DISCARDED_DISK_CACHE:
                LOGGER.warning(
                    "Disco descartado por no parecer USB | index=%s | interface=%s | media=%s",
                    disk_index,
                    metadata.get("interfaceType") or "N/A",
                    metadata.get("mediaType") or "N/A",
                )
                LOGGER.debug(
                    "Detalles del disco descartado | index=%s | PNP=%s | DeviceID=%s",
                    disk_index,
                    _shorten(metadata.get("pnpDeviceId")),
                    _shorten(metadata.get("deviceId")),
                )
                DISCARDED_DISK_CACHE.add(cache_key)
            continue

        LOGGER.debug(
            "Disco clasificado como USB | index=%s | razones=%s | interface=%s",
            disk_index,
            ", ".join(reasons),
            metadata.get("interfaceType") or "N/A",
        )

        serial = (getattr(disk, "SerialNumber", "") or "").strip()
        serial_normalized = normalize_serial_candidate(serial)
        if not serial_normalized:
            serial_normalized = extract_serial_from_device_id(
                getattr(disk, "PNPDeviceID", None)
            )
        if not serial_normalized:
            serial_normalized = extract_serial_from_device_id(
                getattr(disk, "DeviceID", None)
            )
        # Usar el serial normalizado si existe, sino usar el serial crudo (no "UNKNOWN")
        serial_report = serial_normalized if serial_normalized else serial
        model = (getattr(disk, "Model", "") or "").strip()

        try:
            partitions = disk.associators(wmi_result_class="Win32_DiskPartition")
        except Exception as exc:
            LOGGER.debug(
                "No se pudieron obtener particiones para el disco USB %s: %s",
                disk_index,
                exc,
            )
            continue

        for partition in partitions:
            try:
                logical_disks = partition.associators(
                    wmi_result_class="Win32_LogicalDisk"
                )
            except Exception as exc:
                LOGGER.debug(
                    "No se pudieron obtener volúmenes lógicos para el disco USB %s: %s",
                    disk_index,
                    exc,
                )
                continue

            for logical in logical_disks:
                drive_letter = getattr(logical, "DeviceID", None)
                if not drive_letter:
                    continue

                drive_id = str(drive_letter).upper()
                volume_name = getattr(logical, "VolumeName", "") or "Sin nombre"
                size_value = getattr(logical, "Size", 0)
                free_value = getattr(logical, "FreeSpace", 0)

                try:
                    size = int(size_value) if size_value else 0
                except (TypeError, ValueError):
                    size = 0

                try:
                    free_space = int(free_value) if free_value else 0
                except (TypeError, ValueError):
                    free_space = 0

                usb_drives.append(
                    {
                        "driveLetter": drive_id,
                        "volumeName": volume_name,
                        "serialNumber": serial_report,
                        "serialNumberNormalized": serial_normalized,
                        "serialNumberRaw": serial or None,
                        "model": model or "Unknown",
                        "size": size,
                        "freeSpace": free_space,
                        "interfaceType": metadata.get("interfaceType"),
                        "busType": metadata.get("busType"),
                        "mediaType": metadata.get("mediaType"),
                        "detectionReasons": reasons,
                    }
                )
                LOGGER.debug(
                    "Unidad USB detectada | letter=%s | modelo=%s | size=%s | libre=%s",
                    drive_id,
                    model or "Unknown",
                    size,
                    free_space,
                )

    return usb_drives


def find_drive_info_by_letter(
    drives: list[Dict[str, Any]], drive_letter: str
) -> Optional[Dict[str, Any]]:
    normalized = drive_letter.rstrip(":").upper()
    for drive in drives:
        candidate = str(drive.get("driveLetter", "")).rstrip(":").upper()
        if candidate == normalized:
            return drive
    return None


def send_connected_drives_status(pc_name: str, conn: wmi.WMI, drives: Optional[list] = None) -> bool:
    """Envía el estado actual de las unidades USB conectadas al backend."""
    endpoint = "/api/usb-event/connected-status"
    url = build_url(endpoint)
    headers = {"Content-Type": "application/json"}
    headers.update(get_auth_headers())

    connected_drives = drives if drives is not None else get_connected_usb_drives(conn)
    LOGGER.debug("  [Estado Conectadas] Se encontraron %d unidades USB conectadas", len(connected_drives))

    payload = {
        "pcName": pc_name,
        "timestamp": time.time(),
        "connectedDrives": connected_drives,
    }

    try:
        verify = get_requests_verify()
        response = requests.post(url, json=payload, headers=headers, timeout=10, verify=verify)
        response.raise_for_status()
    except requests.RequestException as exc:
        LOGGER.debug("  [Estado Conectadas] ✗ Error HTTP al enviar estado: %s", exc)
        return False

    LOGGER.info(
        "  [Estado Conectadas] ✓ Status enviado: %d unidades reportadas",
        len(connected_drives),
    )
    return True


class UnlockHTTPHandler(BaseHTTPRequestHandler):
    """Handler HTTP para health-checks y notificaciones de desbloqueo."""

    service_instance = None  # Referencia al servicio para acceder a pending_usbs y wmi

    def log_message(self, format: str, *args) -> None:
        """Sobrescribe el logging para usar nuestro logger."""
        LOGGER.info("%s - %s", self.address_string(), format % args)

    def _apply_cors_headers(self) -> None:
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET,POST,OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")

    def _send_json_response(self, status_code: int, payload: Dict[str, Any]) -> None:
        body = json.dumps(payload).encode("utf-8")
        self.send_response(status_code)
        self._apply_cors_headers()
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        try:
            self.wfile.write(body)
        except BrokenPipeError:
            LOGGER.debug("Cliente cerró la conexión antes de finalizar la respuesta")

    def _status_snapshot(self, *, extended: bool) -> Dict[str, Any]:
        now = time.time()
        listen_port = get_listen_port()
        pending_unlocks = 0
        pending_list: list[str] = []
        uptime_seconds: Optional[float] = None
        frozen = bool(getattr(sys, "frozen", False))

        service = self.service_instance
        if service is not None:
            pending_unlocks = len(getattr(service, "pending_usbs", {}))
            pending_list = sorted(getattr(service, "pending_usbs", {}).keys())
            listen_port = getattr(service, "listening_port", listen_port)
            started_at = getattr(service, "started_at", None)
            if isinstance(started_at, (int, float)):
                uptime_seconds = max(0.0, now - started_at)

        payload: Dict[str, Any] = {
            "status": "ok",
            "service": "USBMonitorService",
            "hostname": HOSTNAME,
            "version": SERVICE_API_VERSION,
            "timestamp": now,
        }

        if extended:
            extended_payload: Dict[str, Any] = {
                "ip": resolve_ip(),
                "pending_unlocks": pending_unlocks,
                "listening_port": listen_port,
                "frozen": frozen,
                "pid": os.getpid(),
            }
            if pending_list:
                extended_payload["pending_unlocks_list"] = pending_list
            if uptime_seconds is not None:
                extended_payload["uptime_seconds"] = uptime_seconds
            payload.update(extended_payload)

        return payload

    def do_OPTIONS(self) -> None:
        self.send_response(204)
        self._apply_cors_headers()
        self.end_headers()

    def do_GET(self) -> None:
        parsed = urlparse(self.path)

        if parsed.path == "/health":
            body = self._status_snapshot(extended=False)
            self._send_json_response(200, body)
            return

        if parsed.path == "/service-status":
            body = self._status_snapshot(extended=True)
            self._send_json_response(200, body)
            return

        self._send_json_response(404, {"status": "not_found"})

    def do_POST(self) -> None:
        parsed = urlparse(self.path)

        if parsed.path != "/unlock":
            self._send_json_response(404, {"ok": False, "error": "Ruta no encontrada"})
            return

        try:
            content_length = int(self.headers.get("Content-Length", "0") or "0")
        except ValueError:
            content_length = 0

        body = self.rfile.read(content_length)

        try:
            data = json.loads(body.decode("utf-8") or "{}")
        except json.JSONDecodeError:
            LOGGER.error("Body de petición no es JSON válido")
            self._send_json_response(400, {"ok": False, "error": "JSON inválido"})
            return

        raw_pc = data.get("pcName")
        pc_name = sanitize_optional_string(raw_pc, 120)
        if pc_name is None:
            pc_name = ""
        pc_name = pc_name.upper()

        raw_drive = data.get("driveLetter")
        drive_letter = sanitize_drive_letter(raw_drive) if isinstance(raw_drive, str) else None
        if drive_letter is None and isinstance(raw_drive, str):
            candidate = raw_drive.strip().upper()
            if len(candidate) == 1 and candidate.isalpha():
                drive_letter = f"{candidate}:"

        if not pc_name or not drive_letter:
            self._send_json_response(
                400,
                {
                    "ok": False,
                    "error": "pcName y driveLetter son obligatorios",
                },
            )
            return

        if pc_name != HOSTNAME:
            LOGGER.warning(
                "Recibida petición de desbloqueo para PC '%s' pero este es '%s'",
                pc_name,
                HOSTNAME,
            )
            self._send_json_response(
                400,
                {
                    "ok": False,
                    "error": f"Esta petición es para {pc_name}, pero esta PC es {HOSTNAME}",
                },
            )
            return

        service = self.service_instance
        if service is None or drive_letter not in service.pending_usbs:
            LOGGER.warning(
                "Recibida petición de desbloqueo para %s pero no está en pendientes",
                drive_letter,
            )
            self._send_json_response(
                404,
                {
                    "ok": False,
                    "error": f"USB {drive_letter} no encontrado en pendientes",
                },
            )
            return

        LOGGER.info(
            "Recibida notificación HTTP para desbloquear %s en %s",
            drive_letter,
            pc_name,
        )

        pythoncom.CoInitialize()
        try:
            success = unlock_usb(drive_letter, service.wmi_connection)
        finally:
            pythoncom.CoUninitialize()

        if success:
            service.pending_usbs.pop(drive_letter, None)

            try:
                if SIGNAL_FILE.exists():
                    SIGNAL_FILE.unlink()
                    LOGGER.info("Archivo de señal limpiado")
            except Exception as exc:
                LOGGER.warning("Error al limpiar archivo de señal: %s", exc)

            self._send_json_response(
                200,
                {
                    "ok": True,
                    "message": f"USB {drive_letter} desbloqueado exitosamente",
                },
            )
            LOGGER.info("USB %s desbloqueado via HTTP exitosamente", drive_letter)
            return

        LOGGER.error("Fallo al desbloquear USB %s via HTTP", drive_letter)
        self._send_json_response(
            500,
            {"ok": False, "error": f"Fallo al desbloquear USB {drive_letter}"},
        )


class USBMonitorService(win32serviceutil.ServiceFramework):
    _svc_name_ = "USBMonitorService"
    _svc_display_name_ = "USB Monitor Service"
    _svc_description_ = (
        "Monitorea conexiones de dispositivos USB y notifica al servidor Monitor_USB"
    )

    def __init__(self, args):
        win32serviceutil.ServiceFramework.__init__(self, args)
        self.stop_event = win32event.CreateEvent(None, 0, 0, None)
        self.stopped = False
        self.pending_usbs: Dict[str, str] = {}  # {drive_letter: pc_name}
        self.wmi_connection = None  # Referencia a la conexión WMI
        self.http_server = None  # Servidor HTTP
        self.http_thread = None  # Thread del servidor HTTP
        self.started_at = time.time()
        self.listening_port: Optional[int] = None

    def SvcStop(self) -> None:
        self.ReportServiceStatus(win32service.SERVICE_STOP_PENDING)
        win32event.SetEvent(self.stop_event)
        self.stopped = True
        
        # Detener el servidor HTTP
        if self.http_server:
            try:
                LOGGER.info("Deteniendo servidor HTTP...")
                self.http_server.shutdown()
            except Exception as exc:
                LOGGER.error("Error al detener servidor HTTP: %s", exc)
        
        LOGGER.info("Solicitud de parada recibida")

    def SvcDoRun(self) -> None:
        LOGGER.info("╔════════════════════════════════════════════════════════════╗")
        LOGGER.info("║        SERVICIO USB MONITOR INICIADO                      ║")
        LOGGER.info("╚════════════════════════════════════════════════════════════╝")
        servicemanager.LogInfoMsg("USBMonitorService - iniciado")
        self.started_at = time.time()
        self.main()

    def main(self) -> None:
        LOGGER.info("Inicializando bucle principal del servicio")
        try:
            pythoncom.CoInitialize()
        except pythoncom.com_error as exc:
            LOGGER.error("No se pudo inicializar COM para el servicio: %s", exc)
            return
        hostname = HOSTNAME
        LOGGER.info("Hostname detectado para el servicio: %s", hostname)
        try:
            c = wmi.WMI()
            self.wmi_connection = c  # Guardar referencia para el HTTP handler
            watcher = c.watch_for(
                notification_type="Creation",
                wmi_class="Win32_VolumeChangeEvent",
                EventType=2,  # 2 => Device arrival
            )
            LOGGER.info("Watcher WMI inicializado para Win32_VolumeChangeEvent")
        except Exception as exc:
            LOGGER.error("No se pudo inicializar WMI: %s", exc)
            pythoncom.CoUninitialize()
            return

        # Iniciar servidor HTTP en un thread separado
        self.start_http_server()

        # Thread para monitorear desbloqueos autorizados (fallback polling)
        unlock_monitor_thread = threading.Thread(
            target=self.monitor_unlock_authorization,
            args=(c,),
            daemon=True
        )
        unlock_monitor_thread.start()
        LOGGER.info(
            "Thread de monitoreo de autorizaciones iniciado (id=%s)",
            unlock_monitor_thread.ident,
        )

        # Thread para monitorear USBs conectadas continuamente
        connected_monitor_thread = threading.Thread(
            target=self.monitor_connected_drives,
            args=(hostname,),
            daemon=True
        )
        connected_monitor_thread.start()
        LOGGER.info(
            "Thread de monitoreo de unidades conectadas iniciado (id=%s)",
            connected_monitor_thread.ident,
        )

        while not self.stopped:
            rc = win32event.WaitForSingleObject(self.stop_event, 500)
            if rc == win32event.WAIT_OBJECT_0:
                break

            try:
                event = watcher(timeout_ms=2000)
                if event:
                    LOGGER.info("═══ EVENTO DE INSERCIÓN DETECTADO ═══")
                    drive_letter = resolve_drive_letter(event, c)
                    LOGGER.info("  [1/5] Letra de unidad resuelta: %s", drive_letter or "NO ENCONTRADA")
                    
                    serial_number: Optional[str] = None
                    whitelist_entry: Optional[Dict[str, Any]] = None
                    whitelisted = False

                    if drive_letter:
                        LOGGER.info("  [2/5] Iniciando obtención de número de serie...")
                        for attempt in range(5):
                            try:
                                LOGGER.debug("    Intento %d/5: Consultando unidades USB conectadas", attempt + 1)
                                connected_drives = get_connected_usb_drives(c)
                                drive_info = find_drive_info_by_letter(
                                    connected_drives, drive_letter
                                )
                                if drive_info:
                                    candidate = drive_info.get("serialNumber")
                                    raw_value = drive_info.get("serialNumberRaw")
                                    LOGGER.debug("    Serial obtenido: %s | Serial crudo: %s", candidate, raw_value)
                                    
                                    # Intentar normalizar el candidato (que puede ser normalizado o crudo)
                                    normalized_candidate = normalize_serial_candidate(candidate)
                                    
                                    # Si falla, intentar con el raw
                                    if not normalized_candidate and raw_value:
                                        LOGGER.debug("    Candidato vacío, intentando desde raw...")
                                        normalized_candidate = normalize_serial_candidate(raw_value)
                                    
                                    if normalized_candidate:
                                        serial_number = normalized_candidate
                                        LOGGER.info("    ✓ Serial obtenido en intento %d/5: %s", attempt + 1, serial_number)
                                        break
                            except Exception as info_exc:
                                LOGGER.debug(
                                    "    Error en intento %d/5: %s",
                                    attempt + 1,
                                    info_exc,
                                )
                            if serial_number:
                                break
                            if attempt < 4:
                                time.sleep(0.4)

                    if not serial_number and drive_letter:
                        LOGGER.warning("  ✗ No se pudo determinar serial normalizado para %s tras 5 intentos", drive_letter)
                    elif serial_number:
                        LOGGER.info("  [2/5] ✓ Serial obtenido: %s", serial_number)

                    if serial_number:
                        LOGGER.info("  [3/5] Verificando whitelist para serial: %s", serial_number)
                        whitelisted, whitelist_entry = check_whitelist(serial_number)
                        if whitelisted:
                            LOGGER.info("  [3/5] ✓ AUTORIZADO EN WHITELIST")
                        else:
                            LOGGER.warning("  [3/5] ✗ NO AUTORIZADO - Serial no en whitelist")

                    if whitelisted:
                        LOGGER.info("  [4/5] Dispositivo está en whitelist, OMITIENDO BLOQUEO")
                        label = (
                            whitelist_entry.get("label")
                            if isinstance(whitelist_entry, dict)
                            else None
                        )
                        notes = (
                            whitelist_entry.get("notes")
                            if isinstance(whitelist_entry, dict)
                            else None
                        )
                        readonly_msg = "Whitelisted: acceso directo"
                        if label:
                            readonly_msg = f"{readonly_msg} ({label})"
                        if notes:
                            readonly_msg = f"{readonly_msg} - {notes}"
                        payload = build_payload(
                            event,
                            drive_letter,
                            readonly_msg,
                            serial_number,
                            True,
                        )
                        LOGGER.info("  [5/5] Enviando evento autorizado al backend")
                        send_event(payload)
                        if drive_letter:
                            normalized_letter = drive_letter.rstrip(":").upper()
                            self.pending_usbs.pop(drive_letter, None)
                            self.pending_usbs.pop(normalized_letter, None)
                            self.pending_usbs.pop(f"{normalized_letter}:", None)
                        LOGGER.info("═══ EVENTO COMPLETADO: USB AUTORIZADO ═══\n")
                        continue

                    # --- Proceso para dispositivos no autorizados ---
                    LOGGER.warning("═══ PROTOCOLO DE SEGURIDAD: DISPOSITIVO NO AUTORIZADO ═══")
                    LOGGER.warning("  Dispositivo: %s | Serial: %s", drive_letter or "desconocido", serial_number or "sin serial")
                    
                    # 1. Proteger USB con readonly
                    LOGGER.info("  [Paso 1/4] Aplicando modo SOLO LECTURA...")
                    letter_used, readonly_ok, readonly_msg = protect_usb_media(
                        drive_letter, c
                    )
                    if readonly_ok:
                        LOGGER.info("  [Paso 1/4] ✓ Modo solo lectura aplicado exitosamente a %s", letter_used)
                    else:
                        LOGGER.error("  [Paso 1/4] ✗ Fallo al aplicar modo solo lectura: %s", readonly_msg)

                    # 2. Enviar evento al backend
                    LOGGER.info("  [Paso 2/4] Notificando al backend del evento...")
                    payload = build_payload(
                        event,
                        letter_used,
                        readonly_msg,
                        serial_number,
                        False,
                    )
                    send_event(payload)
                    LOGGER.info("  [Paso 2/4] ✓ Evento enviado al backend")

                    # 3. Programar apagado del equipo
                    LOGGER.warning("  [Paso 3/4] Programando APAGADO del sistema...")
                    schedule_shutdown()
                    LOGGER.warning("  [Paso 3/4] ✓ Apagado programado en 3 segundos")

                    # 4. Crear señal para el agente local (si aplica)
                    if letter_used:
                        LOGGER.info("  [Paso 4/4] Creando registro de desbloqueo pendiente...")
                        create_browser_signal(hostname, letter_used)
                        create_pending_unlock(hostname, letter_used)
                        self.pending_usbs[letter_used] = hostname
                        LOGGER.info("  [Paso 4/4] ✓ Unidad %s añadida a pendientes de desbloqueo", letter_used)
                    else:
                        LOGGER.error("  [Paso 4/4] ✗ No se pudo determinar letra de unidad para pending unlock")
                    
                    LOGGER.warning("═══ PROTOCOLO DE SEGURIDAD COMPLETADO ═══\n")
                    
            except wmi.x_wmi_timed_out:
                continue
            except Exception as exc:
                LOGGER.error("Error en el loop principal: %s", exc)
                time.sleep(5)

        pythoncom.CoUninitialize()
        LOGGER.info("╔════════════════════════════════════════════════════════════╗")
        LOGGER.info("║        SERVICIO USB MONITOR DETENIDO                      ║")
        LOGGER.info("╚════════════════════════════════════════════════════════════╝")

    def start_http_server(self) -> None:
        """Inicia el servidor HTTP en un thread separado."""
        try:
            listen_port = get_listen_port()
            self.listening_port = listen_port
            
            # Configurar el handler con referencia al servicio
            UnlockHTTPHandler.service_instance = self
            
            # Crear el servidor HTTP
            self.http_server = HTTPServer(("0.0.0.0", listen_port), UnlockHTTPHandler)
            
            # Iniciar en un thread separado
            self.http_thread = threading.Thread(
                target=self.http_server.serve_forever,
                daemon=True
            )
            self.http_thread.start()
            
            LOGGER.info(
                "Servidor HTTP iniciado en puerto %s para recibir notificaciones",
                listen_port
            )
        except Exception as exc:
            LOGGER.error("Error al iniciar servidor HTTP: %s", exc)
            LOGGER.warning("El servicio continuará usando solo polling")

    def monitor_unlock_authorization(self, conn: wmi.WMI) -> None:
        """Monitorea periódicamente si hay USBs autorizados para desbloquear."""
        LOGGER.info("╔════════════════════════════════════════════════════════════╗")
        LOGGER.info("║ Thread de Monitoreo de Autorizaciones de Desbloqueo INICIADO ║")
        LOGGER.info("╚════════════════════════════════════════════════════════════╝")
        
        # Inicializar COM para este thread
        pythoncom.CoInitialize()
        
        try:
            pending_logged_empty = False
            while not self.stopped:
                try:
                    time.sleep(3)  # Verificar cada 3 segundos
                    
                    if not self.pending_usbs:
                        if not pending_logged_empty:
                            LOGGER.debug("  ℹ  Sin USBs pendientes en este momento")
                            pending_logged_empty = True
                        continue
                    else:
                        if pending_logged_empty:
                            LOGGER.info("  ℹ  Nuevos USBs pendientes detectados")
                        pending_logged_empty = False
                        LOGGER.debug(
                            "  ℹ  Pendientes actuales: %s",
                            list(self.pending_usbs.keys()),
                        )
                    
                    # Verificar estado de desbloqueo en el backend
                    pc_name = HOSTNAME
                    LOGGER.debug("  [Consulta] Verificando autorización en backend para: %s", pc_name)
                    unlocked, drive_letter = check_unlock_status(pc_name)
                    
                    if unlocked and drive_letter and drive_letter in self.pending_usbs:
                        # Desbloquear la unidad
                        LOGGER.info("  ✓ AUTORIZACIÓN RECIBIDA para %s", drive_letter)
                        LOGGER.info("    → Procediendo a desbloquear unidad...")
                        
                        success = unlock_usb(drive_letter, conn)
                        
                        if success:
                            # Remover de la lista de pendientes
                            self.pending_usbs.pop(drive_letter, None)
                            
                            # Limpiar archivo de señal
                            try:
                                if SIGNAL_FILE.exists():
                                    SIGNAL_FILE.unlink()
                                    LOGGER.info("    → Archivo de señal limpiado")
                            except Exception as e:
                                LOGGER.warning("    ⚠  Error al limpiar archivo de señal: %s", e)
                            
                            LOGGER.info(
                                "  ✓ USB %s desbloqueado exitosamente tras autorización",
                                drive_letter
                            )
                        else:
                            LOGGER.error(
                                "  ✗ Fallo al desbloquear USB %s tras autorización",
                                drive_letter
                            )
                    
                except Exception as exc:
                    LOGGER.error("  ✗ Error en monitoreo de autorizaciones: %s", exc)
                    time.sleep(5)
        finally:
            pythoncom.CoUninitialize()
            LOGGER.info("╔════════════════════════════════════════════════════════════╗")
            LOGGER.info("║ Thread de Monitoreo de Autorizaciones FINALIZADO           ║")
            LOGGER.info("╚════════════════════════════════════════════════════════════╝")

    def monitor_connected_drives(self, pc_name: str) -> None:
        """Monitorea periódicamente las unidades USB conectadas y envía el estado al backend."""
        LOGGER.info("╔════════════════════════════════════════════════════════════╗")
        LOGGER.info("║   Thread de Monitoreo de Unidades Conectadas INICIADO      ║")
        LOGGER.info("╚════════════════════════════════════════════════════════════╝")

        pythoncom.CoInitialize()
        conn: Optional[wmi.WMI] = None

        try:
            snapshot_signature: Optional[Tuple[Tuple[str, str, int], ...]] = None
            while not self.stopped:
                if conn is None:
                    try:
                        conn = wmi.WMI()
                        LOGGER.debug("  ✓ Conexión WMI establecida para monitoreo de unidades")
                    except Exception as exc:
                        LOGGER.error(
                            "  ✗ No se pudo crear conexión WMI: %s",
                            exc,
                        )
                        time.sleep(10)
                        continue

                try:
                    LOGGER.debug("  [Consulta] Obteniendo estado de unidades USB conectadas...")
                    connected_drives = get_connected_usb_drives(conn)
                    signature = tuple(
                        sorted(
                            (
                                str(item.get("driveLetter", "")),
                                str(item.get("serialNumber", "")),
                                int(item.get("size", 0)),
                            )
                            for item in connected_drives
                        )
                    )

                    if signature == snapshot_signature:
                        LOGGER.debug(
                            "  [Estado Conectadas] Sin cambios desde el último reporte"
                        )
                    else:
                        snapshot_signature = signature
                        sent = send_connected_drives_status(pc_name, conn, connected_drives)
                        if not sent:
                            LOGGER.debug(
                                "  ⚠  No se actualizó el estado de unidades para %s",
                                pc_name,
                            )
                    if not connected_drives:
                        LOGGER.debug(
                            "  [Estado Conectadas] No hay unidades activas en %s",
                            pc_name,
                        )
                except Exception as exc:
                    LOGGER.error(
                        "  ✗ Error al obtener/enviar unidades conectadas: %s",
                        exc,
                    )
                    conn = None

                time.sleep(20)
        finally:
            conn = None
            pythoncom.CoUninitialize()
            LOGGER.info("╔════════════════════════════════════════════════════════════╗")
            LOGGER.info("║   Thread de Monitoreo de Unidades Conectadas FINALIZADO   ║")
            LOGGER.info("╚════════════════════════════════════════════════════════════╝")


SERVICE_STATE_LABELS: Dict[int, str] = {
    win32service.SERVICE_STOPPED: "Detenido",
    win32service.SERVICE_START_PENDING: "Iniciando...",
    win32service.SERVICE_STOP_PENDING: "Deteniendo...",
    win32service.SERVICE_RUNNING: "En ejecución",
    win32service.SERVICE_CONTINUE_PENDING: "Reanudando...",
    win32service.SERVICE_PAUSE_PENDING: "Pausando...",
    win32service.SERVICE_PAUSED: "Pausado",
}


def _query_service_state() -> Tuple[Optional[int], str]:
    try:
        status = win32serviceutil.QueryServiceStatus(USBMonitorService._svc_name_)
    except Exception as exc:  # pragma: no cover - depende del sistema
        win_err = getattr(exc, "winerror", None)
        if win_err == getattr(winerror, "ERROR_SERVICE_DOES_NOT_EXIST", 1060):
            LOGGER.warning("Consulta de estado: servicio no instalado")
            return None, "No instalado"
        LOGGER.error("Error consultando estado del servicio: %s", exc)
        return None, f"Error: {exc}"

    state = status[1]
    description = SERVICE_STATE_LABELS.get(state, f"Estado desconocido ({state})")
    LOGGER.debug("Estado del servicio consultado: %s (%s)", state, description)
    return state, description


def _merge_process_output(stdout: Optional[str], stderr: Optional[str]) -> str:
    fragments = []
    if stdout:
        stdout = stdout.strip()
        if stdout:
            fragments.append(stdout)
    if stderr:
        stderr = stderr.strip()
        if stderr:
            fragments.append(stderr)
    return "\n".join(fragments)


def _build_service_command(command: str) -> list[str]:
    if getattr(sys, "frozen", False):
        return [sys.executable, command]
    return [sys.executable, str(Path(__file__).resolve()), command]


def _format_win_error(exc: Exception) -> str:
    win_err = getattr(exc, "winerror", None)
    if win_err is not None:
        description = getattr(exc, "strerror", None)
        if description:
            return f"[WinError {win_err}] {description}"
        return f"[WinError {win_err}] {exc}"
    return str(exc)


def _wait_for_state(target_state: int, timeout: int = 45) -> bool:
    deadline = time.time() + timeout
    LOGGER.debug(
        "Esperando estado %s (timeout=%ss)",
        SERVICE_STATE_LABELS.get(target_state, target_state),
        timeout,
    )
    while time.time() < deadline:
        state, _ = _query_service_state()
        if state == target_state:
            LOGGER.debug("Estado objetivo alcanzado: %s", target_state)
            return True
        time.sleep(0.5)
    LOGGER.warning(
        "Timeout esperando estado %s tras %ss",
        SERVICE_STATE_LABELS.get(target_state, target_state),
        timeout,
    )
    return False


def _control_service_direct(command: str, timeout: int = 45) -> Tuple[bool, str]:
    state, description = _query_service_state()

    if state is None:
        LOGGER.warning(
            "No se puede ejecutar '%s' porque el estado actual es desconocido: %s",
            command,
            description,
        )
        return False, description

    try:
        if command == "start":
            if state == win32service.SERVICE_RUNNING:
                LOGGER.info("Comando start solicitado, pero el servicio ya está en ejecución")
                return True, "El servicio ya está en ejecución."
            LOGGER.info("Intentando iniciar servicio (estado actual: %s)", description)
            win32serviceutil.StartService(USBMonitorService._svc_name_)
            if _wait_for_state(win32service.SERVICE_RUNNING, timeout):
                LOGGER.info("Servicio marcado como en ejecución tras comando start")
                return True, "Servicio iniciado correctamente."
            state, description = _query_service_state()
            LOGGER.error(
                "No se confirmó el arranque del servicio tras start. Estado actual: %s",
                description,
            )
            return False, (
                "No se pudo confirmar el arranque del servicio. "
                f"Estado actual: {description}"
            )

        if command == "stop":
            if state == win32service.SERVICE_STOPPED:
                LOGGER.info("Comando stop solicitado, pero el servicio ya está detenido")
                return True, "El servicio ya está detenido."
            LOGGER.info("Intentando detener servicio (estado actual: %s)", description)
            win32serviceutil.StopService(USBMonitorService._svc_name_)
            if _wait_for_state(win32service.SERVICE_STOPPED, timeout):
                LOGGER.info("Servicio marcado como detenido tras comando stop")
                return True, "Servicio detenido correctamente."
            state, description = _query_service_state()
            LOGGER.error(
                "No se confirmó la detención del servicio tras stop. Estado actual: %s",
                description,
            )
            return False, (
                "No se pudo confirmar la detención del servicio. "
                f"Estado actual: {description}"
            )

        if command == "restart":
            LOGGER.info("Intentando reiniciar servicio")
            win32serviceutil.RestartService(USBMonitorService._svc_name_)
            if _wait_for_state(win32service.SERVICE_RUNNING, timeout):
                LOGGER.info("Servicio marcado como en ejecución tras comando restart")
                return True, "Servicio reiniciado correctamente."
            state, description = _query_service_state()
            LOGGER.error(
                "No se confirmó el reinicio del servicio. Estado actual: %s",
                description,
            )
            return False, (
                "No se pudo confirmar el reinicio del servicio. "
                f"Estado actual: {description}"
            )
    except Exception as exc:  # pragma: no cover - depende del sistema
        LOGGER.error("Excepción al ejecutar comando directo '%s': %s", command, exc)
        return False, _format_win_error(exc)

    return False, f"Comando '{command}' no soportado."


def _execute_service_command(command: str, timeout: int = 45) -> Tuple[bool, str]:
    if command in {"start", "stop", "restart"}:
        LOGGER.info("Ejecutando comando directo de servicio: %s", command)
        return _control_service_direct(command, timeout)

    env = os.environ.copy()
    env["USB_MONITOR_SILENT"] = "0"
    resolved_cmd = _build_service_command(command)
    LOGGER.info("Ejecutando comando de línea del servicio: %s", resolved_cmd)
    try:
        result = subprocess.run(
            resolved_cmd,
            check=True,
            capture_output=True,
            text=True,
            encoding='cp850',  # Codificación de consola de Windows
            env=env,
            timeout=timeout,
        )
    except subprocess.CalledProcessError as exc:
        LOGGER.error(
            "Comando '%s' devolvió código %s. Stdout: %s | Stderr: %s",
            command,
            exc.returncode,
            exc.stdout,
            exc.stderr,
        )
        message = _merge_process_output(exc.stdout, exc.stderr)
        if not message:
            message = f"Error al ejecutar '{command}'. Código: {exc.returncode}"
        return False, message
    except subprocess.TimeoutExpired as exc:
        LOGGER.error("Timeout ejecutando comando '%s' tras %ss", command, timeout)
        try:
            exc.process.kill()
        except Exception:
            pass
        stdout, stderr = exc.process.communicate()
        message = _merge_process_output(stdout, stderr)

        state, description = _query_service_state()
        if command == "start" and state == win32service.SERVICE_RUNNING:
            extra = (
                "El comando 'start' excedió el tiempo de espera, "
                "pero el servicio reporta estado en ejecución."
            )
            LOGGER.warning("Timeout de start pero el servicio aparece en ejecución")
            if message:
                message = f"{message}\n{extra}"
            else:
                message = extra
            return True, message

        if command == "stop" and state == win32service.SERVICE_STOPPED:
            extra = (
                "El comando 'stop' excedió el tiempo de espera, "
                "pero el servicio aparece detenido."
            )
            LOGGER.warning("Timeout de stop pero el servicio aparece detenido")
            if message:
                message = f"{message}\n{extra}"
            else:
                message = extra
            return True, message

        if not message:
            message = (
                f"El comando '{command}' excedió el tiempo de espera de {timeout} s."
            )
        return False, message
    except Exception as exc:
        LOGGER.exception("Excepción inesperada ejecutando comando '%s'", command)
        return False, str(exc)

    message = _merge_process_output(result.stdout, result.stderr)
    if not message:
        message = f"Comando '{command}' ejecutado correctamente."
    LOGGER.info("Comando '%s' ejecutado correctamente", command)
    return True, message


def _set_service_autostart() -> Tuple[bool, str]:
    try:
        scm_handle = win32service.OpenSCManager(
            None,
            None,
            win32service.SC_MANAGER_CONNECT,
        )
    except pywintypes.error as exc:
        LOGGER.error("No se pudo abrir el Service Control Manager: %s", exc)
        return False, _format_win_error(exc)
    except Exception as exc:  # pragma: no cover - acceso dependiente del sistema
        LOGGER.error("Error inesperado abriendo el Service Control Manager: %s", exc)
        return False, str(exc)

    service_handle = None
    try:
        desired_access = win32service.SERVICE_CHANGE_CONFIG | win32service.SERVICE_QUERY_CONFIG
        service_handle = win32service.OpenService(
            scm_handle,
            USBMonitorService._svc_name_,
            desired_access,
        )
    except pywintypes.error as exc:
        win_err = getattr(exc, "winerror", None)
        if win_err == getattr(winerror, "ERROR_SERVICE_DOES_NOT_EXIST", 1060):
            LOGGER.warning("No se puede configurar arranque: servicio no instalado")
            win32service.CloseServiceHandle(scm_handle)
            return False, "El servicio no está instalado todavía."
        LOGGER.error("Error al abrir el servicio para cambiar configuración: %s", exc)
        win32service.CloseServiceHandle(scm_handle)
        return False, _format_win_error(exc)
    except Exception as exc:  # pragma: no cover
        LOGGER.error("Error inesperado al abrir el servicio: %s", exc)
        win32service.CloseServiceHandle(scm_handle)
        return False, str(exc)

    try:
        current_config = win32service.QueryServiceConfig(service_handle)
        current_start_type = current_config[1] if len(current_config) > 1 else None
        if current_start_type == win32service.SERVICE_AUTO_START:
            LOGGER.info("El servicio ya está configurado para inicio automático")
            return True, "El servicio ya está configurado para iniciar automáticamente."

        win32service.ChangeServiceConfig(
            service_handle,
            win32service.SERVICE_NO_CHANGE,
            win32service.SERVICE_AUTO_START,
            win32service.SERVICE_NO_CHANGE,
            None,
            None,
            0,
            None,
            None,
            None,
            None,
        )
        LOGGER.info("Servicio configurado para inicio automático")
        return True, "Servicio configurado para iniciar automáticamente al encender el equipo."
    except pywintypes.error as exc:
        LOGGER.error("No se pudo cambiar el tipo de inicio del servicio: %s", exc)
        return False, _format_win_error(exc)
    except Exception as exc:  # pragma: no cover
        LOGGER.error("Error inesperado al cambiar tipo de inicio: %s", exc)
        return False, str(exc)
    finally:
        if service_handle is not None:
            win32service.CloseServiceHandle(service_handle)
        win32service.CloseServiceHandle(scm_handle)


def _get_service_autostart_status() -> Tuple[bool, Optional[int]]:
    """Retorna (success, start_type) donde start_type puede ser SERVICE_AUTO_START, SERVICE_DEMAND_START, etc."""
    try:
        scm_handle = win32service.OpenSCManager(
            None,
            None,
            win32service.SC_MANAGER_CONNECT,
        )
    except Exception as exc:
        LOGGER.error("No se pudo abrir el Service Control Manager: %s", exc)
        return False, None

    service_handle = None
    try:
        service_handle = win32service.OpenService(
            scm_handle,
            USBMonitorService._svc_name_,
            win32service.SERVICE_QUERY_CONFIG,
        )
        current_config = win32service.QueryServiceConfig(service_handle)
        start_type = current_config[1] if len(current_config) > 1 else None
        return True, start_type
    except Exception as exc:
        LOGGER.error("Error al consultar configuración del servicio: %s", exc)
        return False, None
    finally:
        if service_handle is not None:
            win32service.CloseServiceHandle(service_handle)
        win32service.CloseServiceHandle(scm_handle)


def _toggle_service_autostart() -> Tuple[bool, str]:
    """Alterna el inicio automático del servicio (lo activa si está desactivado, lo desactiva si está activado)."""
    success, current_start_type = _get_service_autostart_status()
    if not success:
        return False, "No se pudo consultar el estado del servicio."
    
    try:
        scm_handle = win32service.OpenSCManager(
            None,
            None,
            win32service.SC_MANAGER_CONNECT,
        )
    except Exception as exc:
        LOGGER.error("No se pudo abrir el Service Control Manager: %s", exc)
        return False, _format_win_error(exc)

    service_handle = None
    try:
        desired_access = win32service.SERVICE_CHANGE_CONFIG | win32service.SERVICE_QUERY_CONFIG
        service_handle = win32service.OpenService(
            scm_handle,
            USBMonitorService._svc_name_,
            desired_access,
        )
    except pywintypes.error as exc:
        win_err = getattr(exc, "winerror", None)
        if win_err == getattr(winerror, "ERROR_SERVICE_DOES_NOT_EXIST", 1060):
            msg = "El servicio no está instalado. Instálalo primero."
            LOGGER.warning("%s", msg)
            win32service.CloseServiceHandle(scm_handle)
            return False, msg
        LOGGER.error("Error al abrir el servicio: %s", exc)
        win32service.CloseServiceHandle(scm_handle)
        return False, _format_win_error(exc)
    except Exception as exc:
        LOGGER.error("Error inesperado al abrir el servicio: %s", exc)
        win32service.CloseServiceHandle(scm_handle)
        return False, str(exc)

    try:
        # Determinar el nuevo estado
        if current_start_type == win32service.SERVICE_AUTO_START:
            new_start_type = win32service.SERVICE_DEMAND_START
            action = "manual"
        else:
            new_start_type = win32service.SERVICE_AUTO_START
            action = "automático"

        win32service.ChangeServiceConfig(
            service_handle,
            win32service.SERVICE_NO_CHANGE,
            new_start_type,
            win32service.SERVICE_NO_CHANGE,
            None,
            None,
            0,
            None,
            None,
            None,
            None,
        )
        msg = f"Servicio configurado para inicio {action}."
        LOGGER.info(msg)
        return True, msg
    except pywintypes.error as exc:
        LOGGER.error("No se pudo cambiar el tipo de inicio del servicio: %s", exc)
        return False, _format_win_error(exc)
    except Exception as exc:
        LOGGER.error("Error inesperado al cambiar tipo de inicio: %s", exc)
        return False, str(exc)
    finally:
        if service_handle is not None:
            win32service.CloseServiceHandle(service_handle)
        win32service.CloseServiceHandle(scm_handle)


def _set_server_host(new_host: str) -> Tuple[bool, str]:
    value = (new_host or "").strip()
    if not value:
        return False, "El valor de la IP/host no puede estar vacío."

    if len(value) > 512:
        return False, "El valor ingresado es demasiado largo."

    try:
        completed = subprocess.run(
            ["setx", "USB_MONITOR_SERVER_HOST", value, "/M"],
            capture_output=True,
            text=True,
            encoding='cp850',  # Codificación de consola de Windows en español
            check=True,
        )
    except FileNotFoundError:
        LOGGER.error("setx no está disponible en este sistema")
        return False, "No se encontró la utilidad setx."
    except subprocess.CalledProcessError as exc:
        LOGGER.error("setx devolvió un error al configurar USB_MONITOR_SERVER_HOST: %s", exc)
        message = _merge_process_output(exc.stdout, exc.stderr)
        if not message:
            message = f"setx devolvió el código {exc.returncode}."
        return False, message
    except Exception as exc:  # pragma: no cover
        LOGGER.error("Error inesperado ejecutando setx: %s", exc)
        return False, str(exc)

    os.environ["USB_MONITOR_SERVER_HOST"] = value
    output_message = _merge_process_output(completed.stdout, completed.stderr)
    if output_message:
        output_message += "\n"
    output_message += (
        f"Host del backend actualizado a '{value}'. Reinicia el servicio para aplicar los cambios."
    )
    LOGGER.info("USB_MONITOR_SERVER_HOST actualizado a %s", value)
    return True, output_message


def _toggle_server_scheme() -> Tuple[bool, str]:
    """Alterna USB_MONITOR_SERVER_SCHEME entre http y https y persiste con setx."""
    current = (os.environ.get("USB_MONITOR_SERVER_SCHEME", "https") or "").lower().strip()
    new_value = "http" if current == "https" else "https"
    try:
        completed = subprocess.run(
            ["setx", "USB_MONITOR_SERVER_SCHEME", new_value, "/M"],
            capture_output=True,
            text=True,
            encoding='cp850',
            check=True,
        )
    except FileNotFoundError:
        LOGGER.error("setx no está disponible en este sistema")
        return False, "No se encontró la utilidad setx."
    except subprocess.CalledProcessError as exc:
        LOGGER.error("setx devolvió un error al configurar USB_MONITOR_SERVER_SCHEME: %s", exc)
        message = _merge_process_output(exc.stdout, exc.stderr)
        if not message:
            message = f"setx devolvió el código {exc.returncode}."
        return False, message
    except Exception as exc:
        LOGGER.error("Error inesperado ejecutando setx: %s", exc)
        return False, str(exc)

    os.environ["USB_MONITOR_SERVER_SCHEME"] = new_value
    output_message = _merge_process_output(completed.stdout, completed.stderr)
    if output_message:
        output_message += "\n"
    output_message += (
        f"Esquema del backend actualizado a '{new_value.upper()}'. Reinicia el servicio para aplicar los cambios."
    )
    LOGGER.info("USB_MONITOR_SERVER_SCHEME actualizado a %s", new_value)
    return True, output_message


def _toggle_ssl_verify() -> Tuple[bool, str]:
    """Alterna USB_MONITOR_SSL_VERIFY entre 'true' y 'false' y persiste con setx."""
    current = (os.environ.get("USB_MONITOR_SSL_VERIFY", "true") or "").lower().strip()
    new_value = "false" if current == "true" else "true"
    try:
        completed = subprocess.run(
            ["setx", "USB_MONITOR_SSL_VERIFY", new_value, "/M"],
            capture_output=True,
            text=True,
            encoding='cp850',
            check=True,
        )
    except FileNotFoundError:
        LOGGER.error("setx no está disponible en este sistema")
        return False, "No se encontró la utilidad setx."
    except subprocess.CalledProcessError as exc:
        LOGGER.error("setx devolvió un error al configurar USB_MONITOR_SSL_VERIFY: %s", exc)
        message = _merge_process_output(exc.stdout, exc.stderr)
        if not message:
            message = f"setx devolvió el código {exc.returncode}."
        return False, message
    except Exception as exc:
        LOGGER.error("Error inesperado ejecutando setx: %s", exc)
        return False, str(exc)

    os.environ["USB_MONITOR_SSL_VERIFY"] = new_value
    output_message = _merge_process_output(completed.stdout, completed.stderr)
    if output_message:
        output_message += "\n"
    output_message += (
        "Verificación SSL {}. Reinicia el servicio para aplicar los cambios.".format(
            "DESACTIVADA" if new_value == "false" else "ACTIVADA"
        )
    )
    LOGGER.info("USB_MONITOR_SSL_VERIFY actualizado a %s", new_value)
    return True, output_message


def run_gui() -> None:
    root = tk.Tk()
    root.title("USB Monitor Service")
    root.resizable(False, False)

    icon_path = get_app_directory() / "usb_monitor_service.ico"
    if icon_path.exists():
        try:
            root.iconbitmap(default=str(icon_path))
        except Exception:
            pass

    root.columnconfigure(0, weight=1)
    root.rowconfigure(0, weight=1)

    container = ttk.Frame(root, padding=16)
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
        foreground="#666666",
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
        foreground="#666666",
        wraplength=360,
    )
    scheme_status_label.pack(anchor="w")

    ssl_status_label = ttk.Label(
        scheme_ssl_frame,
        textvariable=ssl_status_var,
        font=("Segoe UI", 9),
        foreground="#666666",
        wraplength=360,
    )
    ssl_status_label.pack(anchor="w")

    info_label = ttk.Label(
        container,
        text="Ejecuta esta herramienta como administrador para instalar o controlar el servicio.",
        wraplength=360,
        foreground="#444444",
    )
    info_label.grid(row=3, column=0, columnspan=2, pady=(6, 10), sticky="w")

    log_box = ScrolledText(container, height=8, width=52, state="disabled", wrap="word")
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
            status_label.configure(foreground="#0A7F2E")
        elif state == win32service.SERVICE_STOPPED:
            status_label.configure(foreground="#B22222")
        elif state is None:
            status_label.configure(foreground="#B22222")
        else:
            status_label.configure(foreground="#BB8400")
        
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
        scheme = os.environ.get("USB_MONITOR_SERVER_SCHEME", "https").lower()
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

    refresh_button = ttk.Button(container, text="Actualizar estado", command=update_status)
    refresh_button.grid(row=9, column=0, columnspan=2, pady=(8, 0), sticky="ew")

    append_log("Interfaz iniciada.")
    update_status()

    def periodic_status_refresh() -> None:
        update_status()
        root.after(5000, periodic_status_refresh)

    root.after(5000, periodic_status_refresh)

    root.mainloop()


if __name__ == "__main__":
    ensure_admin_or_exit()

    def _run_command_line(command: str) -> None:
        silent_requested = os.environ.get("USB_MONITOR_SILENT", "1") == "1"
        should_silence = (
            getattr(sys, "frozen", False)
            and command != "debug"
            and silent_requested
        )

        if should_silence:
            with open(os.devnull, "w", encoding="utf-8") as devnull:
                with redirect_stdout(devnull), redirect_stderr(devnull):
                    win32serviceutil.HandleCommandLine(USBMonitorService)
        else:
            win32serviceutil.HandleCommandLine(USBMonitorService)

    def _launch_gui() -> None:
        try:
            run_gui()
        except Exception as exc:  # pragma: no cover - gui solo en Windows con Tk
            LOGGER.error("Error al iniciar la interfaz gráfica: %s", exc)
            print("No se pudo iniciar la interfaz gráfica. Ejecuta con 'debug' para más detalles.")

    args = [arg.lower() for arg in sys.argv[1:]]

    if args and args[0] in {"gui", "--gui"}:
        _launch_gui()
    elif args:
        _run_command_line(args[0])
    else:
        LOGGER.info("Sin argumentos: intentando iniciar como servicio")
        try:
            servicemanager.Initialize()
            servicemanager.PrepareToHostSingle(USBMonitorService)
            servicemanager.StartServiceCtrlDispatcher()
        except Exception as exc:
            if getattr(exc, "winerror", None) == 1063:
                LOGGER.info(
                    "Dispatcher no disponible (WinError 1063). Ejecutando interfaz gráfica en modo interactivo."
                )
                _launch_gui()
            else:
                LOGGER.critical(
                    "Error al iniciar el dispatcher del servicio: %s",
                    exc,
                    exc_info=True,
                )
                raise
