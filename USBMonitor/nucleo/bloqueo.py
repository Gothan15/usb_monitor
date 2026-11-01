# -*- coding: utf-8 -*-
"""Motor de bloqueo en capas, verificado, con vigía.

Capas, en orden (cada una se comprueba contra el sistema, nunca se
cree el «OK» de una llamada):
  1. PNP: deshabilitar el nodo del dispositivo y verificar que
     quedó deshabilitado (código de problema 22).
  2. VOLUMEN: candado FSCTL (bloquear + desmontar, handle retenido)
     con sonda de inaccesibilidad. Solo para dispositivos con letra.
  3. SOLO_LECTURA: último recurso, declarado como degradado.

Concurrencia (sin condiciones de carrera):
  - Un lock global protege el registro de dispositivos y el mapa de
    locks por dispositivo; cada transición de un dispositivo
    (bloquear, liberar, extraer) ocurre bajo SU lock: dos hilos
    nunca transicionan el mismo dispositivo a la vez.
  - Bloquear y liberar son idempotentes: repetir la llamada sobre un
    dispositivo ya en el estado destino es un no-op.
  - El vigía no actúa sobre dispositivos en plena transición porque
    comparte el mismo lock por dispositivo.

Sin huella: deshabilitar un nodo se anota en el Diario al momento; la
anotación solo se borra cuando la reactivación se verifica.
"""
from __future__ import annotations

import threading
import time
from dataclasses import dataclass, field
from typing import Callable, Dict, List, Optional

from .diario import Diario
from .dispositivos import Dispositivo, TIPO_TELEFONO
from .registro import obtener

LOG = obtener("bloqueo")

CAPA_PNP = "PNP"
CAPA_VOLUMEN = "VOLUMEN"
CAPA_SOLO_LECTURA = "SOLO_LECTURA"

ESTADO_BLOQUEADO = "BLOQUEADO"
ESTADO_LIBERADO = "LIBERADO"


@dataclass
class Registro:
    dispositivo: Dispositivo
    estado: str = ESTADO_LIBERADO
    capa: Optional[str] = None
    degradado: bool = False
    en_whitelist: Optional[bool] = None


