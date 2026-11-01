# -*- coding: utf-8 -*-
"""Diario de cambios del sistema — la regla «sin huella».

Todo cambio persistente que el agente hace en Windows queda anotado
aquí con su valor original: dispositivos deshabilitados (instancia
exacta) y el estado del automontaje. La restauración revierte
exactamente eso, y solo borra una anotación cuando la reversión se
confirma: lo que no se pudo revertir sigue en el diario para el
próximo intento (al arrancar, al parar, al desinstalar o a mano).

Concurrencia: un único lock protege el estado; cada mutación se
persiste de forma atómica (temporal + os.replace) dentro del lock,
así dos hilos nunca dejan un diario a medias ni ilegible.
"""
from __future__ import annotations

import json
import os
import threading
from datetime import datetime
from pathlib import Path
from typing import Any, Callable, Dict, Optional

from .registro import PROGRAM_DATA_DIR, obtener

LOG = obtener("diario")

ARCHIVO = PROGRAM_DATA_DIR / "diario.json"


def _vacio() -> Dict[str, Any]:
    return {
        "automontaje_original": None,  # True/False tal como estaba
        "automontaje_desactivado": False,  # lo desactivó el agente
        "dispositivos_deshabilitados": {},  # instancia -> {serial, desde}
    }


class Diario:
    def __init__(self, ruta: Path = ARCHIVO):
        self._ruta = ruta
        self._lock = threading.RLock()
        self._datos: Dict[str, Any] = self._leer()

    # ── persistencia ──────────────────────────────────────────────
    def _leer(self) -> Dict[str, Any]:
        try:
            if self._ruta.is_file():
                datos = json.loads(self._ruta.read_text(encoding="utf-8"))
                if isinstance(datos, dict):
                    base = _vacio()
                    base.update(datos)
                    return base
        except Exception as exc:
            LOG.warning("Diario ilegible, se empieza de cero: %s", exc)
        return _vacio()

    def _persistir(self) -> None:
        # Se llama siempre con el lock tomado.
        try:
            self._ruta.parent.mkdir(parents=True, exist_ok=True)
            temporal = self._ruta.with_suffix(".json.tmp")
            temporal.write_text(
                json.dumps(self._datos, indent=2, ensure_ascii=False),
                encoding="utf-8",
            )
            os.replace(temporal, self._ruta)
        except Exception as exc:
            LOG.error("No se pudo persistir el diario: %s", exc)

    # ── consultas ─────────────────────────────────────────────────
    def estado(self) -> Dict[str, Any]:
        with self._lock:
            return json.loads(json.dumps(self._datos))

    def hay_pendientes(self) -> bool:
        with self._lock:
            return bool(
                self._datos["dispositivos_deshabilitados"]
                or self._datos["automontaje_desactivado"]
            )

    # ── anotaciones ───────────────────────────────────────────────
    def anotar_automontaje(self, original: bool, desactivado: bool) -> None:
        with self._lock:
            if self._datos["automontaje_original"] is None:
                self._datos["automontaje_original"] = original
            self._datos["automontaje_desactivado"] = desactivado
            self._persistir()

    def anotar_deshabilitado(self, instancia: str, serial: Optional[str]) -> None:
        with self._lock:
            self._datos["dispositivos_deshabilitados"][instancia] = {
                "serial": serial,
                "desde": datetime.now().isoformat(timespec="seconds"),
            }
            self._persistir()

    def quitar_deshabilitado(self, instancia: str) -> None:
        with self._lock:
            if instancia in self._datos["dispositivos_deshabilitados"]:
                del self._datos["dispositivos_deshabilitados"][instancia]
                self._persistir()

    # ── restauración ──────────────────────────────────────────────
    def restaurar_todo(
        self,
        habilitar: Callable[[str], bool],
        fijar_automontaje: Callable[[bool], bool],
    ) -> Dict[str, Any]:
        """Revierte todo lo anotado. Solo borra lo confirmado.

        habilitar(instancia) -> True si el dispositivo quedó habilitado.
        fijar_automontaje(activo) -> True si el automontaje quedó como se pide.
        """
        resumen = {"reactivados": 0, "sin_revertir": [], "automontaje": None}
        with self._lock:
            for instancia in list(self._datos["dispositivos_deshabilitados"]):
                try:
                    ok = bool(habilitar(instancia))
                except Exception as exc:
                    LOG.error("Reactivando %s: %s", instancia, exc)
                    ok = False
                if ok:
                    del self._datos["dispositivos_deshabilitados"][instancia]
                    resumen["reactivados"] += 1
                else:
                    resumen["sin_revertir"].append(instancia)
            if self._datos["automontaje_desactivado"]:
                original = self._datos["automontaje_original"]
                if original is not None:
                    try:
                        ok = bool(fijar_automontaje(bool(original)))
                    except Exception as exc:
                        LOG.error("Restaurando automontaje: %s", exc)
                        ok = False
                    if ok:
                        self._datos["automontaje_desactivado"] = False
                        resumen["automontaje"] = bool(original)
                    else:
                        resumen["sin_revertir"].append("automontaje")
            self._persistir()
        if resumen["sin_revertir"]:
            LOG.warning("Restauración incompleta: %s", resumen["sin_revertir"])
        else:
            LOG.info("Restauración completa: %s", resumen)
        return resumen
