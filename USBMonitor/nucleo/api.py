# -*- coding: utf-8 -*-
"""Cliente del panel. Contrato auditado contra las rutas reales del
servidor el 2026-11-01 (ver la especificación, sección 7):

  POST /api/usb-event                 {pc_name, pc_ip, pc_user, event,
                                       drive_letter, serial_number,
                                       readonly_status, whitelisted}
  POST /api/usb-event/pending-unlock  {pcName, driveLetter?, serialNumber?,
                                       deviceLabel?, whitelisted} -> {id}
  POST /api/usb-event/pending-close   {pcName, driveLetter?, serialNumber?}
  POST /api/usb-event/connected-status{pcName, connectedDrives:[...]}
  GET  /api/usb-unlock/status?pcName&check=true
                                  -> {unlocked, pendings:[{id, driveLetter,
                                       serialNumber}]}
  POST /api/usb-auth                  {username, password, pcName,
                                       driveLetter?, serialNumber?}
  GET  /api/whitelist/check?serial    -> {allowed, entry}
  GET  /api/agent/config              -> {startupNetworkDelay,
                                          lockSessionOnInsert}
  GET  /api/agent/owner-hash?pcName   -> {username, passwordHash}
  POST /api/agent/offline-attempts    {pcName, attempts:[{usernameTried,
                                       result, driveLetter, serialNumber,
                                       createdAt}]}

Los eventos van con cola persistente: sin red se guardan en disco y
se suben en orden al volver la conexión (un solo hilo vacía la cola;
los demás solo encolan). El resto de llamadas son directas y devuelven
None ante cualquier fallo de red, para que quien llama decida.
"""
from __future__ import annotations

import json
import os
import threading
from collections import deque
from datetime import datetime
from pathlib import Path
from typing import Any, Dict, List, Optional

import requests

from . import config
from .registro import PROGRAM_DATA_DIR, obtener

LOG = obtener("api")

ARCHIVO_COLA = PROGRAM_DATA_DIR / "cola_eventos.json"
MAX_COLA = 2000
TIMEOUT = (4, 8)


