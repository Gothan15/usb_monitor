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

import getpass
import json
import logging
import os
import socket
import subprocess
import sys
import time
from pathlib import Path
from typing import Any, Dict, Optional, Tuple
import tempfile
from http.server import BaseHTTPRequestHandler, HTTPServer
from urllib.parse import urlparse, parse_qs
import threading

import pythoncom  # type: ignore
import requests
import win32event  # type: ignore
import win32service  # type: ignore
import win32serviceutil  # type: ignore
import servicemanager  # type: ignore
import wmi  # type: ignore


DEFAULT_HOST = "172.20.10.12"
DEFAULT_PORT = 3000
DEFAULT_ENDPOINT = "/api/usb-event"
DEFAULT_LOG_PATH = Path("D:/Monitor_USB/usb_monitor.log")
DEFAULT_LISTEN_PORT = 5001  # Puerto donde el servicio escuchará peticiones
SIGNAL_FILE = Path("C:/ProgramData/USBMonitor/browser_signal.json")
HOSTNAME = (socket.gethostname() or "").strip().upper() or "UNKNOWN_HOST"


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
    return f"http://{host}:{port}{endpoint}"


def get_auth_headers() -> Dict[str, str]:
    headers: Dict[str, str] = {}
    api_key = os.environ.get("USB_MONITOR_API_KEY")
    if api_key:
        headers["Authorization"] = f"ApiKey {api_key}"
    return headers


def resolve_log_path() -> Path:
    custom_path = os.environ.get("USB_MONITOR_LOG_PATH")
    if custom_path:
        path = Path(custom_path)
        if path.suffix:
            path.parent.mkdir(parents=True, exist_ok=True)
            return path
        path.mkdir(parents=True, exist_ok=True)
        return path / "usb_monitor.log"

    DEFAULT_LOG_PATH.parent.mkdir(parents=True, exist_ok=True)
    return DEFAULT_LOG_PATH


def get_logger() -> logging.Logger:
    """Configura y devuelve un logger compartido."""
    log_file = resolve_log_path()
    logger = logging.getLogger("usb_monitor_service")
    if not logger.handlers:
        logger.setLevel(logging.INFO)
        handler = logging.FileHandler(log_file, encoding="utf-8")
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
    return logger


LOGGER = get_logger()


def resolve_ip() -> str:
    """Obtiene la IP más razonable asociada al host local."""
    try:
        hostname = socket.gethostname()
        addresses = socket.gethostbyname_ex(hostname)[2]
        for addr in addresses:
            if not addr.startswith("127."):
                return addr
        with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as s:
            s.connect(("8.8.8.8", 80))
            return s.getsockname()[0]
    except Exception as exc:
        LOGGER.warning("No se pudo resolver IP local: %s", exc)
        return "0.0.0.0"


def build_payload(
    event: Any,
    drive_descriptor: Optional[str] = None,
    readonly_status: Optional[str] = None,
) -> Dict[str, Any]:
    descriptor = drive_descriptor
    if not descriptor:
        for attr in ("DriveName", "VolumeName", "DeviceID"):
            value = getattr(event, attr, None)
            if value:
                descriptor = str(value)
                break
    descriptor = descriptor or "Unknown"
    event_message = f"USB inserted: {descriptor}"
    if readonly_status:
        event_message = f"{event_message} | {readonly_status}"
    return {
        "pc_name": HOSTNAME,
        "pc_ip": resolve_ip(),
        "pc_user": getpass.getuser(),
        "drive_letter": drive_descriptor,
        "readonly_status": readonly_status,
        "event": event_message,
    }


def send_event(payload: Dict[str, Any]) -> None:
    endpoint = os.environ.get("USB_MONITOR_ENDPOINT", DEFAULT_ENDPOINT)
    url = build_url(endpoint)
    headers = {"Content-Type": "application/json"}
    headers.update(get_auth_headers())

    try:
        response = requests.post(url, json=payload, headers=headers, timeout=10)
        response.raise_for_status()
        LOGGER.info("Evento USB enviado correctamente: %s", json.dumps(payload))
    except Exception as exc:
        LOGGER.error("Error al enviar evento USB: %s", exc)


