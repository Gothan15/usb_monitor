#!/usr/bin/env python3
"""
Simple Tkinter GUI to pick an API key from the database and set the system wide
USB_MONITOR_API_KEY variable. Intended to be packaged as a Windows executable.
"""
from __future__ import annotations

import ctypes
import os
import subprocess
import sys
import tkinter as tk
from tkinter import messagebox, ttk
from typing import Any, Dict, List, Optional
from urllib.parse import parse_qs, urlparse

try:  # Prefer psycopg 3 if available
    import psycopg
    from psycopg.rows import dict_row

    DB_DRIVER = "psycopg"
except ImportError:  # Fallback to psycopg2
    psycopg = None
    try:
        import psycopg2
        from psycopg2.extras import RealDictCursor

        DB_DRIVER = "psycopg2"
    except ImportError:  # No supported driver
        psycopg2 = None
        DB_DRIVER = None

WINDOW_TITLE = "USB Monitor - Configurar API Key"
TREE_COLUMNS = (
    "username",
    "role",
    "api_key",
    "computer",
    "ip_address",
    "status",
    "created_at",
)

DATABASE_URL = "postgresql://usb_app:usbapp123@localhost:5432/monitor_usb?schema=public"


class DatabaseConfig:
    """Stores parsed connection parameters."""

    def __init__(self, user: str, password: str, host: str, port: int, database: str, options: Optional[str]):
        self.user = user
        self.password = password
        self.host = host
        self.port = port
        self.database = database
        self.options = options


class DatabaseClient:
    """Thin wrapper over psycopg/psycopg2 to fetch users."""

    def __init__(self, config: DatabaseConfig):
        self.config = config
        self.conn = None

    def connect(self) -> None:
        if DB_DRIVER is None:
            raise RuntimeError(
                "No database driver found. Install psycopg[binary] or psycopg2-binary before running this tool."
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
        if DB_DRIVER == "psycopg":
            self.conn = psycopg.connect(row_factory=dict_row, **connect_args)
        else:
            self.conn = psycopg2.connect(**connect_args)

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
        if DB_DRIVER == "psycopg":
            with self.conn.cursor() as cur:  # type: ignore[attr-defined]
                cur.execute(query)
                rows = cur.fetchall()
        else:
            with self.conn.cursor(cursor_factory=RealDictCursor) as cur:  # type: ignore[name-defined]
                cur.execute(query)
                rows = cur.fetchall()
        result: List[Dict[str, Any]] = []
        for row in rows:
            # psycopg already gives dict rows; psycopg2 returns RealDictRow
            record = dict(row)
            result.append(
                {
                    "id": record.get("id"),
                    "username": record.get("username"),
                    "apiKey": record.get("apiKey"),
                    "role": record.get("role"),
                    "createdAt": record.get("createdAt"),
                    "computer": record.get("computer_name"),
                    "ipAddress": record.get("ip_address"),
                    "isActive": record.get("is_active"),
                }
            )
        return result

    def close(self) -> None:
        if self.conn is not None:
            self.conn.close()
            self.conn = None


class ApiKeyConfiguratorApp(tk.Tk):
    """Tkinter application that shows the user list and sets the API key."""

    def __init__(self, db_client: DatabaseClient):
        super().__init__()
        self.db_client = db_client
        self.users: Dict[str, Dict[str, Any]] = {}
        self.title(WINDOW_TITLE)
        self.geometry("940x520")
        self.resizable(True, True)
        self._build_widgets()
        self._populate_users()
        self.protocol("WM_DELETE_WINDOW", self._on_close)

    def _build_widgets(self) -> None:
        header = ttk.Label(self, text="Selecciona un usuario para usar su API key.")
        header.pack(pady=(10, 5))

        columns_frame = ttk.Frame(self)
        columns_frame.pack(fill=tk.BOTH, expand=True, padx=12, pady=5)

        self.tree = ttk.Treeview(columns_frame, columns=TREE_COLUMNS, show="headings", height=16)
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

        self.status_var = tk.StringVar(value="Listo.")
        status_label = ttk.Label(self, textvariable=self.status_var, anchor=tk.W)
        status_label.pack(fill=tk.X, padx=12, pady=(0, 12))

    def _populate_users(self) -> None:
        try:
            records = self.db_client.fetch_users()
        except Exception as exc:  # pragma: no cover
            self._set_status(f"Error al cargar usuarios: {exc}")
            messagebox.showerror("Error", f"No se pudieron cargar los usuarios.\n\nDetalles: {exc}")
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
                record.get("apiKey", ""),
                computer,
                ip_address,
                status,
                created_at,
            )
            item_id = self.tree.insert("", tk.END, values=item_values)
            self.users[item_id] = record
        self._set_status(f"Usuarios cargados: {len(records)}")

    def _handle_refresh(self) -> None:
        self._set_status("Actualizando usuarios...")
        self.after(50, self._populate_users)

    def _handle_apply(self) -> None:
        selection = self.tree.selection()
        if not selection:
            messagebox.showinfo("Seleccion requerida", "Selecciona un usuario primero.")
            return
        item_id = selection[0]
        record = self.users.get(item_id)
        if not record:
            messagebox.showerror("Error", "No se pudo recuperar la informacion del usuario.")
            return
        api_key = record.get("apiKey")
        username = record.get("username", "")
        if not api_key:
            messagebox.showerror("Error", "El usuario seleccionado no tiene API key disponible.")
            return
        confirm = messagebox.askyesno(
            "Confirmar",
            f"Se configurara la API key del usuario '{username}'.\n\nContinuar?",
        )
        if not confirm:
            return
        try:
            run_setx(api_key)
        except subprocess.CalledProcessError as exc:
            messagebox.showerror(
                "Error",
                "Fallo al ejecutar setx. Revisa que tengas permisos de administrador.\n\n"
                f"Codigo de salida: {exc.returncode}\nSalida: {exc.stderr}",
            )
            self._set_status("Error al configurar la API key.")
            return
        except Exception as exc:  # pragma: no cover
            messagebox.showerror("Error", f"No se pudo configurar la API key.\n\nDetalles: {exc}")
            self._set_status("Error al configurar la API key.")
            return
        self._set_status(f"API key configurada para {username}. Reinicia el servicio para aplicar cambios.")
        messagebox.showinfo(
            "Exito",
            "API key configurada correctamente. Reinicia el servicio USBMonitorService para aplicar cambios.",
        )

    def _on_close(self) -> None:
        self.destroy()

    def _set_status(self, message: str) -> None:
        self.status_var.set(message)

    @staticmethod
    def _format_timestamp(value: Any) -> str:
        if value is None:
            return "-"
        return str(value)


