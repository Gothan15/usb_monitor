# -*- coding: utf-8 -*-
"""Detección y clasificación de dispositivos (WMI).

Tipos: DISCO (memorias, carcasas USBSTOR y carcasas UAS: disco SCSI
con ancestro USB — un SATA interno también es SCSI y jamás debe
clasificar), TELEFONO (WPD/MTP, sin letra, por serial), OPTICO
(unidades de CD/DVD USB físicas) y RED (adaptadores USB; el servicio
aplica la regla de línea base sobre ellos).

La clasificación vive en funciones puras (`clasificar_disco`,
`limpiar_serial`) separadas de WMI para poder probarla sin Windows.
"""
from __future__ import annotations

import re
from dataclasses import dataclass, field
from typing import Callable, Dict, List, Optional

from .registro import obtener

LOG = obtener("dispositivos")

TIPO_DISCO = "DISCO"
TIPO_TELEFONO = "TELEFONO"
TIPO_OPTICO = "OPTICO"
TIPO_RED = "RED"


@dataclass
class Dispositivo:
    instancia: str
    serial: str
    nombre: str
    tipo: str
    letras: List[str] = field(default_factory=list)
    tamano: int = 0

    @property
    def clave(self) -> str:
        return self.instancia.strip().upper()

    @property
    def letra(self) -> Optional[str]:
        return self.letras[0] if self.letras else None


_RE_SERIAL_SUCIO = re.compile(r"[^A-Za-z0-9\-_]")


def limpiar_serial(bruto: Optional[str]) -> str:
    """Serial utilizable: sin espacios extremos ni sufijos de instancia.

    Lección de la v1: de un id de instancia puede salir un «serial»
    como «0» (del sufijo &0) o «N/A»; eso no identifica nada.
    """
    if not bruto:
        return ""
    serial = str(bruto).strip()
    if serial.upper() in ("N/A", "NA", "NONE", "NULL", "0"):
        return ""
    # Cola típica de id de instancia: \&0 o &0 al final.
    serial = re.sub(r"&0$", "", serial).strip()
    if serial.upper() in ("", "N/A", "NA"):
        return ""
    return serial


def serial_desde_instancia(instancia: str) -> str:
    partes = [p for p in str(instancia).split("\\") if p]
    if not partes:
        return ""
    return limpiar_serial(partes[-1])


def clasificar_disco(
    instancia: str,
    ancestros: List[str],
    modelo: str = "",
) -> Optional[str]:
    """DISCO si el disco es externo USB; None si no debe vigilarse."""
    superior = (instancia or "").upper()
    if superior.startswith("USBSTOR\\DISK"):
        return TIPO_DISCO
    if superior.startswith("SCSI\\DISK"):
        # Carcasa UAS o disco interno: solo cuenta con ancestro USB.
        for ancestro in ancestros or []:
            a = ancestro.upper()
            if a.startswith("USB\\") or "\\USB\\" in a:
                return TIPO_DISCO
        return None
    return None


def es_optico_usb(instancia: str, modelo: str = "") -> bool:
    superior = (instancia or "").upper()
    if not superior.startswith("USBSTOR\\CDROM"):
        return False
    texto = (modelo or "").lower()
    # Unidades virtuales (montadores de imágenes): no se vigilan.
    return "virtual" not in texto


