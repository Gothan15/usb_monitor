# -*- coding: utf-8 -*-
"""Emergencia sin red: desbloqueo local con la contraseña del dueño.

El panel entrega el hash argon2 del dueño del equipo
(/api/agent/owner-hash) cuando hay conexión; el agente lo guarda y,
sin red, verifica la contraseña localmente contra ese hash. Solo el
dueño: un administrador no tiene hash local que lo respalde.

Intentos: máximo 5 por dispositivo; al quinto fallo, 15 minutos de
espera. El contador se persiste (reiniciar el servicio no lo
resetea) y va bajo lock. Cada intento queda en una lista pendiente
de subir al panel (/api/agent/offline-attempts) con el formato
exacto que el servidor espera.
"""
from __future__ import annotations

import json
import os
import threading
from datetime import datetime, timedelta
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

from .registro import PROGRAM_DATA_DIR, obtener

LOG = obtener("emergencia")

ARCHIVO_DUENO = PROGRAM_DATA_DIR / "dueno.json"
ARCHIVO_ESTADO = PROGRAM_DATA_DIR / "emergencia_estado.json"
ARCHIVO_INTENTOS = PROGRAM_DATA_DIR / "intentos_pendientes.json"

MAX_INTENTOS = 5
ESPERA_MINUTOS = 15


def _escribir_atomico(ruta: Path, datos: Any) -> None:
    ruta.parent.mkdir(parents=True, exist_ok=True)
    temporal = ruta.with_suffix(".json.tmp")
    temporal.write_text(json.dumps(datos, ensure_ascii=False), encoding="utf-8")
    os.replace(temporal, ruta)


def _leer_json(ruta: Path, defecto: Any) -> Any:
    try:
        if ruta.is_file():
            datos = json.loads(ruta.read_text(encoding="utf-8"))
            return datos
    except Exception:
        pass
    return defecto


class Emergencia:
    def __init__(self) -> None:
        self._lock = threading.Lock()

    # ── hash del dueño ────────────────────────────────────────────
    def guardar_hash(self, username: str, password_hash: str) -> None:
        with self._lock:
            _escribir_atomico(
                ARCHIVO_DUENO,
                {
                    "username": username,
                    "passwordHash": password_hash,
                    "actualizado": datetime.now().isoformat(timespec="seconds"),
                },
            )

    def dueno(self) -> Optional[Dict[str, str]]:
        datos = _leer_json(ARCHIVO_DUENO, None)
        if isinstance(datos, dict) and datos.get("passwordHash"):
            return datos
        return None

    # ── verificación ──────────────────────────────────────────────
    def _estado(self) -> Dict[str, Any]:
        datos = _leer_json(ARCHIVO_ESTADO, {})
        return datos if isinstance(datos, dict) else {}

    def verificar(
        self,
        clave_dispositivo: str,
        username: str,
        password: str,
        *,
        letra: Optional[str],
        serial: Optional[str],
    ) -> Tuple[bool, str]:
        """(autorizado, motivo). Registra el intento para subirlo."""
        dueno = self.dueno()
        if not dueno:
            return False, "sin_hash"

        with self._lock:
            estados = self._estado()
            entrada = estados.get(clave_dispositivo, {"fallos": 0, "hasta": None})
            hasta = entrada.get("hasta")
            if hasta:
                try:
                    if datetime.fromisoformat(hasta) > datetime.now():
                        return False, "espera"
                except ValueError:
                    pass

            autorizado = False
            if username.strip().lower() == str(dueno["username"]).strip().lower():
                try:
                    from argon2 import PasswordHasher

                    PasswordHasher().verify(dueno["passwordHash"], password)
                    autorizado = True
                except Exception:
                    autorizado = False

            if autorizado:
                estados.pop(clave_dispositivo, None)
            else:
                fallos = int(entrada.get("fallos", 0)) + 1
                nueva = {"fallos": fallos, "hasta": None}
                if fallos >= MAX_INTENTOS:
                    nueva = {
                        "fallos": 0,
                        "hasta": (
                            datetime.now() + timedelta(minutes=ESPERA_MINUTOS)
                        ).isoformat(timespec="seconds"),
                    }
                estados[clave_dispositivo] = nueva
            _escribir_atomico(ARCHIVO_ESTADO, estados)

        self._anotar_intento(
            username, autorizado, letra=letra, serial=serial
        )
        return autorizado, ("ok" if autorizado else "credenciales")

    # ── intentos pendientes de subir ──────────────────────────────
    def _anotar_intento(
        self,
        username: str,
        autorizado: bool,
        *,
        letra: Optional[str],
        serial: Optional[str],
    ) -> None:
        intento = {
            "usernameTried": username,
            "result": "OFFLINE_OK" if autorizado else "OFFLINE_FAIL",
            "driveLetter": letra,
            "serialNumber": serial,
            "createdAt": datetime.now().isoformat(timespec="seconds"),
        }
        with self._lock:
            intentos = _leer_json(ARCHIVO_INTENTOS, [])
            if not isinstance(intentos, list):
                intentos = []
            intentos.append(intento)
            _escribir_atomico(ARCHIVO_INTENTOS, intentos[-500:])

    def intentos_pendientes(self) -> List[Dict[str, Any]]:
        datos = _leer_json(ARCHIVO_INTENTOS, [])
        return datos if isinstance(datos, list) else []

    def limpiar_intentos(self) -> None:
        with self._lock:
            _escribir_atomico(ARCHIVO_INTENTOS, [])
