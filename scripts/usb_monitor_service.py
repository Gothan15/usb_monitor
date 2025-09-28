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


def wait_for_mount(drive_letter: str, attempts: int = 5, delay: float = 1.0) -> bool:
    letter = drive_letter.rstrip(":")
    if not letter:
        return False
    target = f"{letter}:\\"
    for attempt in range(1, attempts + 1):
        if os.path.exists(target):
            return True
        time.sleep(delay)
        LOGGER.debug(
            "Esperando montaje de %s (intento %s/%s)", target, attempt, attempts
        )
    return False


def set_volume_readonly(drive_letter: str, conn: wmi.WMI) -> Tuple[bool, str]:
    letter = drive_letter.rstrip(":").upper()
    if len(letter) != 1 or not letter.isalpha():
        msg = f"Letra de unidad inválida ({drive_letter})"
        LOGGER.warning("%s", msg)
        return False, msg

    script = f"select volume {letter}\nattributes volume set readonly\nexit\n"
    try:
        if not wait_for_mount(drive_letter):
            LOGGER.warning(
                "La unidad %s no parece montada; se intenta igualmente aplicar solo lectura",
                drive_letter,
            )

        result = run_diskpart(script)
        stdout_lower = result.stdout.lower()
        stderr_lower = result.stderr.lower()
        if (
            result.returncode == 0
            and "error" not in stdout_lower
            and "error" not in stderr_lower
        ):
            msg = f"readonly aplicado al volumen {drive_letter}"
            LOGGER.info(
                "Unidad %s establecida en modo solo lectura. Salida: %s",
                drive_letter,
                result.stdout.strip(),
            )
            return True, msg
        LOGGER.error(
            "diskpart devolvió código %s al establecer %s solo lectura. Stdout: %s | Stderr: %s",
            result.returncode,
            drive_letter,
            result.stdout.strip(),
            result.stderr.strip(),
        )

        disk_number = resolve_disk_number(letter, conn)
        if not disk_number:
            msg = (
                f"No se pudo establecer la unidad {drive_letter} en solo lectura ni resolver el disco"
            )
            LOGGER.warning("%s", msg)
            return False, msg

        disk_script = f"select disk {disk_number}\nattributes disk set readonly\nexit\n"
        disk_result = run_diskpart(disk_script)
        disk_stdout_lower = disk_result.stdout.lower()
        disk_stderr_lower = disk_result.stderr.lower()
        if (
            disk_result.returncode == 0
            and "error" not in disk_stdout_lower
            and "error" not in disk_stderr_lower
        ):
            msg = f"readonly aplicado al disco {disk_number} (unidad {drive_letter})"
            LOGGER.info(
                "Disco %s (para unidad %s) establecido en modo solo lectura. Salida: %s",
                disk_number,
                drive_letter,
                disk_result.stdout.strip(),
            )
            return True, msg
        else:
            LOGGER.error(
                "diskpart devolvió código %s al bloquear disco %s (unidad %s). Stdout: %s | Stderr: %s",
                disk_result.returncode,
                disk_number,
                drive_letter,
                disk_result.stdout.strip(),
                disk_result.stderr.strip(),
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


def protect_usb_media(
    drive_letter: Optional[str],
    conn: wmi.WMI,
) -> Tuple[Optional[str], bool, str]:
    if not drive_letter:
        msg = "No se determinó la letra de unidad"
        LOGGER.warning("%s", msg)
        return None, False, msg

    success, detail = set_volume_readonly(drive_letter, conn)
    return drive_letter, success, detail


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

    def SvcStop(self) -> None:
        self.ReportServiceStatus(win32service.SERVICE_STOP_PENDING)
        win32event.SetEvent(self.stop_event)
        self.stopped = True
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
            watcher = c.watch_for(
                notification_type="Creation",
                wmi_class="Win32_VolumeChangeEvent",
                EventType=2,  # 2 => Device arrival
            )
        except Exception as exc:
            LOGGER.error("No se pudo inicializar WMI: %s", exc)
            pythoncom.CoUninitialize()
            return

        while not self.stopped:
            rc = win32event.WaitForSingleObject(self.stop_event, 500)
            if rc == win32event.WAIT_OBJECT_0:
                break

            try:
                event = watcher(timeout_ms=2000)
                if event:
                    drive_letter = resolve_drive_letter(event, c)
                    letter_used, readonly_ok, readonly_msg = protect_usb_media(
                        drive_letter, c
                    )
                    payload = build_payload(event, letter_used, readonly_msg)
                    LOGGER.info("Evento USB detectado: %s", payload["event"])
                    send_event(payload)
            except wmi.x_wmi_timed_out:
                continue
            except Exception as exc:
                LOGGER.error("Error en el loop principal: %s", exc)
                time.sleep(5)

        pythoncom.CoUninitialize()
        LOGGER.info("Servicio detenido")


if __name__ == "__main__":
    if len(sys.argv) == 1:
        print(__doc__)
    else:
        win32serviceutil.HandleCommandLine(USBMonitorService)