class Detector:
    """Enumeración WMI. `ancestros_de` (instancia -> instancias padre)
    se inyecta para poder probar la clasificación sin Windows."""

    def __init__(self, ancestros_de: Callable[[str], List[str]]):
        self._ancestros_de = ancestros_de
        self._wmi = None

    def _conectar(self):
        if self._wmi is None:
            import pythoncom
            import wmi

            pythoncom.CoInitialize()
            self._wmi = wmi.WMI()
        return self._wmi

    # ── piezas ────────────────────────────────────────────────────
    def _letras_de_disco(self, disco_wmi) -> List[str]:
        letras: List[str] = []
        try:
            for particion in disco_wmi.associators("Win32_DiskDriveToDiskPartition"):
                for logico in particion.associators("Win32_LogicalDiskToPartition"):
                    device_id = getattr(logico, "DeviceID", None)
                    if device_id:
                        letras.append(str(device_id).upper())
        except Exception as exc:
            LOG.debug("Letras del disco no resueltas: %s", exc)
        return letras

    def enumerar(self) -> Dict[str, Dispositivo]:
        """Foto actual de los dispositivos vigilables, por clave."""
        encontrados: Dict[str, Dispositivo] = {}
        try:
            c = self._conectar()
        except Exception as exc:
            LOG.warning("WMI no disponible: %s", exc)
            return encontrados

        # Discos
        try:
            for disco in c.Win32_DiskDrive():
                instancia = getattr(disco, "PNPDeviceID", "") or ""
                if not instancia:
                    continue
                ancestros: List[str] = []
                if instancia.upper().startswith("SCSI\\"):
                    # Solo las carcasas SCSI necesitan mirar al padre:
                    # el llamador inyecta el resolvedor (cfgmgr32).
                    try:
                        ancestros = self._ancestros_de(instancia)
                    except Exception:
                        ancestros = []
                tipo = clasificar_disco(
                    instancia, ancestros, getattr(disco, "Model", "") or ""
                )
                if tipo is None:
                    continue
                serial = limpiar_serial(getattr(disco, "SerialNumber", None))
                if not serial:
                    serial = serial_desde_instancia(instancia)
                disp = Dispositivo(
                    instancia=instancia,
                    serial=serial,
                    nombre=(getattr(disco, "Model", "") or "Disco USB").strip(),
                    tipo=tipo,
                    letras=self._letras_de_disco(disco),
                    tamano=int(getattr(disco, "Size", 0) or 0),
                )
                encontrados[disp.clave] = disp
        except Exception as exc:
            LOG.warning("Enumerando discos: %s", exc)

        # Ópticas USB
        try:
            for cd in c.Win32_CDROMDrive():
                instancia = getattr(cd, "PNPDeviceID", "") or ""
                if not es_optico_usb(instancia, getattr(cd, "Caption", "") or ""):
                    continue
                letra = getattr(cd, "Drive", None)
                disp = Dispositivo(
                    instancia=instancia,
                    serial=limpiar_serial(getattr(cd, "SerialNumber", None))
                    or serial_desde_instancia(instancia),
                    nombre=(getattr(cd, "Caption", "") or "Unidad óptica USB").strip(),
                    tipo=TIPO_OPTICO,
                    letras=[str(letra).upper()] if letra else [],
                )
                encontrados[disp.clave] = disp
        except Exception as exc:
            LOG.debug("Enumerando ópticas: %s", exc)

        # Teléfonos (WPD/MTP)
        try:
            for entidad in c.Win32_PnPEntity(PNPClass="WPD"):
                instancia = getattr(entidad, "PNPDeviceID", "") or ""
                if not instancia:
                    continue
                disp = Dispositivo(
                    instancia=instancia,
                    serial=serial_desde_instancia(instancia),
                    nombre=(getattr(entidad, "Name", "") or "Teléfono").strip(),
                    tipo=TIPO_TELEFONO,
                )
                encontrados[disp.clave] = disp
        except Exception as exc:
            LOG.debug("Enumerando WPD: %s", exc)

        # Red por USB (tethering, docks)
        try:
            for adaptador in c.Win32_NetworkAdapter(PhysicalAdapter=True):
                instancia = getattr(adaptador, "PNPDeviceID", "") or ""
                if not instancia.upper().startswith("USB\\"):
                    continue
                disp = Dispositivo(
                    instancia=instancia,
                    serial=limpiar_serial(getattr(adaptador, "MACAddress", None))
                    or serial_desde_instancia(instancia),
                    nombre=(getattr(adaptador, "Name", "") or "Red USB").strip(),
                    tipo=TIPO_RED,
                )
                encontrados[disp.clave] = disp
        except Exception as exc:
            LOG.debug("Enumerando red USB: %s", exc)

        return encontrados


def unidades_para_estado(dispositivos: Dict[str, Dispositivo]) -> List[Dict]:
    """Formato de /api/usb-event/connected-status: solo con letra."""
    unidades: List[Dict] = []
    for disp in dispositivos.values():
        for letra in disp.letras:
            unidades.append(
                {
                    "driveLetter": letra,
                    "volumeName": disp.nombre,
                    "serialNumber": disp.serial,
                    "model": disp.nombre,
                    "size": disp.tamano,
                }
            )
    return unidades
