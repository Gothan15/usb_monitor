"""USB Monitor Agent - Aplicación de Usuario

Agente de usuario para el sistema USB Monitor que muestra un formulario
de login cuando el servicio detecta una unidad USB y requiere autenticación.

Esta aplicación:
- Se ejecuta en segundo plano en la bandeja del sistema
- Monitorea señales del servicio USB Monitor
- Muestra un formulario de login cuando se detecta un USB
- Valida las credenciales con el servidor
- Permite o deniega el desbloqueo de la unidad USB

Requisitos:
    pip install pillow pystray requests

Uso:
    python usb_monitor_agent.py

Para instalar al inicio de Windows:
    python install_agent.py install
"""
from __future__ import annotations

import json
import logging
import os
import socket
import sys
import threading
import time
import tkinter as tk
from pathlib import Path
from tkinter import messagebox, ttk
from typing import Any, Dict, Optional

try:
    import pystray
    from PIL import Image, ImageDraw
    TRAY_AVAILABLE = True
except ImportError:
    TRAY_AVAILABLE = False
    print("ADVERTENCIA: pystray no disponible. Instalar con: pip install pillow pystray")

import requests


# Configuración
DEFAULT_HOST = "172.20.10.12"
DEFAULT_PORT = 3000
SIGNAL_FILE = Path("C:/ProgramData/USBMonitor/browser_signal.json")
LOG_FILE = Path("C:/ProgramData/USBMonitor/agent.log")
HOSTNAME = (socket.gethostname() or "").strip().upper() or "UNKNOWN_HOST"


def setup_logger() -> logging.Logger:
    """Configura el logger de la aplicación."""
    LOG_FILE.parent.mkdir(parents=True, exist_ok=True)
    logger = logging.getLogger("usb_monitor_agent")
    if not logger.handlers:
        logger.setLevel(logging.INFO)
        handler = logging.FileHandler(LOG_FILE, encoding="utf-8")
        formatter = logging.Formatter(
            "%(asctime)s | %(levelname)s | %(message)s",
            datefmt="%Y-%m-%d %H:%M:%S",
        )
        handler.setFormatter(formatter)
        logger.addHandler(handler)
        
        # También log en consola
        console_handler = logging.StreamHandler()
        console_handler.setFormatter(formatter)
        logger.addHandler(console_handler)
    return logger


LOGGER = setup_logger()


def get_server_host() -> str:
    """Obtiene el host del servidor desde variables de entorno."""
    return os.environ.get("USB_MONITOR_SERVER_HOST", DEFAULT_HOST)


def get_server_port() -> int:
    """Obtiene el puerto del servidor desde variables de entorno."""
    try:
        return int(os.environ.get("USB_MONITOR_SERVER_PORT", str(DEFAULT_PORT)))
    except ValueError:
        return DEFAULT_PORT


def build_url(endpoint: str) -> str:
    """Construye la URL completa del endpoint."""
    host = get_server_host()
    port = get_server_port()
    return f"http://{host}:{port}{endpoint}"


def get_auth_headers() -> Dict[str, str]:
    """Obtiene los headers de autenticación."""
    headers: Dict[str, str] = {}
    api_key = os.environ.get("USB_MONITOR_API_KEY")
    if api_key:
        headers["Authorization"] = f"ApiKey {api_key}"
    return headers


