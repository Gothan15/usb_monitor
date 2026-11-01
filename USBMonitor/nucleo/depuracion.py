# -*- coding: utf-8 -*-
"""Latido de depuración: una línea por segundo en `latido.log`.

Sirve para reconstruir qué estaba pasando justo antes de un cierre
inesperado: cuánto llevaba en marcha el agente, si el compañero
vivía, cuántos dispositivos había bloqueados, cuántos eventos
esperaban en la cola y cómo estaba la conexión con el panel.

Activo por defecto; se apaga poniendo la variable de entorno
USBMONITOR_DEPURACION a "0" (es una variable de depuración, no de
configuración del agente: la configuración sigue viviendo solo en
server.json).
"""
from __future__ import annotations

import logging
import os
import threading
import time
from logging.handlers import RotatingFileHandler
from typing import Any, Callable, Dict, Optional

from .registro import directorio_datos, obtener

LOG = obtener("depuracion")

_formato = logging.Formatter(
    "%(asctime)s [%(levelname)s] %(name)s: %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S",
)


def _logger_latido() -> logging.Logger:
    """Logger propio para latido.log (no se mezcla con agente.log)."""
    logger = logging.getLogger("usbmonitor.latido")
    logger.setLevel(logging.DEBUG)
    logger.propagate = False
    ruta = str(directorio_datos() / "latido.log")
    for manejador in logger.handlers:
        if getattr(manejador, "baseFilename", None) == ruta:
            return logger
    try:
        manejador = RotatingFileHandler(
            ruta, maxBytes=2 * 1024 * 1024, backupCount=3, encoding="utf-8"
        )
        manejador.setFormatter(_formato)
        logger.addHandler(manejador)
    except Exception:
        pass
    return logger


def _resumen(datos: Dict[str, Any]) -> str:
    companero = datos.get("companero")
    texto_companero = (
        "sí" if companero is True else "no" if companero is False else "desconocido"
    )
    salud = datos.get("salud") or {}
    return (
        f"en_marcha={float(datos.get('segundos_en_marcha') or 0):.0f}s "
        f"companero={texto_companero} "
        f"bloqueados={datos.get('bloqueados', '?')} "
        f"cola_eventos={datos.get('cola_eventos', '?')} "
        f"salud_ok={salud.get('ok', '?')} salud_fallos={salud.get('fallos', '?')} "
        f"ultimo_exito={salud.get('ultimo_exito') or '—'} "
        f"ultimo_fallo={salud.get('ultimo_fallo') or '—'} "
        f"detalle_ultimo_fallo={salud.get('detalle_ultimo_fallo') or '—'} "
        f"url={salud.get('url_base') or '—'} pc={salud.get('pc') or '—'}"
    )


def iniciar_latido(
    proveedor: Callable[[], Dict[str, Any]], deteniendo: threading.Event
) -> Optional[threading.Thread]:
    """Lanza el hilo del latido (daemon). Devuelve el hilo, o None
    si la depuración está desactivada por el entorno."""
    if os.environ.get("USBMONITOR_DEPURACION", "").strip() == "0":
        LOG.info("Latido de depuración desactivado (USBMONITOR_DEPURACION=0)")
        return None
    latido = _logger_latido()

    def bucle() -> None:
        estado_companero: Optional[bool] = None
        desde = time.monotonic()
        while not deteniendo.is_set():
            try:
                datos = proveedor()
                latido.info(_resumen(datos))
                actual = datos.get("companero")
                if isinstance(actual, bool):
                    ahora = time.monotonic()
                    if estado_companero is None:
                        estado_companero = actual
                        desde = ahora
                    elif actual != estado_companero:
                        duracion = ahora - desde
                        if estado_companero:
                            LOG.warning(
                                "El compañero dejó de estar en marcha "
                                "(estuvo en marcha %.0f s)",
                                duracion,
                            )
                        else:
                            LOG.info(
                                "El compañero está en marcha de nuevo "
                                "(estuvo parado %.0f s)",
                                duracion,
                            )
                        estado_companero = actual
                        desde = ahora
            except Exception as exc:
                # El latido nunca debe tumbar al agente.
                try:
                    latido.info("latido sin datos: %s", exc)
                except Exception:
                    pass
            deteniendo.wait(1)

    hilo = threading.Thread(target=bucle, daemon=True, name="latido-depuracion")
    hilo.start()
    return hilo