def run_setx(api_key: str) -> None:
    env_name = "USB_MONITOR_API_KEY"
    completed = subprocess.run(
        ["setx", env_name, api_key, "/M"],
        capture_output=True,
        text=True,
        check=True,
    )
    if completed.stdout:
        print(completed.stdout.strip())
    if completed.stderr:
        print(completed.stderr.strip(), file=sys.stderr)


def is_user_admin() -> bool:
    if os.name != "nt":
        return True
    try:
        return bool(ctypes.windll.shell32.IsUserAnAdmin())
    except Exception:
        return False


def show_error_dialog(title: str, message: str) -> None:
    root = tk.Tk()
    root.withdraw()
    messagebox.showerror(title, message)
    root.destroy()


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
    return DatabaseConfig(user=user, password=password, host=host, port=port, database=database, options=options)


def main() -> int:
    if not is_user_admin():
        show_error_dialog(
            "Permisos requeridos",
            "Ejecuta esta herramienta como administrador para poder escribir variables de entorno de sistema.",
        )
        return 1
    try:
        config = parse_database_url(DATABASE_URL)
    except Exception as exc:
        show_error_dialog("Configuracion invalida", f"No se pudo obtener la cadena de conexion.\n\nDetalles: {exc}")
        return 1
    client = DatabaseClient(config)
    try:
        client.connect()
    except Exception as exc:
        show_error_dialog(
            "Conexion fallida",
            "No se pudo conectar a la base de datos.\n\nRevisa DATABASE_URL y que la base de datos este en ejecucion.\n\n"
            f"Detalles: {exc}",
        )
        return 1
    app = ApiKeyConfiguratorApp(client)
    try:
        app.mainloop()
    finally:
        client.close()
    return 0


if __name__ == "__main__":
    sys.exit(main())