def resolve_drive_letter(event: Any, conn: wmi.WMI) -> Optional[str]:
    drive_name = getattr(event, "DriveName", None)
    if isinstance(drive_name, str) and len(drive_name) >= 2 and drive_name[1] == ":":
        return drive_name[:2].upper()

    candidate = getattr(event, "VolumeName", None) or getattr(event, "DeviceID", None)
    if not isinstance(candidate, str):
        return None

    try:
        normalized = candidate.replace("\\", "\\\\")
        volumes = conn.query(
            f"SELECT DriveLetter FROM Win32_Volume WHERE DeviceID='{normalized}'"
        )
        for volume in volumes:
            drive_letter = getattr(volume, "DriveLetter", None)
            if drive_letter and len(drive_letter) >= 2 and drive_letter[1] == ":":
                return drive_letter[:2].upper()
    except Exception as exc:
        LOGGER.warning("No se pudo resolver letra de unidad para %s: %s", candidate, exc)

    return None


def resolve_disk_number(drive_letter: str, conn: wmi.WMI) -> Optional[str]:
    try:
        logical = conn.Win32_LogicalDisk(DeviceID=f"{drive_letter}:")
        if not logical:
            return None
        partitions = logical[0].associators(wmi_result_class="Win32_DiskPartition")
        for partition in partitions:
            disks = partition.associators(wmi_result_class="Win32_DiskDrive")
            for disk in disks:
                index = getattr(disk, "Index", None)
                if index is not None:
                    return str(index)
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
                    return str(index)
    except Exception as exc:
        LOGGER.warning(
            "No se pudo resolver el número de disco para la unidad %s: %s",
            drive_letter,
            exc,
        )
    return None


def run_diskpart(commands: str) -> subprocess.CompletedProcess[str]:
    script_content = commands if commands.endswith("\n") else commands + "\n"
    with tempfile.NamedTemporaryFile("w", suffix=".txt", delete=False) as script_file:
        script_file.write(script_content)
        script_path = script_file.name

    try:
        result = subprocess.run(
            ["diskpart", "/s", script_path],
            text=True,
            capture_output=True,
            check=False,
            timeout=30,
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
    if not drive_letter:
        msg = "No se determinó la letra de unidad"
        LOGGER.warning("%s", msg)
        return None, False, msg

    success, detail = set_disk_readonly(drive_letter, conn)
    return drive_letter, success, detail


def create_browser_signal(pc_name: str, drive_letter: str) -> None:
    """Crea el archivo de señal para que el agente muestre el login."""
    try:
        SIGNAL_FILE.parent.mkdir(parents=True, exist_ok=True)
        
        signal_data = {
            "pc_name": pc_name,
            "drive_letter": drive_letter,
            "timestamp": time.time(),
            "processed": False,
        }
        
        with open(SIGNAL_FILE, "w", encoding="utf-8") as f:
            json.dump(signal_data, f, indent=2)
        
        LOGGER.info("Archivo de señal creado para el agente: %s", SIGNAL_FILE)
    except Exception as exc:
        LOGGER.error("Error al crear archivo de señal: %s", exc)


def create_pending_unlock(pc_name: str, drive_letter: str) -> bool:
    """Crea un registro de desbloqueo pendiente en el backend."""
    try:
        endpoint = "/api/usb-event/pending-unlock"
        url = build_url(endpoint)
        headers = {"Content-Type": "application/json"}
        headers.update(get_auth_headers())
        
        payload = {
            "pcName": pc_name,
            "driveLetter": drive_letter,
        }
        
        response = requests.post(url, json=payload, headers=headers, timeout=10)
        response.raise_for_status()
        
        LOGGER.info("Registro de desbloqueo pendiente creado para %s - %s", pc_name, drive_letter)
        return True
    except Exception as exc:
        LOGGER.error("Error al crear pending unlock: %s", exc)
        return False


def check_unlock_status(pc_name: str) -> Tuple[bool, Optional[str]]:
    """Verifica si el backend ha autorizado el desbloqueo."""
    try:
        endpoint = f"/api/usb-unlock?pcName={pc_name}&check=true"
        url = build_url(endpoint)
        headers = get_auth_headers()
        
        response = requests.get(url, headers=headers, timeout=10)
        response.raise_for_status()
        
        data = response.json()
        unlocked = data.get("unlocked", False)
        drive_letter = data.get("driveLetter")
        
        return unlocked, drive_letter
    except Exception as exc:
        LOGGER.debug("Error al verificar estado de desbloqueo: %s", exc)
        return False, None


def unlock_usb(drive_letter: str, conn: wmi.WMI) -> bool:
    """Desbloquea una unidad USB removiendo el atributo readonly."""
    LOGGER.info("Iniciando desbloqueo de unidad %s", drive_letter)
    
    success, msg = clear_disk_readonly(drive_letter, conn)
    
    if success:
        LOGGER.info("Unidad %s desbloqueada exitosamente: %s", drive_letter, msg)
    else:
        LOGGER.error("Fallo al desbloquear unidad %s: %s", drive_letter, msg)
    
    return success


def get_connected_usb_drives(conn: wmi.WMI) -> list:
    """Obtiene información de todas las unidades USB conectadas actualmente."""
    usb_drives: list[Dict[str, Any]] = []

    disks = conn.Win32_DiskDrive(InterfaceType="USB")
    for disk in disks:
        disk_index = getattr(disk, "Index", None)
        if disk_index is None:
            continue

        serial = (getattr(disk, "SerialNumber", "") or "").strip()
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
                        "serialNumber": serial or "Unknown",
                        "model": model or "Unknown",
                        "size": size,
                        "freeSpace": free_space,
                    }
                )

    return usb_drives


