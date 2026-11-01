# -*- coding: utf-8 -*-
"""Configuración del agente.

La configuración vive SOLO en `server.json` (junto al ejecutable, o
en ProgramData): la v2 no usa variables de entorno del sistema ni
del usuario para configurarse. Las variables USB_MONITOR_* de la v1
se migran al archivo una única vez, al primer arranque sin
server.json, y después se ignoran.

Claves del archivo: serverHost, serverPort, serverScheme, agentToken,
apiKey, sslCert, sslVerify. Los valores agentToken/apiKey aceptan el
cifrado ENC: de la v1 (Fernet con clave derivada de la máquina), que
aquí se replica exacto para no romper instalaciones existentes; un
ENC: que no se puede descifrar se descarta (fail-closed), nunca se
usa como credencial.

Concurrencia: la lectura se cachea por (ruta, mtime); la escritura es
atómica (temporal + os.replace) y va bajo un lock del módulo.
"""
from __future__ import annotations

import base64
import json
import os
import socket
import sys
import threading
from pathlib import Path
from typing import Any, Dict, Optional

from .registro import PROGRAM_DATA_DIR, obtener

LOG = obtener("config")

DEFAULT_HOST = "localhost"
DEFAULT_PORT = 3000

_lock = threading.Lock()
_cache: Dict[str, Any] = {"ruta": None, "mtime": None, "datos": {}}


# ── Cifrado ENC: (compatible con la v1) ────────────────────────────

def _identificador_maquina() -> bytes:
    try:
        import pythoncom
        import wmi

        pythoncom.CoInitialize()
        try:
            for item in wmi.WMI().Win32_ComputerSystemProduct():
                uuid = getattr(item, "UUID", None)
                if uuid:
                    return str(uuid).encode("utf-8")
        finally:
            pythoncom.CoUninitialize()
    except Exception as exc:
        LOG.debug("UUID por WMI no disponible: %s", exc)
    respaldo = f"{socket.gethostname()}-{os.environ.get('COMPUTERNAME', 'UNKNOWN')}"
    return respaldo.encode("utf-8")


def _clave_fernet() -> bytes:
    from cryptography.hazmat.primitives import hashes
    from cryptography.hazmat.primitives.kdf.pbkdf2 import PBKDF2HMAC

    kdf = PBKDF2HMAC(
        algorithm=hashes.SHA256(),
        length=32,
        salt=b"USBMonitor_Salt_V1",
        iterations=100000,
    )
    return base64.urlsafe_b64encode(kdf.derive(_identificador_maquina()))


def descifrar(valor: str) -> str:
    """Descifra un valor ENC:; el texto plano pasa tal cual.

    Fail-closed: si el cifrado no se puede abrir, devuelve "".
    """
    if not valor:
        return ""
    if not valor.startswith("ENC:"):
        return valor
    try:
        from cryptography.fernet import Fernet

        return Fernet(_clave_fernet()).decrypt(valor[4:].encode("utf-8")).decode("utf-8")
    except Exception as exc:
        LOG.error("Valor cifrado ilegible, se descarta: %s", exc)
        return ""


def cifrar(valor: str) -> str:
    try:
        from cryptography.fernet import Fernet

        return "ENC:" + Fernet(_clave_fernet()).encrypt(valor.encode("utf-8")).decode("utf-8")
    except Exception as exc:
        LOG.warning("No se pudo cifrar el valor, se guarda en claro: %s", exc)
        return valor


# ── Ubicación y lectura del archivo ────────────────────────────────

def directorio_app() -> Path:
    """Carpeta del ejecutable (o del script, en desarrollo)."""
    if getattr(sys, "frozen", False):
        return Path(sys.executable).resolve().parent
    return Path(__file__).resolve().parent.parent


def _rutas_candidatas() -> list[Path]:
    rutas = [directorio_app() / "server.json", PROGRAM_DATA_DIR / "server.json"]
    return rutas


_MIGRACION = {
    # variable de entorno de la v1 -> clave de server.json
    "USB_MONITOR_SERVER_HOST": "serverHost",
    "USB_MONITOR_SERVER_PORT": "serverPort",
    "USB_MONITOR_SERVER_SCHEME": "serverScheme",
    "USB_MONITOR_AGENT_TOKEN": "agentToken",
    "USB_MONITOR_API_KEY": "apiKey",
    "USB_MONITOR_SSL_CERT": "sslCert",
}
_migracion_intentada = False


def _migrar_desde_entorno() -> None:
    """Migración única v1 -> v2: si no hay server.json pero el
    entorno trae la configuración antigua, se vuelca al archivo y
    el entorno deja de leerse. Así ninguna instalación pierde su
    configuración y ningún PC nuevo necesita variables del sistema.
    """
    global _migracion_intentada
    if _migracion_intentada:
        return
    _migracion_intentada = True
    datos: Dict[str, Any] = {}
    for variable, clave in _MIGRACION.items():
        valor = os.environ.get(variable, "").strip()
        if valor:
            datos[clave] = int(valor) if clave == "serverPort" and valor.isdigit() else valor
    if os.environ.get("USB_MONITOR_SSL_VERIFY", "").lower() == "false":
        datos["sslVerify"] = False
    if not datos:
        return
    if guardar(datos):
        LOG.info("Configuración migrada del entorno a server.json")
        return
    # La carpeta del ejecutable no admitió la escritura: a ProgramData.
    try:
        destino = PROGRAM_DATA_DIR / "server.json"
        destino.parent.mkdir(parents=True, exist_ok=True)
        temporal = destino.with_suffix(".json.tmp")
        temporal.write_text(json.dumps(datos, indent=2), encoding="utf-8")
        os.replace(temporal, destino)
        LOG.info("Configuración migrada del entorno a %s", destino)
    except Exception as exc:
        LOG.warning("Migración de configuración imposible: %s", exc)


