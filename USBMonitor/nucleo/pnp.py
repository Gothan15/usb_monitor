# -*- coding: utf-8 -*-
"""Costuras PnP de Windows (cfgmgr32) — la única puerta del agente a
los nodos de dispositivo.

Regla de oro de la v2: ninguna acción se da por buena por el código
de retorno de la llamada; se **verifica** leyendo el estado real del
nodo después (código de problema 22 = deshabilitado).

Los nodos «fantasma» (dispositivo ya extraído) también se localizan:
reactivar un nodo desconectado es lo que garantiza que esa memoria
vuelva a entrar normal la próxima vez (el fallo de la v1 con la
SanDisk Cruzer: quedó deshabilitada para siempre).
"""
from __future__ import annotations

import ctypes
import time
from ctypes import wintypes
from typing import List, Optional

from .registro import obtener

LOG = obtener("pnp")

CM_PROB_DISABLED = 22
CM_LOCATE_DEVNODE_NORMAL = 0x0
CM_LOCATE_DEVNODE_PHANTOM = 0x1
CR_SUCCESS = 0

_cfg = ctypes.windll.cfgmgr32
_kernel = ctypes.windll.kernel32


def _localizar(instancia: str, fantasma: bool = False) -> Optional[int]:
    devinst = wintypes.DWORD()
    resultado = _cfg.CM_Locate_DevNodeW(
        ctypes.byref(devinst),
        ctypes.c_wchar_p(instancia),
        CM_LOCATE_DEVNODE_PHANTOM if fantasma else CM_LOCATE_DEVNODE_NORMAL,
    )
    if resultado != CR_SUCCESS:
        return None
    return int(devinst.value)


def localizar(instancia: str) -> Optional[int]:
    """Localiza el nodo, presente o fantasma; None si no existe."""
    devinst = _localizar(instancia, fantasma=False)
    if devinst is None:
        devinst = _localizar(instancia, fantasma=True)
    return devinst


def _estado(devinst: int) -> tuple[int, int]:
    status = wintypes.DWORD()
    problema = wintypes.DWORD()
    resultado = _cfg.CM_Get_DevNode_Status(
        ctypes.byref(status), ctypes.byref(problema), devinst, 0
    )
    if resultado != CR_SUCCESS:
        return (0, 0)
    return (int(status.value), int(problema.value))


def esta_deshabilitado(instancia: str) -> Optional[bool]:
    """True/False según el nodo; None si el nodo no se puede leer."""
    devinst = localizar(instancia)
    if devinst is None:
        return None
    _, problema = _estado(devinst)
    return problema == CM_PROB_DISABLED


def _esperar_estado(instancia: str, deshabilitado: bool, segundos: float = 3.0) -> bool:
    limite = time.monotonic() + segundos
    while time.monotonic() <= limite:
        actual = esta_deshabilitado(instancia)
        if actual is deshabilitado:
            return True
        time.sleep(0.15)
    return esta_deshabilitado(instancia) is deshabilitado


def deshabilitar(instancia: str) -> bool:
    """Deshabilita el nodo y VERIFICA que quedó deshabilitado."""
    devinst = _localizar(instancia)
    if devinst is None:
        LOG.warning("No se localizó el nodo para deshabilitar: %s", instancia)
        return False
    if esta_deshabilitado(instancia):
        return True
    resultado = _cfg.CM_Disable_DevNode(devinst, 0)
    if resultado != CR_SUCCESS:
        LOG.warning("CM_Disable_DevNode(%s) -> %s", instancia, resultado)
    return _esperar_estado(instancia, True)


def habilitar(instancia: str) -> bool:
    """Habilita el nodo (presente o fantasma) y VERIFICA el resultado."""
    devinst = localizar(instancia)
    if devinst is None:
        # El nodo ya no existe en el sistema: nada que revertir.
        LOG.info("Nodo inexistente al habilitar (nada que revertir): %s", instancia)
        return True
    if esta_deshabilitado(instancia) is False:
        return True
    resultado = _cfg.CM_Enable_DevNode(devinst, 0)
    if resultado != CR_SUCCESS:
        LOG.warning("CM_Enable_DevNode(%s) -> %s", instancia, resultado)
    return _esperar_estado(instancia, False)


def _id_de(devinst: int) -> Optional[str]:
    largo = wintypes.DWORD()
    _cfg.CM_Get_Device_ID_Size(ctypes.byref(largo), devinst, 0)
    if not largo.value:
        return None
    bufer = ctypes.create_unicode_buffer(largo.value + 1)
    if _cfg.CM_Get_Device_IDW(devinst, bufer, largo.value + 1, 0) != CR_SUCCESS:
        return None
    return bufer.value


def ancestros(instancia: str, maximo: int = 3) -> List[str]:
    """Instancias padre (hasta `maximo`), para clasificar discos SCSI."""
    resultado: List[str] = []
    devinst = _localizar(instancia)
    if devinst is None:
        return resultado
    actual = devinst
    for _ in range(maximo):
        padre = wintypes.DWORD()
        if _cfg.CM_Get_Parent(ctypes.byref(padre), actual, 0) != CR_SUCCESS:
            break
        actual = int(padre.value)
        identificador = _id_de(actual)
        if not identificador:
            break
        resultado.append(identificador)
    return resultado


def tiene_ancestro_usb(instancia: str, maximo: int = 3) -> bool:
    """True si algún ancestro pertenece al enumerador USB."""
    for ancestro in ancestros(instancia, maximo):
        if ancestro.upper().startswith("USB\\") or "\\USB\\" in ancestro.upper():
            return True
    return False