class ClientePanel:
    def __init__(self) -> None:
        self._sesion = requests.Session()
        self._lock_cola = threading.Lock()
        self._cola: deque[Dict[str, Any]] = deque(self._leer_cola())

    # ── transporte ────────────────────────────────────────────────
    def _peticion(self, metodo: str, ruta: str, **kwargs: Any) -> Optional[requests.Response]:
        url = config.url_base() + ruta
        headers = dict(kwargs.pop("headers", {}) or {})
        headers.update(config.cabeceras_auth())
        verify: Any = config.certificado_tls() or config.verificar_tls()
        try:
            return self._sesion.request(
                metodo, url, headers=headers, timeout=TIMEOUT, verify=verify, **kwargs
            )
        except requests.RequestException as exc:
            LOG.debug("%s %s sin respuesta: %s", metodo, ruta, exc)
            return None

    @staticmethod
    def _json(respuesta: Optional[requests.Response]) -> Optional[Dict[str, Any]]:
        if respuesta is None:
            return None
        try:
            datos = respuesta.json()
            return datos if isinstance(datos, dict) else None
        except Exception:
            return None

    # ── cola de eventos (store-and-forward) ──────────────────────
    def _leer_cola(self) -> List[Dict[str, Any]]:
        try:
            if ARCHIVO_COLA.is_file():
                datos = json.loads(ARCHIVO_COLA.read_text(encoding="utf-8"))
                if isinstance(datos, list):
                    return datos[-MAX_COLA:]
        except Exception as exc:
            LOG.warning("Cola de eventos ilegible: %s", exc)
        return []

    def _persistir_cola(self) -> None:
        # Con _lock_cola tomado.
        try:
            ARCHIVO_COLA.parent.mkdir(parents=True, exist_ok=True)
            temporal = ARCHIVO_COLA.with_suffix(".json.tmp")
            temporal.write_text(
                json.dumps(list(self._cola), ensure_ascii=False), encoding="utf-8"
            )
            os.replace(temporal, ARCHIVO_COLA)
        except Exception as exc:
            LOG.error("No se pudo persistir la cola: %s", exc)

    def encolar_evento(self, payload: Dict[str, Any]) -> None:
        with self._lock_cola:
            self._cola.append(payload)
            while len(self._cola) > MAX_COLA:
                self._cola.popleft()
            self._persistir_cola()

    def eventos_en_cola(self) -> int:
        with self._lock_cola:
            return len(self._cola)

    def vaciar_cola(self) -> int:
        """Sube los eventos en orden FIFO. Devuelve cuántos salieron.

        Un evento solo sale de la cola cuando el servidor responde
        2xx: si la red cae a mitad, el resto espera al próximo ciclo
        y el orden se conserva.
        """
        enviados = 0
        while True:
            with self._lock_cola:
                if not self._cola:
                    return enviados
                siguiente = self._cola[0]
            respuesta = self._peticion("POST", "/api/usb-event", json=siguiente)
            if respuesta is None or not (200 <= respuesta.status_code < 300):
                return enviados
            with self._lock_cola:
                if self._cola and self._cola[0] is siguiente:
                    self._cola.popleft()
                elif siguiente in self._cola:
                    self._cola.remove(siguiente)
                self._persistir_cola()
            enviados += 1

    # ── eventos ───────────────────────────────────────────────────
    def evento(
        self,
        tipo: str,
        *,
        letra: Optional[str] = None,
        serial: Optional[str] = None,
        solo_lectura: Optional[str] = None,
        en_whitelist: Optional[bool] = None,
    ) -> None:
        payload: Dict[str, Any] = {
            "pc_name": config.nombre_pc(),
            "pc_ip": config.ip_pc(),
            "pc_user": config.usuario_interactivo(),
            "event": tipo,
            "drive_letter": letra,
            "serial_number": serial,
            "readonly_status": solo_lectura,
        }
        if en_whitelist is not None:
            payload["whitelisted"] = bool(en_whitelist)
        self.encolar_evento(payload)

    # ── bloqueos en el panel ─────────────────────────────────────
    def registrar_bloqueo(
        self,
        *,
        letra: Optional[str],
        serial: Optional[str],
        etiqueta: Optional[str],
        en_whitelist: bool,
    ) -> Optional[str]:
        datos = self._json(
            self._peticion(
                "POST",
                "/api/usb-event/pending-unlock",
                json={
                    "pcName": config.nombre_pc(),
                    "driveLetter": letra,
                    "serialNumber": serial,
                    "deviceLabel": etiqueta,
                    "whitelisted": bool(en_whitelist),
                },
            )
        )
        if datos and datos.get("ok"):
            return datos.get("id")
        return None

    def cerrar_bloqueo(self, *, letra: Optional[str], serial: Optional[str]) -> bool:
        datos = self._json(
            self._peticion(
                "POST",
                "/api/usb-event/pending-close",
                json={
                    "pcName": config.nombre_pc(),
                    "driveLetter": letra,
                    "serialNumber": serial,
                },
            )
        )
        return bool(datos and datos.get("ok"))

    def sondear_desbloqueos(self) -> List[Dict[str, Any]]:
        """Bloqueos ya autorizados esperando ejecución (reclamados)."""
        datos = self._json(
            self._peticion(
                "GET",
                "/api/usb-unlock/status",
                params={"pcName": config.nombre_pc(), "check": "true"},
            )
        )
        if datos and datos.get("ok"):
            return list(datos.get("pendings") or [])
        return []

    # ── consultas ─────────────────────────────────────────────────
    def comprobar_whitelist(self, serial: str) -> Optional[bool]:
        """True/False según el servidor; None si no se pudo preguntar."""
        datos = self._json(
            self._peticion("GET", "/api/whitelist/check", params={"serial": serial})
        )
        if datos and datos.get("ok"):
            return bool(datos.get("allowed"))
        return None

    def estado_conectados(self, unidades: List[Dict[str, Any]]) -> bool:
        datos = self._json(
            self._peticion(
                "POST",
                "/api/usb-event/connected-status",
                json={"pcName": config.nombre_pc(), "connectedDrives": unidades},
            )
        )
        return bool(datos and datos.get("ok"))

    def config_remota(self) -> Optional[Dict[str, Any]]:
        datos = self._json(self._peticion("GET", "/api/agent/config"))
        if datos and datos.get("ok"):
            return datos
        return None

    def hash_dueno(self) -> Optional[Dict[str, Any]]:
        datos = self._json(
            self._peticion(
                "GET", "/api/agent/owner-hash", params={"pcName": config.nombre_pc()}
            )
        )
        if datos and datos.get("ok"):
            return datos
        return None

    def subir_intentos_offline(self, intentos: List[Dict[str, Any]]) -> bool:
        if not intentos:
            return True
        datos = self._json(
            self._peticion(
                "POST",
                "/api/agent/offline-attempts",
                json={"pcName": config.nombre_pc(), "attempts": intentos},
            )
        )
        return bool(datos and datos.get("ok"))

    # ── desbloqueo (lo usa el compañero) ─────────────────────────
    def autenticar_desbloqueo(
        self,
        usuario: str,
        contrasena: str,
        *,
        letra: Optional[str],
        serial: Optional[str],
    ) -> Dict[str, Any]:
        """Respuesta cruda de /api/usb-auth para la ventana.

        Devuelve {estado_http, autorizado, mensaje}: el servidor
        responde 200 si autoriza, 403 con mensaje (fuera de la
        whitelist o desbloqueo desactivado) y 401 genérico para
        credenciales o propiedad no válidas.
        """
        respuesta = self._peticion(
            "POST",
            "/api/usb-auth",
            json={
                "username": usuario,
                "password": contrasena,
                "pcName": config.nombre_pc(),
                "driveLetter": letra,
                "serialNumber": serial,
            },
        )
        if respuesta is None:
            return {
                "estado_http": 0,
                "autorizado": False,
                "mensaje": "Sin conexión con el servidor.",
            }
        datos = self._json(respuesta) or {}
        return {
            "estado_http": respuesta.status_code,
            "autorizado": bool(datos.get("authorized")),
            "mensaje": datos.get("message") or "",
        }


def ahora_iso() -> str:
    return datetime.now().isoformat(timespec="seconds")
