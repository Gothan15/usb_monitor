# -*- coding: utf-8 -*-
"""Candado de volumen: FSCTL_LOCK_VOLUME + FSCTL_DISMOUNT_VOLUME con
el handle retenido. Mientras el servicio conserva el handle, Windows
no puede remontar el volumen: ni lectura ni escritura por el sistema
de archivos. Al soltar el handle, el volumen vuelve solo (el
automontaje de Windows no se toca en la v2: tocarlo fue parte del
problema de la v1).

El bloqueo solo se da por bueno tras la SONDA: listar la raíz del
volumen tiene que fallar. Sin sonda no hay bloqueo «confirmado».
"""
from __future__ import annotations

import ctypes
import os
import threading
import time
from ctypes import wintypes
from typing import Dict, Optional

from .registro import obtener

LOG = obtener("volumen")

FSCTL_LOCK_VOLUME = 0x00090018
FSCTL_DISMOUNT_VOLUME = 0x00090020

GENERIC_READ = 0x80000000
GENERIC_WRITE = 0x40000000
FILE_SHARE_READ = 0x00000001
FILE_SHARE_WRITE = 0x00000002
OPEN_EXISTING = 3
INVALID_HANDLE = -1

_kernel = ctypes.windll.kernel32


def ruta_volumen(letra: str) -> str:
    limpia = letra.strip().rstrip("\\/").rstrip(":")
    return f"{limpia}:\\"


def es_accesible(letra: str) -> bool:
    """Sonda: True si la raíz del volumen se puede listar."""
    try:
        os.listdir(ruta_volumen(letra))
        return True
    except OSError:
        return False


class CandadoVolumen:
    """Handle retenido sobre un volumen desmontado."""

    def __init__(self, letra: str):
        self.letra = letra.strip().upper().rstrip("\\/:") + ":"
        self._handle: Optional[int] = None

    def _abrir(self) -> bool:
        ruta = f"\\\\.\\{self.letra}"
        handle = _kernel.CreateFileW(
            ruta,
            GENERIC_READ | GENERIC_WRITE,
            FILE_SHARE_READ | FILE_SHARE_WRITE,
            None,
            OPEN_EXISTING,
            0,
            None,
        )
        if handle == INVALID_HANDLE or handle == 0:
            LOG.warning("CreateFileW(%s) falló: %s", ruta, ctypes.get_last_error())
            return False
        self._handle = int(handle)
        return True

    def _ioctl(self, codigo: int) -> bool:
        if self._handle is None:
            return False
        devueltos = wintypes.DWORD()
        ok = _kernel.DeviceIoControl(
            self._handle, codigo, None, 0, None, 0, ctypes.byref(devueltos), None
        )
        return bool(ok)

    def bloquear(self, intentos: int = 8, espera_s: float = 0.4) -> bool:
        """Bloquea, desmonta y verifica con la sonda."""
        if self._handle is None and not self._abrir():
            return False
        for _ in range(intentos):
            if self._ioctl(FSCTL_LOCK_VOLUME):
                break
            time.sleep(espera_s)
        else:
            LOG.warning("FSCTL_LOCK_VOLUME no cedió para %s", self.letra)
            self.soltar()
            return False
        if not self._ioctl(FSCTL_DISMOUNT_VOLUME):
            LOG.warning("FSCTL_DISMOUNT_VOLUME falló para %s", self.letra)
            self.soltar()
            return False
        if es_accesible(self.letra):
            LOG.warning("Sonda: %s sigue accesible tras desmontar", self.letra)
            self.soltar()
            return False
        return True

    def soltar(self) -> None:
        if self._handle is not None:
            try:
                _kernel.CloseHandle(self._handle)
            except Exception:
                pass
            self._handle = None


class CandadosVolumen:
    """Registro de candados por letra, seguro entre hilos."""

    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._candados: Dict[str, CandadoVolumen] = {}

    @staticmethod
    def _clave(letra: str) -> str:
        return letra.strip().upper().rstrip("\\/:") + ":"

    def bloquear(self, letra: str) -> bool:
        clave = self._clave(letra)
        with self._lock:
            previo = self._candados.get(clave)
            if previo is not None:
                return True  # ya retenido por este proceso
            candado = CandadoVolumen(clave)
            if not candado.bloquear():
                return False
            self._candados[clave] = candado
            return True

    def soltar(self, letra: str) -> None:
        clave = self._clave(letra)
        with self._lock:
            candado = self._candados.pop(clave, None)
        if candado is not None:
            candado.soltar()

    def soltar_todos(self) -> None:
        with self._lock:
            candados = list(self._candados.values())
            self._candados.clear()
        for candado in candados:
            candado.soltar()

    def retenida(self, letra: str) -> bool:
        with self._lock:
            return self._clave(letra) in self._candados