class MotorBloqueo:
    """Las costuras del sistema se inyectan (pnp, candados, atributos)
    para poder probar la lógica sin Windows."""

    def __init__(
        self,
        diario: Diario,
        *,
        deshabilitar: Callable[[str], bool],
        habilitar: Callable[[str], bool],
        esta_deshabilitado: Callable[[str], Optional[bool]],
        candados,  # CandadosVolumen
        accesible: Callable[[str], bool],
        poner_solo_lectura: Optional[Callable[[str], bool]] = None,
        quitar_solo_lectura: Optional[Callable[[str], bool]] = None,
    ):
        self._diario = diario
        self._deshabilitar = deshabilitar
        self._habilitar = habilitar
        self._esta_deshabilitado = esta_deshabilitado
        self._candados = candados
        self._accesible = accesible
        self._poner_sl = poner_solo_lectura
        self._quitar_sl = quitar_solo_lectura
        self._lock_global = threading.RLock()
        self._registros: Dict[str, Registro] = {}
        self._locks: Dict[str, threading.RLock] = {}

    # ── infraestructura de locks ──────────────────────────────────
    def _lock_de(self, clave: str) -> threading.RLock:
        with self._lock_global:
            lock = self._locks.get(clave)
            if lock is None:
                lock = threading.RLock()
                self._locks[clave] = lock
            return lock

    def registro(self, clave: str) -> Optional[Registro]:
        with self._lock_global:
            return self._registros.get(clave)

    def bloqueados(self) -> List[Registro]:
        with self._lock_global:
            return [
                r for r in self._registros.values() if r.estado == ESTADO_BLOQUEADO
            ]

    def olvidar(self, clave: str) -> None:
        with self._lock_global:
            self._registros.pop(clave, None)

    # ── bloquear ──────────────────────────────────────────────────
    def bloquear(self, disp: Dispositivo, en_whitelist: Optional[bool]) -> Registro:
        clave = disp.clave
        with self._lock_de(clave):
            with self._lock_global:
                reg = self._registros.get(clave)
                if reg is None:
                    reg = Registro(dispositivo=disp)
                    self._registros[clave] = reg
                else:
                    reg.dispositivo = disp
                if en_whitelist is not None:
                    reg.en_whitelist = en_whitelist
            if reg.estado == ESTADO_BLOQUEADO:
                return reg

            # Capa 1: PnP verificado.
            if self._deshabilitar(disp.instancia):
                self._diario.anotar_deshabilitado(disp.instancia, disp.serial)
                reg.capa, reg.degradado = CAPA_PNP, False
                reg.estado = ESTADO_BLOQUEADO
                LOG.info("Bloqueado por PnP: %s (%s)", disp.nombre, disp.serial)
                return reg

            # Capa 2: candado de volumen (solo con letra).
            letra = disp.letra
            if letra and self._candados.bloquear(letra):
                reg.capa, reg.degradado = CAPA_VOLUMEN, False
                reg.estado = ESTADO_BLOQUEADO
                LOG.info("Bloqueado por volumen: %s en %s", disp.nombre, letra)
                return reg

            # Capa 3: solo lectura, degradado y declarado.
            if letra and self._poner_sl and self._poner_sl(letra):
                reg.capa, reg.degradado = CAPA_SOLO_LECTURA, True
                reg.estado = ESTADO_BLOQUEADO
                LOG.warning(
                    "Bloqueo DEGRADADO (solo lectura) para %s en %s",
                    disp.nombre,
                    letra,
                )
                return reg

            LOG.error("No se pudo bloquear %s por ninguna capa", disp.nombre)
            return reg

    # ── liberar ───────────────────────────────────────────────────
    def liberar(self, clave: str) -> bool:
        """Idempotente: liberar algo no bloqueado devuelve True."""
        with self._lock_de(clave):
            with self._lock_global:
                reg = self._registros.get(clave)
            if reg is None or reg.estado != ESTADO_BLOQUEADO:
                return True
            disp = reg.dispositivo
            ok = True
            if reg.capa == CAPA_PNP:
                for letra in disp.letras:
                    self._candados.soltar(letra)
                if self._habilitar(disp.instancia):
                    self._diario.quitar_deshabilitado(disp.instancia)
                else:
                    ok = False
            elif reg.capa == CAPA_VOLUMEN:
                for letra in disp.letras:
                    self._candados.soltar(letra)
            elif reg.capa == CAPA_SOLO_LECTURA:
                if self._quitar_sl and disp.letra:
                    self._quitar_sl(disp.letra)
            if ok:
                reg.estado = ESTADO_LIBERADO
                reg.capa = None
                reg.degradado = False
                LOG.info("Liberado: %s (%s)", disp.nombre, disp.serial)
            else:
                LOG.error("Liberación incompleta de %s", disp.nombre)
            return ok

    def liberar_con_reintentos(
        self, clave: str, esperas=(10, 30, 60)
    ) -> bool:
        if self.liberar(clave):
            return True
        for espera in esperas:
            time.sleep(espera)
            if self.liberar(clave):
                return True
        return False

    # ── extracción ────────────────────────────────────────────────
    def al_extraer(self, clave: str) -> None:
        """El dispositivo ya no está: se suelta todo y se revierte su
        nodo aunque esté desconectado (que la próxima vez entre
        normal). Sin esto, la v1 dejó una memoria muerta."""
        with self._lock_de(clave):
            with self._lock_global:
                reg = self._registros.pop(clave, None)
            if reg is None:
                return
            disp = reg.dispositivo
            for letra in disp.letras:
                self._candados.soltar(letra)
            if reg.capa == CAPA_PNP or reg.estado == ESTADO_BLOQUEADO:
                if self._habilitar(disp.instancia):
                    self._diario.quitar_deshabilitado(disp.instancia)

    # ── vigía ─────────────────────────────────────────────────────
    def vigilar(self) -> List[str]:
        """Reaplica el bloqueo a lo que algo haya revivido.

        Devuelve las claves reaplicadas (para avisar al panel).
        """
        reaplicadas: List[str] = []
        for reg in self.bloqueados():
            disp = reg.dispositivo
            clave = disp.clave
            with self._lock_de(clave):
                if reg.estado != ESTADO_BLOQUEADO:
                    continue
                revivido = False
                if reg.capa == CAPA_PNP:
                    estado = self._esta_deshabilitado(disp.instancia)
                    revivido = estado is False
                elif reg.capa == CAPA_VOLUMEN:
                    revivido = bool(disp.letra and self._accesible(disp.letra))
                if revivido:
                    LOG.warning("Dispositivo revivido, reaplicando: %s", disp.nombre)
                    reg.estado = ESTADO_LIBERADO
                    reg.capa = None
                    self.bloquear(disp, reg.en_whitelist)
                    reaplicadas.append(clave)
        return reaplicadas

    # ── restauración total ────────────────────────────────────────
    def restaurar_todo(self) -> Dict:
        """Libera lo bloqueado y revierte el diario completo."""
        for reg in self.bloqueados():
            self.liberar(reg.dispositivo.clave)
        self._candados.soltar_todos()
        return self._diario.restaurar_todo(
            self._habilitar, lambda _activo: True
        )