def cargar() -> Dict[str, Any]:
    """Contenido del primer server.json legible ({} si no hay).

    La configuración vive SOLO en el archivo (v2): no se lee ninguna
    variable de entorno de configuración; las de la v1 se migran una
    sola vez con _migrar_desde_entorno().
    """
    for ruta in _rutas_candidatas():
        try:
            if not ruta.is_file():
                continue
            mtime = ruta.stat().st_mtime
            with _lock:
                if _cache["ruta"] == str(ruta) and _cache["mtime"] == mtime:
                    return dict(_cache["datos"])
            datos = json.loads(ruta.read_text(encoding="utf-8"))
            if not isinstance(datos, dict):
                datos = {}
            with _lock:
                _cache.update(ruta=str(ruta), mtime=mtime, datos=datos)
            return dict(datos)
        except Exception as exc:
            LOG.warning("server.json ilegible en %s: %s", ruta, exc)
    _migrar_desde_entorno()
    return cargar_sin_migrar()


def cargar_sin_migrar() -> Dict[str, Any]:
    for ruta in _rutas_candidatas():
        try:
            if ruta.is_file():
                datos = json.loads(ruta.read_text(encoding="utf-8"))
                if isinstance(datos, dict):
                    return datos
        except Exception:
            pass
    return {}


def guardar(actualizaciones: Dict[str, Any]) -> bool:
    """Fusiona y escribe server.json junto al ejecutable, atómico."""
    destino = directorio_app() / "server.json"
    with _lock:
        datos: Dict[str, Any] = {}
        if destino.is_file():
            try:
                previo = json.loads(destino.read_text(encoding="utf-8"))
                if isinstance(previo, dict):
                    datos = previo
            except Exception:
                datos = {}
        else:
            datos = cargar()
        datos.update(actualizaciones)
        try:
            temporal = destino.with_suffix(".json.tmp")
            temporal.write_text(
                json.dumps(datos, indent=2, ensure_ascii=False), encoding="utf-8"
            )
            os.replace(temporal, destino)
            _cache.update(ruta=None, mtime=None, datos={})
            return True
        except Exception as exc:
            LOG.error("No se pudo escribir server.json: %s", exc)
            return False


def _texto(clave_archivo: str, defecto: str = "") -> str:
    valor = cargar().get(clave_archivo)
    if isinstance(valor, str) and valor.strip():
        return valor.strip()
    return defecto


# ── Valores efectivos (solo server.json) ───────────────────────────

def host_servidor() -> str:
    return _texto("serverHost", DEFAULT_HOST) or DEFAULT_HOST


def puerto_servidor() -> int:
    bruto = cargar().get("serverPort")
    if bruto is not None:
        try:
            return int(bruto)
        except (TypeError, ValueError):
            LOG.warning("serverPort inválido en server.json: %r", bruto)
    return DEFAULT_PORT


def esquema_servidor() -> str:
    esquema = (_texto("serverScheme", "http") or "http").lower()
    return esquema if esquema in ("http", "https") else "http"


def url_base() -> str:
    return f"{esquema_servidor()}://{host_servidor()}:{puerto_servidor()}"


def certificado_tls() -> Optional[str]:
    certificado = _texto("sslCert")
    if certificado and Path(certificado).is_file():
        return certificado
    return None


def verificar_tls() -> bool:
    if esquema_servidor() == "http":
        return True
    if certificado_tls():
        return True  # api.py pasa la ruta del certificado como verify
    return cargar().get("sslVerify") is not False


def token_agente() -> Optional[str]:
    bruto = _texto("agentToken")
    if not bruto:
        return None
    limpio = descifrar(bruto).strip()
    return limpio or None


def clave_api() -> Optional[str]:
    bruto = _texto("apiKey")
    if not bruto:
        return None
    if bruto.lower().startswith("apikey "):
        bruto = bruto[7:].strip()
    limpio = descifrar(bruto).strip()
    return limpio or None


def cabeceras_auth() -> Dict[str, str]:
    """El token por equipo manda; la clave API es el respaldo."""
    token = token_agente()
    if token:
        return {"Authorization": f"AgentToken {token}"}
    clave = clave_api()
    if clave:
        return {"Authorization": f"ApiKey {clave}"}
    return {}


def nombre_pc() -> str:
    return (
        os.environ.get("COMPUTERNAME")
        or socket.gethostname()
        or "UNKNOWN_HOST"
    ).strip()


def ip_pc() -> str:
    """Primera IPv4 válida de la máquina (el panel la exige con formato)."""
    try:
        with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as s:
            s.connect((host_servidor(), puerto_servidor()))
            candidata = s.getsockname()[0]
            socket.inet_aton(candidata)
            return candidata
    except Exception:
        pass
    try:
        for info in socket.getaddrinfo(socket.gethostname(), None, socket.AF_INET):
            candidata = info[4][0]
            if not candidata.startswith("127."):
                return candidata
    except Exception:
        pass
    return "127.0.0.1"


def usuario_interactivo() -> str:
    """Usuario con la sesión de escritorio activa (para los eventos)."""
    try:
        import win32api
        import win32con
        import win32ts

        sesion = win32ts.WTSGetActiveConsoleSessionId()
        if sesion not in (None, 0xFFFFFFFF):
            nombre = win32api.GetUserNameEx(win32con.NameSamCompatible)
            if nombre:
                return nombre.split("\\")[-1]
    except Exception:
        pass
    return os.environ.get("USERNAME", "Sistema")
