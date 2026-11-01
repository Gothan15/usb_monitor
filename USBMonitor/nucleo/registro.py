# -*- coding: utf-8 -*-
"""Registro (log) del agente: un solo logger raíz con rotación."""
from __future__ import annotations

import logging
import os
from logging.handlers import RotatingFileHandler
from pathlib import Path

PROGRAM_DATA_DIR = (
    Path(os.environ.get("ProgramData", "C:/ProgramData")) / "USBMonitor"
)

_configurado = False


def directorio_datos() -> Path:
    PROGRAM_DATA_DIR.mkdir(parents=True, exist_ok=True)
    return PROGRAM_DATA_DIR


def configurar(nombre_archivo: str = "agente.log") -> logging.Logger:
    """Configura el logger 'usbmonitor' una sola vez por proceso."""
    global _configurado
    logger = logging.getLogger("usbmonitor")
    if _configurado:
        return logger
    logger.setLevel(logging.DEBUG)
    logger.propagate = False
    formato = logging.Formatter(
        "%(asctime)s [%(levelname)s] %(name)s: %(message)s",
        datefmt="%Y-%m-%d %H:%M:%S",
    )
    try:
        ruta = directorio_datos() / nombre_archivo
        manejador = RotatingFileHandler(
            ruta, maxBytes=5 * 1024 * 1024, backupCount=5, encoding="utf-8"
        )
        manejador.setFormatter(formato)
        logger.addHandler(manejador)
    except Exception:
        pass
    consola = logging.StreamHandler()
    consola.setFormatter(formato)
    consola.setLevel(logging.INFO)
    logger.addHandler(consola)
    _configurado = True
    return logger


def obtener(nombre: str) -> logging.Logger:
    return logging.getLogger(f"usbmonitor.{nombre}")