class LoginWindow:
    """Ventana de login para autenticación del usuario."""
    
    def __init__(self, pc_name: str, drive_letter: str, on_success_callback, on_cancel_callback):
        self.pc_name = pc_name
        self.drive_letter = drive_letter
        self.on_success = on_success_callback
        self.on_cancel = on_cancel_callback
        self.window: Optional[tk.Tk] = None
        self.username_entry: Optional[tk.Entry] = None
        self.password_entry: Optional[tk.Entry] = None
        self.login_button: Optional[tk.Button] = None
        self.status_label: Optional[tk.Label] = None
        
    def create_window(self) -> None:
        """Crea y muestra la ventana de login."""
        self.window = tk.Tk()
        self.window.title("USB Monitor - Autenticación")
        self.window.geometry("400x300")
        self.window.resizable(False, False)
        
        # Centrar la ventana
        self.window.update_idletasks()
        width = self.window.winfo_width()
        height = self.window.winfo_height()
        x = (self.window.winfo_screenwidth() // 2) - (width // 2)
        y = (self.window.winfo_screenheight() // 2) - (height // 2)
        self.window.geometry(f"{width}x{height}+{x}+{y}")
        
        # Mantener ventana al frente
        self.window.attributes("-topmost", True)
        self.window.focus_force()
        
        # Configurar estilo
        style = ttk.Style()
        style.theme_use("clam")
        
        # Frame principal
        main_frame = ttk.Frame(self.window, padding="20")
        main_frame.pack(fill=tk.BOTH, expand=True)
        
        # Título
        title_label = ttk.Label(
            main_frame,
            text="🔒 Desbloqueo de USB Requerido",
            font=("Segoe UI", 14, "bold"),
        )
        title_label.pack(pady=(0, 10))
        
        # Información
        info_text = f"PC: {self.pc_name}\nUnidad: {self.drive_letter}"
        info_label = ttk.Label(
            main_frame,
            text=info_text,
            font=("Segoe UI", 9),
            foreground="#666",
        )
        info_label.pack(pady=(0, 20))
        
        # Campo de usuario
        username_frame = ttk.Frame(main_frame)
        username_frame.pack(fill=tk.X, pady=5)
        
        ttk.Label(username_frame, text="Usuario:", width=12).pack(side=tk.LEFT)
        self.username_entry = ttk.Entry(username_frame, width=25)
        self.username_entry.pack(side=tk.LEFT, expand=True, fill=tk.X)
        self.username_entry.focus()
        
        # Campo de contraseña
        password_frame = ttk.Frame(main_frame)
        password_frame.pack(fill=tk.X, pady=5)
        
        ttk.Label(password_frame, text="Contraseña:", width=12).pack(side=tk.LEFT)
        self.password_entry = ttk.Entry(password_frame, show="●", width=25)
        self.password_entry.pack(side=tk.LEFT, expand=True, fill=tk.X)
        
        # Bind Enter key
        self.password_entry.bind("<Return>", lambda e: self.login())
        self.username_entry.bind("<Return>", lambda e: self.password_entry.focus())
        
        # Label de estado
        self.status_label = ttk.Label(
            main_frame,
            text="",
            font=("Segoe UI", 9),
            foreground="red",
        )
        self.status_label.pack(pady=(10, 0))
        
        # Botones
        button_frame = ttk.Frame(main_frame)
        button_frame.pack(pady=(20, 0))
        
        self.login_button = ttk.Button(
            button_frame,
            text="Desbloquear",
            command=self.login,
            width=15,
        )
        self.login_button.pack(side=tk.LEFT, padx=5)
        
        cancel_button = ttk.Button(
            button_frame,
            text="Cancelar",
            command=self.cancel,
            width=15,
        )
        cancel_button.pack(side=tk.LEFT, padx=5)
        
        # Manejar cierre de ventana
        self.window.protocol("WM_DELETE_WINDOW", self.cancel)
        
        self.window.mainloop()
    
    def set_status(self, message: str, is_error: bool = True) -> None:
        """Actualiza el mensaje de estado."""
        if self.status_label:
            self.status_label.config(
                text=message,
                foreground="red" if is_error else "green",
            )
    
    def set_loading(self, loading: bool) -> None:
        """Activa/desactiva el estado de carga."""
        if self.login_button:
            self.login_button.config(
                state=tk.DISABLED if loading else tk.NORMAL,
                text="Verificando..." if loading else "Desbloquear",
            )
        if self.username_entry:
            self.username_entry.config(state=tk.DISABLED if loading else tk.NORMAL)
        if self.password_entry:
            self.password_entry.config(state=tk.DISABLED if loading else tk.NORMAL)
    
    def login(self) -> None:
        """Maneja el intento de login."""
        if not self.username_entry or not self.password_entry:
            return
            
        username = self.username_entry.get().strip()
        password = self.password_entry.get()
        
        if not username or not password:
            self.set_status("Por favor ingrese usuario y contraseña")
            return
        
        self.set_loading(True)
        self.set_status("Verificando credenciales...", is_error=False)
        
        # Ejecutar validación en thread separado
        thread = threading.Thread(
            target=self._validate_credentials,
            args=(username, password),
            daemon=True,
        )
        thread.start()
    
    def _validate_credentials(self, username: str, password: str) -> None:
        """Valida las credenciales con el servidor."""
        try:
            url = build_url("/api/auth/login")
            headers = {"Content-Type": "application/json"}
            headers.update(get_auth_headers())
            
            payload = {
                "username": username,
                "password": password,
                "pcName": self.pc_name,
            }
            
            LOGGER.info("Intentando login para usuario: %s", username)
            response = requests.post(url, json=payload, headers=headers, timeout=10)
            
            if response.ok:
                data = response.json()
                if data.get("success") or data.get("token"):
                    LOGGER.info("Login exitoso para usuario: %s", username)
                    self._authorize_unlock(data.get("token"))
                else:
                    error_msg = data.get("message", "Credenciales inválidas")
                    LOGGER.warning("Login fallido: %s", error_msg)
                    self._on_login_failed(error_msg)
            else:
                error_msg = "Credenciales inválidas"
                if response.status_code == 401:
                    error_msg = "Usuario o contraseña incorrectos"
                elif response.status_code == 403:
                    error_msg = "Acceso denegado"
                elif response.status_code >= 500:
                    error_msg = "Error del servidor"
                
                LOGGER.warning("Login fallido (HTTP %s): %s", response.status_code, error_msg)
                self._on_login_failed(error_msg)
                
        except requests.exceptions.Timeout:
            LOGGER.error("Timeout al validar credenciales")
            self._on_login_failed("Timeout: El servidor no responde")
        except requests.exceptions.ConnectionError:
            LOGGER.error("Error de conexión al validar credenciales")
            self._on_login_failed("Error: No se puede conectar al servidor")
        except Exception as exc:
            LOGGER.error("Error al validar credenciales: %s", exc)
            self._on_login_failed(f"Error: {str(exc)}")
    
    def _authorize_unlock(self, token: Optional[str]) -> None:
        """Autoriza el desbloqueo de la unidad USB."""
        try:
            url = build_url(f"/api/usb-unlock/authorize")
            headers = {"Content-Type": "application/json"}
            headers.update(get_auth_headers())
            
            if token:
                headers["Authorization"] = f"Bearer {token}"
            
            payload = {
                "pcName": self.pc_name,
                "authorized": True,
            }
            
            LOGGER.info("Autorizando desbloqueo para PC: %s", self.pc_name)
            response = requests.post(url, json=payload, headers=headers, timeout=10)
            response.raise_for_status()
            
            LOGGER.info("Desbloqueo autorizado exitosamente")
            self._on_login_success()
            
        except Exception as exc:
            LOGGER.error("Error al autorizar desbloqueo: %s", exc)
            self._on_login_failed(f"Error al autorizar: {str(exc)}")
    
    def _on_login_success(self) -> None:
        """Callback cuando el login es exitoso."""
        if self.window:
            self.window.after(0, self._close_success)
    
    def _on_login_failed(self, error_msg: str) -> None:
        """Callback cuando el login falla."""
        if self.window:
            self.window.after(0, lambda: self._show_error(error_msg))
    
    def _show_error(self, error_msg: str) -> None:
        """Muestra un error en la UI."""
        self.set_loading(False)
        self.set_status(error_msg, is_error=True)
        if self.password_entry:
            self.password_entry.delete(0, tk.END)
            self.password_entry.focus()
    
    def _close_success(self) -> None:
        """Cierra la ventana tras éxito."""
        if self.window:
            messagebox.showinfo(
                "Éxito",
                f"USB {self.drive_letter} desbloqueado correctamente",
                parent=self.window,
            )
            self.window.withdraw()  # Ocultar en lugar de destruir
            if self.on_success:
                self.on_success()
    
    def cancel(self) -> None:
        """Maneja la cancelación del login."""
        LOGGER.info("Login cancelado por el usuario")
        if self.window:
            self.window.withdraw()  # Ocultar en lugar de destruir
        if self.on_cancel:
            self.on_cancel()


class USBMonitorAgent:
    """Agente principal que monitorea señales y muestra el login."""
    
    def __init__(self):
        self.running = False
        self.tray_icon: Optional[pystray.Icon] = None
        self.monitor_thread: Optional[threading.Thread] = None
        self.current_login_window: Optional[LoginWindow] = None
        SIGNAL_FILE.parent.mkdir(parents=True, exist_ok=True)
        
    def create_tray_icon(self) -> pystray.Icon:
        """Crea el icono de la bandeja del sistema."""
        # Crear imagen simple para el icono
        image = Image.new("RGB", (64, 64), color="white")
        draw = ImageDraw.Draw(image)
        draw.rectangle([8, 8, 56, 56], fill="#0078D4", outline="black", width=2)
        draw.text((20, 20), "USB", fill="white")
        
        menu = pystray.Menu(
            pystray.MenuItem("USB Monitor Agent", lambda: None, enabled=False),
            pystray.MenuItem("Estado: Activo", lambda: None, enabled=False),
            pystray.Menu.SEPARATOR,
            pystray.MenuItem("Salir", self.quit_app),
        )
        
        icon = pystray.Icon("usb_monitor", image, "USB Monitor Agent", menu)
        return icon
    
    def start(self) -> None:
        """Inicia el agente."""
        LOGGER.info("Iniciando USB Monitor Agent...")
        self.running = True
        
        # Iniciar thread de monitoreo
        self.monitor_thread = threading.Thread(target=self.monitor_signals, daemon=True)
        self.monitor_thread.start()
        
        # Iniciar icono de bandeja
        if TRAY_AVAILABLE:
            self.tray_icon = self.create_tray_icon()
            LOGGER.info("Iniciando icono de bandeja del sistema...")
            self.tray_icon.run()
        else:
            LOGGER.warning("pystray no disponible, ejecutando sin icono de bandeja")
            # Mantener el programa en ejecución
            try:
                while self.running:
                    time.sleep(1)
            except KeyboardInterrupt:
                self.quit_app()
    
    def monitor_signals(self) -> None:
        """Monitorea el archivo de señales del servicio."""
        LOGGER.info("Iniciando monitoreo de señales en: %s", SIGNAL_FILE)
        last_processed_time = None
        
        while self.running:
            try:
                if SIGNAL_FILE.exists():
                    try:
                        with open(SIGNAL_FILE, "r", encoding="utf-8") as f:
                            data = json.load(f)
                    except json.JSONDecodeError as e:
                        LOGGER.debug("Archivo de señal con formato JSON inválido: %s", e)
                        time.sleep(2)
                        continue
                    except Exception as e:
                        LOGGER.debug("Error al leer archivo de señal: %s", e)
                        time.sleep(2)
                        continue
                    
                    # Verificar si ya fue procesada
                    if data.get("processed", False):
                        time.sleep(2)
                        continue
                    
                    # Verificar timestamp para evitar procesar señales antiguas
                    timestamp = data.get("timestamp")
                    if not timestamp:
                        LOGGER.warning("Señal sin timestamp, ignorando")
                        time.sleep(2)
                        continue
                    
                    if timestamp == last_processed_time:
                        time.sleep(2)
                        continue
                    
                    last_processed_time = timestamp
                    pc_name = data.get("pc_name", HOSTNAME)
                    drive_letter = data.get("drive_letter", "USB")
                    
                    LOGGER.info("Señal detectada: PC=%s, Unidad=%s, Timestamp=%s", 
                               pc_name, drive_letter, timestamp)
                    
                    # Marcar como procesada ANTES de mostrar la ventana
                    try:
                        data["processed"] = True
                        with open(SIGNAL_FILE, "w", encoding="utf-8") as f:
                            json.dump(data, f, indent=2)
                        LOGGER.info("Señal marcada como procesada")
                    except Exception as e:
                        LOGGER.error("Error al marcar señal como procesada: %s", e)
                    
                    # Mostrar ventana de login
                    self.show_login_window(pc_name, drive_letter)
                
                time.sleep(2)
                
            except Exception as exc:
                LOGGER.error("Error en el loop de monitoreo: %s", exc)
                time.sleep(5)
    
    def show_login_window(self, pc_name: str, drive_letter: str) -> None:
        """Muestra la ventana de login."""
        LOGGER.info("Mostrando ventana de login para PC: %s, Unidad: %s", pc_name, drive_letter)
        
        # Si ya hay una ventana abierta, traerla al frente
        if self.current_login_window and self.current_login_window.window:
            try:
                if self.current_login_window.window.winfo_exists():
                    self.current_login_window.window.deiconify()
                    self.current_login_window.window.lift()
                    self.current_login_window.window.focus_force()
                    LOGGER.info("Ventana de login ya existe, trayendo al frente")
                    return
            except:
                pass
        
        def on_success():
            LOGGER.info("Login exitoso, USB desbloqueado")
            self.current_login_window = None
        
        def on_cancel():
            LOGGER.info("Login cancelado")
            self.current_login_window = None
        
        def create_window_thread():
            try:
                login_window = LoginWindow(pc_name, drive_letter, on_success, on_cancel)
                self.current_login_window = login_window
                login_window.create_window()
            except Exception as exc:
                LOGGER.error("Error al mostrar ventana de login: %s", exc)
                self.current_login_window = None
        
        # Crear ventana en thread separado para no bloquear el monitoreo
        window_thread = threading.Thread(target=create_window_thread, daemon=True)
        window_thread.start()
    
    def quit_app(self, icon=None, item=None) -> None:
        """Cierra la aplicación."""
        LOGGER.info("Cerrando USB Monitor Agent...")
        self.running = False
        
        if self.tray_icon:
            self.tray_icon.stop()
        
        sys.exit(0)


def main():
    """Función principal."""
    LOGGER.info("=" * 60)
    LOGGER.info("USB Monitor Agent iniciado")
    LOGGER.info("Host: %s | Puerto: %s", get_server_host(), get_server_port())
    LOGGER.info("PC: %s", HOSTNAME)
    LOGGER.info("=" * 60)
    
    agent = USBMonitorAgent()
    
    try:
        agent.start()
    except KeyboardInterrupt:
        LOGGER.info("Interrupción por teclado")
        agent.quit_app()
    except Exception as exc:
        LOGGER.error("Error fatal: %s", exc)
        sys.exit(1)


if __name__ == "__main__":
    main()