def send_connected_drives_status(pc_name: str, conn: wmi.WMI) -> bool:
    """Envía el estado actual de las unidades USB conectadas al backend."""
    endpoint = "/api/usb-event/connected-status"
    url = build_url(endpoint)
    headers = {"Content-Type": "application/json"}
    headers.update(get_auth_headers())

    connected_drives = get_connected_usb_drives(conn)

    payload = {
        "pcName": pc_name,
        "timestamp": time.time(),
        "connectedDrives": connected_drives,
    }

    try:
        response = requests.post(url, json=payload, headers=headers, timeout=10)
        response.raise_for_status()
    except requests.RequestException as exc:
        LOGGER.debug("Error HTTP al enviar estado de unidades conectadas: %s", exc)
        return False

    LOGGER.debug(
        "Estado de unidades conectadas enviado: %d drives", len(connected_drives)
    )
    return True


class UnlockHTTPHandler(BaseHTTPRequestHandler):
    """Handler HTTP para recibir notificaciones de desbloqueo del backend."""
    
    service_instance = None  # Referencia al servicio para acceder a pending_usbs y wmi
    
    def log_message(self, format: str, *args) -> None:
        """Sobrescribe el logging para usar nuestro logger."""
        LOGGER.info("%s - %s", self.address_string(), format % args)
    
    def do_GET(self) -> None:
        """Maneja peticiones GET para health check."""
        parsed = urlparse(self.path)
        
        if parsed.path == "/health":
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            response = {
                "status": "ok",
                "hostname": HOSTNAME,
                "service": "USBMonitorService"
            }
            self.wfile.write(json.dumps(response).encode())
        else:
            self.send_response(404)
            self.end_headers()
    
    def do_POST(self) -> None:
        """Maneja peticiones POST para desbloquear USB."""
        parsed = urlparse(self.path)
        
        if parsed.path != "/unlock":
            self.send_response(404)
            self.end_headers()
            return
        
        try:
            # Leer el body de la petición
            content_length = int(self.headers.get("Content-Length", 0))
            body = self.rfile.read(content_length)
            data = json.loads(body.decode())
            
            pc_name = data.get("pcName", "").upper()
            drive_letter = data.get("driveLetter", "").upper()
            
            # Validar que sea para esta PC
            if pc_name != HOSTNAME:
                LOGGER.warning(
                    "Recibida petición de desbloqueo para PC '%s' pero este es '%s'",
                    pc_name, HOSTNAME
                )
                self.send_response(400)
                self.send_header("Content-Type", "application/json")
                self.end_headers()
                error_response = {
                    "ok": False,
                    "error": f"Esta petición es para {pc_name}, pero esta PC es {HOSTNAME}"
                }
                self.wfile.write(json.dumps(error_response).encode())
                return
            
            # Validar que el USB esté en la lista de pendientes
            if drive_letter not in self.service_instance.pending_usbs:
                LOGGER.warning(
                    "Recibida petición de desbloqueo para %s pero no está en pendientes",
                    drive_letter
                )
                self.send_response(404)
                self.send_header("Content-Type", "application/json")
                self.end_headers()
                error_response = {
                    "ok": False,
                    "error": f"USB {drive_letter} no encontrado en pendientes"
                }
                self.wfile.write(json.dumps(error_response).encode())
                return
            
            # Ejecutar el desbloqueo
            LOGGER.info(
                "Recibida notificación HTTP para desbloquear %s en %s",
                drive_letter, pc_name
            )
            
            # Inicializar COM para este thread (el servidor HTTP usa threads separados)
            pythoncom.CoInitialize()
            try:
                success = unlock_usb(drive_letter, self.service_instance.wmi_connection)
            finally:
                pythoncom.CoUninitialize()
            
            if success:
                # Remover de pendientes
                self.service_instance.pending_usbs.pop(drive_letter, None)
                
                # Limpiar archivo de señal
                try:
                    if SIGNAL_FILE.exists():
                        SIGNAL_FILE.unlink()
                        LOGGER.info("Archivo de señal limpiado")
                except Exception as e:
                    LOGGER.warning("Error al limpiar archivo de señal: %s", e)
                
                self.send_response(200)
                self.send_header("Content-Type", "application/json")
                self.end_headers()
                response = {
                    "ok": True,
                    "message": f"USB {drive_letter} desbloqueado exitosamente"
                }
                self.wfile.write(json.dumps(response).encode())
                LOGGER.info("USB %s desbloqueado via HTTP exitosamente", drive_letter)
            else:
                self.send_response(500)
                self.send_header("Content-Type", "application/json")
                self.end_headers()
                error_response = {
                    "ok": False,
                    "error": f"Fallo al desbloquear USB {drive_letter}"
                }
                self.wfile.write(json.dumps(error_response).encode())
                LOGGER.error("Fallo al desbloquear USB %s via HTTP", drive_letter)
                
        except json.JSONDecodeError:
            LOGGER.error("Body de petición no es JSON válido")
            self.send_response(400)
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            error_response = {"ok": False, "error": "JSON inválido"}
            self.wfile.write(json.dumps(error_response).encode())
        except Exception as exc:
            LOGGER.error("Error al procesar petición de desbloqueo: %s", exc)
            self.send_response(500)
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            error_response = {"ok": False, "error": str(exc)}
            self.wfile.write(json.dumps(error_response).encode())


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
        LOGGER.info("Servicio iniciado")
        servicemanager.LogInfoMsg("USBMonitorService - iniciado")
        self.main()

    def main(self) -> None:
        pythoncom.CoInitialize()
        hostname = HOSTNAME
        try:
            c = wmi.WMI()
            self.wmi_connection = c  # Guardar referencia para el HTTP handler
            watcher = c.watch_for(
                notification_type="Creation",
                wmi_class="Win32_VolumeChangeEvent",
                EventType=2,  # 2 => Device arrival
            )
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

        # Thread para monitorear USBs conectadas continuamente
        connected_monitor_thread = threading.Thread(
            target=self.monitor_connected_drives,
            args=(hostname,),
            daemon=True
        )
        connected_monitor_thread.start()

        while not self.stopped:
            rc = win32event.WaitForSingleObject(self.stop_event, 500)
            if rc == win32event.WAIT_OBJECT_0:
                break

            try:
                event = watcher(timeout_ms=2000)
                if event:
                    drive_letter = resolve_drive_letter(event, c)
                    
                    # 1. Proteger USB con readonly
                    letter_used, readonly_ok, readonly_msg = protect_usb_media(
                        drive_letter, c
                    )
                    
                    # 2. Enviar evento al backend
                    payload = build_payload(event, letter_used, readonly_msg)
                    LOGGER.info("Evento USB detectado: %s", payload["event"])
                    send_event(payload)
                    
                    # 3. Si se bloqueó correctamente, crear pending unlock y señal
                    if letter_used and readonly_ok:
                        # Agregar a la lista de USBs pendientes
                        self.pending_usbs[letter_used] = hostname
                        
                        # Crear registro de desbloqueo pendiente en backend
                        create_pending_unlock(hostname, letter_used)
                        
                        # Crear archivo de señal para el agente
                        create_browser_signal(hostname, letter_used)
                        
                        LOGGER.info(
                            "USB %s bloqueado y pendiente de autorización",
                            letter_used
                        )
                    
            except wmi.x_wmi_timed_out:
                continue
            except Exception as exc:
                LOGGER.error("Error en el loop principal: %s", exc)
                time.sleep(5)

        pythoncom.CoUninitialize()
        LOGGER.info("Servicio detenido")

    def start_http_server(self) -> None:
        """Inicia el servidor HTTP en un thread separado."""
        try:
            listen_port = get_listen_port()
            
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
        LOGGER.info("Iniciando monitoreo de autorizaciones de desbloqueo")
        
        # Inicializar COM para este thread
        pythoncom.CoInitialize()
        
        try:
            while not self.stopped:
                try:
                    time.sleep(3)  # Verificar cada 3 segundos
                    
                    if not self.pending_usbs:
                        continue
                    
                    # Verificar estado de desbloqueo en el backend
                    pc_name = HOSTNAME
                    unlocked, drive_letter = check_unlock_status(pc_name)
                    
                    if unlocked and drive_letter and drive_letter in self.pending_usbs:
                        # Desbloquear la unidad
                        LOGGER.info(
                            "Autorización de desbloqueo recibida para %s",
                            drive_letter
                        )
                        
                        success = unlock_usb(drive_letter, conn)
                        
                        if success:
                            # Remover de la lista de pendientes
                            self.pending_usbs.pop(drive_letter, None)
                            
                            # Limpiar archivo de señal
                            try:
                                if SIGNAL_FILE.exists():
                                    SIGNAL_FILE.unlink()
                                    LOGGER.info("Archivo de señal limpiado")
                            except Exception as e:
                                LOGGER.warning("Error al limpiar archivo de señal: %s", e)
                            
                            LOGGER.info(
                                "USB %s desbloqueado exitosamente tras autorización",
                                drive_letter
                            )
                        else:
                            LOGGER.error(
                                "Fallo al desbloquear USB %s tras autorización",
                                drive_letter
                            )
                    
                except Exception as exc:
                    LOGGER.error("Error en monitor de autorizaciones: %s", exc)
                    time.sleep(5)
        finally:
            pythoncom.CoUninitialize()

    def monitor_connected_drives(self, pc_name: str) -> None:
        """Monitorea periódicamente las unidades USB conectadas y envía el estado al backend."""
        LOGGER.info("Iniciando monitoreo de unidades USB conectadas")

        pythoncom.CoInitialize()
        conn: Optional[wmi.WMI] = None

        try:
            while not self.stopped:
                if conn is None:
                    try:
                        conn = wmi.WMI()
                    except Exception as exc:
                        LOGGER.error(
                            "No se pudo crear conexión WMI para monitorear unidades conectadas: %s",
                            exc,
                        )
                        time.sleep(10)
                        continue

                try:
                    sent = send_connected_drives_status(pc_name, conn)
                    if not sent:
                        LOGGER.debug(
                            "No se actualizó el estado de unidades conectadas para %s",
                            pc_name,
                        )
                except Exception as exc:
                    LOGGER.error(
                        "Error al obtener o enviar unidades conectadas para %s: %s",
                        pc_name,
                        exc,
                    )
                    conn = None

                time.sleep(10)
        finally:
            conn = None
            pythoncom.CoUninitialize()


if __name__ == "__main__":
    if len(sys.argv) == 1:
        print(__doc__)
    else:
        win32serviceutil.HandleCommandLine(USBMonitorService)
