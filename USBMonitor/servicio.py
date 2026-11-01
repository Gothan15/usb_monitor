# -*- coding: utf-8 -*-
"""USBMonitor v2 — UN solo ejecutable para todo el agente.

Modos según el primer argumento:
  (ninguno)    el servicio, bajo el SCM de Windows (o la gestión si
               se lanza a mano con doble clic)
  gui          la caja de herramientas del administrador: estado,
               servidor, credencial, control del servicio, accesos
               al compañero y al visor, registro y Restaurar todo
  prompt       el compañero (la ventana de la contraseña); lo
               arranca la tarea de inicio de sesión
  visor        el visor de seriales
  restaurar    revierte todo lo del diario y sale (lo usa el
               desinstalador antes de quitar el servicio)
  debug        el agente en consola, para depurar

Arranque por fases, para que no haya carreras al inicio:
  1. reconciliación del diario (lo que un cierre sucio dejó),
  2. barrido inicial (lo conectado se bloquea; la red USB presente
     queda como línea base y NO se bloquea),
  3. recién entonces arrancan los hilos (detección, vigía, sondeo de
     desbloqueos, latido) y el servidor local :5001.

Parada: se señaliza, los hilos terminan, y se restaura TODO
(dispositivos, volúmenes) antes de salir: el agente no deja huella.
"""
from __future__ import annotations

import json
import os
import sys
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Dict, List, Optional, Set

sys.path.insert(0, str(Path(__file__).resolve().parent))

from nucleo import config, pnp, registro
from nucleo.api import ClientePanel
from nucleo.bloqueo import MotorBloqueo
from nucleo.diario import Diario
from nucleo.dispositivos import (
    Detector,
    Dispositivo,
    TIPO_RED,
    unidades_para_estado,
)
from nucleo.emergencia import Emergencia
from nucleo.volumen import CandadosVolumen, es_accesible

LOG = registro.configurar("agente.log")
LOG_SERVICIO = registro.obtener("servicio")

ARCHIVO_PENDIENTES = registro.PROGRAM_DATA_DIR / "pending_local.json"
PUERTO_LOCAL = 5001

EV_CONECTADO = "CONNECTED"
EV_DESCONECTADO = "DISCONNECTED"
EV_BLOQUEADO = "BLOCKED"
EV_DESBLOQUEADO = "UNLOCKED"
EV_REAPLICADO = "BLOCK_REAPPLIED"
EV_FALLO_LIBERACION = "UNLOCK_RELEASE_FAILED"
EV_EMERGENCIA = "EMERGENCY_UNLOCK"
EV_ARRANQUE = "SERVICE_START"
EV_PARADA = "SERVICE_STOP"


def _escribir_pendientes_locales(pendientes: List[Dict]) -> None:
    """Handoff servicio -> compañero, atómico (temporal + replace):
    el compañero nunca lee un JSON a medias."""
    try:
        ARCHIVO_PENDIENTES.parent.mkdir(parents=True, exist_ok=True)
        temporal = ARCHIVO_PENDIENTES.with_suffix(".json.tmp")
        temporal.write_text(json.dumps(pendientes, ensure_ascii=False), encoding="utf-8")
        os.replace(temporal, ARCHIVO_PENDIENTES)
    except Exception as exc:
        LOG_SERVICIO.error("pending_local.json no se pudo escribir: %s", exc)


class Agente:
    def __init__(self) -> None:
        self.cliente = ClientePanel()
        self.diario = Diario()
        self.candados = CandadosVolumen()
        self.motor = MotorBloqueo(
            self.diario,
            deshabilitar=pnp.deshabilitar,
            habilitar=pnp.habilitar,
            esta_deshabilitado=pnp.esta_deshabilitado,
            candados=self.candados,
            accesible=es_accesible,
            poner_solo_lectura=self._poner_solo_lectura,
            quitar_solo_lectura=self._quitar_solo_lectura,
        )
        self.detector = Detector(pnp.ancestros)
        self.emergencia = Emergencia()
        self._deteniendo = threading.Event()
        self._conocidos: Dict[str, Dispositivo] = {}
        self._lock_conocidos = threading.Lock()
        self._base_red: Set[str] = set()
        self._pendientes_registrados: Set[str] = set()
        self._desbloqueos_ejecutados: Set[str] = set()
        self._lock_ejecutados = threading.Lock()
        self._cache_whitelist: Dict[str, tuple[Optional[bool], float]] = {}
        self._config_remota: Dict = {}
        self._ultimo_hash = 0.0
        self._ultima_config = 0.0
        self._servidor_local: Optional[ThreadingHTTPServer] = None

    # ── solo lectura (capa degradada, vía diskpart) ───────────────
    @staticmethod
    def _diskpart(letra: str, activar: bool) -> bool:
        import subprocess

        letra_limpia = letra.rstrip(":")
        comandos = (
            f"select volume {letra_limpia}\n"
            f"attributes volume {'set' if activar else 'clear'} readonly\n"
            "exit\n"
        )
        try:
            resultado = subprocess.run(
                ["diskpart"],
                input=comandos,
                capture_output=True,
                text=True,
                timeout=30,
            )
            return resultado.returncode == 0
        except Exception as exc:
            LOG_SERVICIO.warning("diskpart (%s): %s", letra, exc)
            return False

    def _poner_solo_lectura(self, letra: str) -> bool:
        return self._diskpart(letra, True)

    def _quitar_solo_lectura(self, letra: str) -> bool:
        return self._diskpart(letra, False)

    # ── whitelist con caché ───────────────────────────────────────
    def _en_whitelist(self, serial: str) -> Optional[bool]:
        if not serial:
            return False
        ahora = time.monotonic()
        with self._lock_conocidos:
            cache = self._cache_whitelist.get(serial)
        if cache and ahora - cache[1] < 60:
            return cache[0]
        resultado = self.cliente.comprobar_whitelist(serial)
        if resultado is not None:
            with self._lock_conocidos:
                self._cache_whitelist[serial] = (resultado, ahora)
        return resultado

    # ── handoff al compañero ──────────────────────────────────────
    def _refrescar_pendientes_locales(self) -> None:
        pendientes = []
        for reg in self.motor.bloqueados():
            disp = reg.dispositivo
            pendientes.append(
                {
                    "clave": disp.clave,
                    "serial": disp.serial,
                    "nombre": disp.nombre,
                    "letra": disp.letra,
                    "tipo": disp.tipo,
                    "en_whitelist": reg.en_whitelist,
                }
            )
        _escribir_pendientes_locales(pendientes)

    # ── llegada y extracción ──────────────────────────────────────
    def _al_llegar(self, disp: Dispositivo) -> None:
        if disp.tipo == TIPO_RED and disp.clave in self._base_red:
            LOG_SERVICIO.info("Red USB de línea base, sin bloquear: %s", disp.nombre)
            return
        self.cliente.evento(
            EV_CONECTADO, letra=disp.letra, serial=disp.serial
        )
        en_wl = self._en_whitelist(disp.serial)
        reg = self.motor.bloquear(disp, en_wl)
        if reg.estado == "BLOQUEADO":
            self.cliente.evento(
                EV_BLOQUEADO,
                letra=disp.letra,
                serial=disp.serial,
                solo_lectura=reg.capa + (" (degradado)" if reg.degradado else ""),
                en_whitelist=en_wl,
            )
            if en_wl is not None:
                self._registrar_en_panel(disp, en_wl)
            if self._config_remota.get("lockSessionOnInsert"):
                try:
                    import ctypes

                    ctypes.windll.user32.LockWorkStation()
                except Exception:
                    pass
        self._refrescar_pendientes_locales()

    def _registrar_en_panel(self, disp: Dispositivo, en_wl: bool) -> None:
        if disp.clave in self._pendientes_registrados:
            return
        pid = self.cliente.registrar_bloqueo(
            letra=disp.letra,
            serial=disp.serial,
            etiqueta=disp.nombre,
            en_whitelist=en_wl,
        )
        if pid:
            self._pendientes_registrados.add(disp.clave)

    def _al_extraer(self, clave: str, disp: Dispositivo) -> None:
        self.motor.al_extraer(clave)
        self.cliente.cerrar_bloqueo(letra=disp.letra, serial=disp.serial)
        self.cliente.evento(
            EV_DESCONECTADO, letra=disp.letra, serial=disp.serial
        )
        self._pendientes_registrados.discard(clave)
        self._refrescar_pendientes_locales()

    # ── bucles ────────────────────────────────────────────────────
    def _bucle_deteccion(self) -> None:
        while not self._deteniendo.is_set():
            try:
                actuales = self.detector.enumerar()
                with self._lock_conocidos:
                    previos = dict(self._conocidos)
                for clave, disp in actuales.items():
                    if clave not in previos:
                        self._al_llegar(disp)
                for clave, disp in previos.items():
                    if clave not in actuales:
                        self._al_extraer(clave, disp)
                with self._lock_conocidos:
                    self._conocidos = actuales
            except Exception as exc:
                LOG_SERVICIO.error("Bucle de detección: %s", exc)
            self._deteniendo.wait(1.5)

    def _bucle_vigia(self) -> None:
        while not self._deteniendo.is_set():
            try:
                for clave in self.motor.vigilar():
                    reg = self.motor.registro(clave)
                    if reg:
                        self.cliente.evento(
                            EV_REAPLICADO,
                            letra=reg.dispositivo.letra,
                            serial=reg.dispositivo.serial,
                        )
                # Registro en el panel de bloqueos creados sin red.
                for reg in self.motor.bloqueados():
                    if reg.en_whitelist is None:
                        en_wl = self._en_whitelist(reg.dispositivo.serial)
                        if en_wl is not None:
                            reg.en_whitelist = en_wl
                            self._registrar_en_panel(reg.dispositivo, en_wl)
                            self._refrescar_pendientes_locales()
            except Exception as exc:
                LOG_SERVICIO.error("Vigía: %s", exc)
            self._deteniendo.wait(5)

    def _bucle_sondeo(self) -> None:
        while not self._deteniendo.is_set():
            try:
                for pendiente in self.cliente.sondear_desbloqueos():
                    pid = pendiente.get("id")
                    with self._lock_ejecutados:
                        if pid in self._desbloqueos_ejecutados:
                            continue
                        self._desbloqueos_ejecutados.add(pid)
                    self._ejecutar_desbloqueo(pendiente)
            except Exception as exc:
                LOG_SERVICIO.error("Sondeo de desbloqueos: %s", exc)
            self._deteniendo.wait(3)

    def _ejecutar_desbloqueo(self, pendiente: Dict) -> None:
        letra = pendiente.get("driveLetter")
        serial = pendiente.get("serialNumber")
        objetivo: Optional[Dispositivo] = None
        for reg in self.motor.bloqueados():
            disp = reg.dispositivo
            if serial and disp.serial == serial:
                objetivo = disp
                break
            if letra and disp.letra == letra:
                objetivo = disp
                break
        if objetivo is None:
            LOG_SERVICIO.warning("Desbloqueo sin dispositivo local: %s", pendiente)
            return
        if self.motor.liberar_con_reintentos(objetivo.clave):
            self.cliente.evento(
                EV_DESBLOQUEADO, letra=objetivo.letra, serial=objetivo.serial
            )
        else:
            self.cliente.evento(
                EV_FALLO_LIBERACION, letra=objetivo.letra, serial=objetivo.serial
            )
        self._refrescar_pendientes_locales()

    def _bucle_latido(self) -> None:
        while not self._deteniendo.is_set():
            try:
                self.cliente.vaciar_cola()
                with self._lock_conocidos:
                    actuales = dict(self._conocidos)
                self.cliente.estado_conectados(unidades_para_estado(actuales))
                intentos = self.emergencia.intentos_pendientes()
                if intentos and self.cliente.subir_intentos_offline(intentos):
                    self.emergencia.limpiar_intentos()
                ahora = time.monotonic()
                if ahora - self._ultimo_hash > 600:
                    self._ultimo_hash = ahora
                    datos = self.cliente.hash_dueno()
                    if datos:
                        self.emergencia.guardar_hash(
                            datos["username"], datos["passwordHash"]
                        )
                if ahora - self._ultima_config > 600:
                    self._ultima_config = ahora
                    remota = self.cliente.config_remota()
                    if remota:
                        self._config_remota = remota
            except Exception as exc:
                LOG_SERVICIO.error("Latido: %s", exc)
            self._deteniendo.wait(30)

    # ── arranque y parada ─────────────────────────────────────────
    def arrancar(self) -> None:
        LOG_SERVICIO.info("Agente v2 arrancando en %s", config.nombre_pc())
        # Espera de red al arrancar (ajuste del panel, con su defecto).
        espera = 0
        remota = self.cliente.config_remota()
        if remota:
            self._config_remota = remota
            espera = int(remota.get("startupNetworkDelay") or 0)
        if espera:
            LOG_SERVICIO.info("Esperando red %s s (ajuste del panel)", espera)
            self._deteniendo.wait(min(espera, 120))

        # Fase 1: reconciliación del diario.
        iniciales = self.detector.enumerar()
        with self._lock_conocidos:
            self._conocidos = iniciales
        presentes = {d.instancia.upper() for d in iniciales.values()}
        for instancia in list(
            self.diario.estado()["dispositivos_deshabilitados"]
        ):
            if instancia.upper() not in presentes:
                # Quedó deshabilitado y ya no está: se reactiva su nodo
                # fantasma para que la próxima vez entre normal.
                if pnp.habilitar(instancia):
                    self.diario.quitar_deshabilitado(instancia)
        self._base_red = {
            d.clave for d in iniciales.values() if d.tipo == TIPO_RED
        }

        # Fase 2: barrido inicial (bloquea lo presente salvo la base).
        for disp in iniciales.values():
            if disp.tipo == TIPO_RED:
                continue
            self._al_llegar(disp)
        self.cliente.evento(EV_ARRANQUE)
        self.cliente.vaciar_cola()

        # Fase 3: hilos y servidor local.
        for bucle in (
            self._bucle_deteccion,
            self._bucle_vigia,
            self._bucle_sondeo,
            self._bucle_latido,
        ):
            threading.Thread(target=bucle, daemon=True).start()
        self._iniciar_servidor_local()
        LOG_SERVICIO.info("Agente v2 en marcha")

    def detener(self) -> None:
        LOG_SERVICIO.info("Deteniendo el agente: restaurando todo")
        self._deteniendo.set()
        if self._servidor_local:
            try:
                self._servidor_local.shutdown()
            except Exception:
                pass
        time.sleep(0.5)
        self.cliente.evento(EV_PARADA)
        try:
            self.cliente.vaciar_cola()
        except Exception:
            pass
        self.motor.restaurar_todo()
        _escribir_pendientes_locales([])
        LOG_SERVICIO.info("Agente detenido sin dejar huella")

    # ── servidor local :5001 ──────────────────────────────────────
    def _iniciar_servidor_local(self) -> None:
        agente = self

        class Manejador(BaseHTTPRequestHandler):
            def log_message(self, *args):  # silencio en el log
                pass

            def _responder(self, codigo: int, cuerpo: bytes, tipo="text/html; charset=utf-8"):
                self.send_response(codigo)
                self.send_header("Content-Type", tipo)
                self.send_header("Content-Length", str(len(cuerpo)))
                self.end_headers()
                self.wfile.write(cuerpo)

            def _autorizado(self) -> bool:
                esperado = config.cabeceras_auth().get("Authorization", "")
                return bool(esperado) and self.headers.get("Authorization") == esperado

            def do_GET(self):
                if self.path == "/estado":
                    cuerpo = json.dumps(
                        {
                            "ok": True,
                            "pc": config.nombre_pc(),
                            "bloqueados": len(agente.motor.bloqueados()),
                        }
                    ).encode()
                    self._responder(200, cuerpo, "application/json")
                elif self.path.startswith("/desbloquear"):
                    self._responder(200, agente._pagina_emergencia().encode())
                else:
                    self._responder(404, b"No encontrado")

            def do_POST(self):
                largo = int(self.headers.get("Content-Length") or 0)
                datos = self.rfile.read(largo) if largo else b""
                if self.path == "/config":
                    if not self._autorizado():
                        self._responder(401, b"No autorizado", "text/plain")
                        return
                    try:
                        ajustes = json.loads(datos.decode("utf-8"))
                        if isinstance(ajustes, dict):
                            agente._config_remota.update(ajustes)
                    except Exception:
                        pass
                    self._responder(200, b'{"ok": true}', "application/json")
                elif self.path == "/desbloquear":
                    self._responder(200, agente._procesar_emergencia(datos).encode())
                else:
                    self._responder(404, b"No encontrado")

        try:
            self._servidor_local = ThreadingHTTPServer(
                ("127.0.0.1", PUERTO_LOCAL), Manejador
            )
            threading.Thread(
                target=self._servidor_local.serve_forever, daemon=True
            ).start()
            LOG_SERVICIO.info("Servidor local en 127.0.0.1:%s", PUERTO_LOCAL)
        except Exception as exc:
            LOG_SERVICIO.error("Servidor local no arrancó: %s", exc)

    # ── emergencia sin red (página local) ─────────────────────────
    def _pagina_emergencia(self, mensaje: str = "") -> str:
        opciones = []
        for reg in self.motor.bloqueados():
            disp = reg.dispositivo
            clave = disp.letra or f"SER:{disp.serial}"
            opciones.append(
                f'<option value="{clave}">{disp.nombre} ({clave})</option>'
            )
        lista = "".join(opciones) or '<option value="">Sin dispositivos bloqueados</option>'
        aviso = f'<p style="color:#b3261e">{mensaje}</p>' if mensaje else ""
        return f"""<!doctype html><html lang="es"><head><meta charset="utf-8">
<title>Desbloqueo de emergencia — USBMonitor</title></head>
<body style="font-family: 'Segoe UI', sans-serif; background:#232a31; color:#e8edf1;
display:flex; justify-content:center; padding-top:8vh">
<main style="max-width:420px; width:92%">
<h1 style="font-size:20px">Desbloqueo de emergencia</h1>
<p style="color:#9fb0bd">Sin conexión con el servidor: solo puede
desbloquear el <strong>dueño de esta PC</strong>, con su contraseña
de siempre. El intento quedará registrado.</p>
{aviso}
<form method="post" action="/desbloquear">
<label>Dispositivo<br><select name="dispositivo" style="width:100%">{lista}</select></label><br><br>
<label>Usuario<br><input name="usuario" required style="width:100%"></label><br><br>
<label>Contraseña<br><input name="contrasena" type="password" required style="width:100%"></label><br><br>
<button type="submit" style="background:#33566e; color:white; padding:8px 18px; border:0">
Desbloquear</button>
</form></main></body></html>"""

    def _procesar_emergencia(self, datos: bytes) -> str:
        from urllib.parse import parse_qs

        form = {k: v[0] for k, v in parse_qs(datos.decode("utf-8", "replace")).items()}
        clave_form = form.get("dispositivo", "")
        objetivo: Optional[Dispositivo] = None
        for reg in self.motor.bloqueados():
            disp = reg.dispositivo
            if clave_form == disp.letra or clave_form == f"SER:{disp.serial}":
                objetivo = disp
                break
        if objetivo is None:
            return self._pagina_emergencia("Ese dispositivo ya no está bloqueado.")
        autorizado, motivo = self.emergencia.verificar(
            objetivo.clave,
            form.get("usuario", ""),
            form.get("contrasena", ""),
            letra=objetivo.letra,
            serial=objetivo.serial,
        )
        if not autorizado:
            texto = (
                "Demasiados intentos: espera 15 minutos."
                if motivo == "espera"
                else "No se pudo desbloquear: usuario o contraseña no válidos para el dueño de esta PC."
            )
            return self._pagina_emergencia(texto)
        if self.motor.liberar_con_reintentos(objetivo.clave):
            self.cliente.evento(
                EV_EMERGENCIA, letra=objetivo.letra, serial=objetivo.serial
            )
            self._refrescar_pendientes_locales()
            return self._pagina_emergencia("Dispositivo desbloqueado.")
        return self._pagina_emergencia("La liberación falló; inténtalo de nuevo.")


# ══ Restauración independiente (desinstalador / botón manual) ════

def restaurar_sin_servicio() -> Dict:
    """Revierte el diario sin el servicio: reactiva nodos y suelta
    volúmenes anotados. Lo invocan Install-Service -Uninstall y la
    ventana de gestión («Restaurar todo»)."""
    diario = Diario()
    candados = CandadosVolumen()
    candados.soltar_todos()
    return diario.restaurar_todo(pnp.habilitar, lambda _activo: True)


# ══ Servicio de Windows ══════════════════════════════════════════

try:
    import win32service
    import win32serviceutil

    class ServicioUSBMonitor(win32serviceutil.ServiceFramework):
        _svc_name_ = "USBMonitorService"
        _svc_display_name_ = "USB Monitor Service"
        _svc_description_ = (
            "Supervisa dispositivos USB, los bloquea y exige la "
            "contraseña del dueño o de un administrador para usarlos."
        )

        def __init__(self, args):
            super().__init__(args)
            self._agente: Optional[Agente] = None
            self._hilo: Optional[threading.Thread] = None

        def SvcStop(self):
            self.ReportServiceStatus(win32service.SERVICE_STOP_PENDING)
            if self._agente:
                self._agente.detener()

        def SvcDoRun(self):
            self._agente = Agente()
            self._hilo = threading.Thread(target=self._agente.arrancar, daemon=True)
            self._hilo.start()
            self._hilo.join()

except Exception:  # pragma: no cover - fuera de Windows
    ServicioUSBMonitor = None  # type: ignore


# ══ Ventana de gestión (modo gui): la caja de herramientas ═══════

def _estado_servicio() -> str:
    try:
        import win32service

        scm = win32service.OpenSCManager(
            None, None, win32service.SC_MANAGER_CONNECT
        )
        try:
            svc = win32service.OpenService(
                scm, "USBMonitorService", win32service.SERVICE_QUERY_STATUS
            )
        except Exception:
            return "no instalado"
        estado = win32service.QueryServiceStatus(svc)[1]
        return {
            win32service.SERVICE_RUNNING: "en ejecución",
            win32service.SERVICE_STOPPED: "detenido",
            win32service.SERVICE_START_PENDING: "arrancando…",
            win32service.SERVICE_STOP_PENDING: "deteniéndose…",
            win32service.SERVICE_PAUSED: "en pausa",
        }.get(estado, "desconocido")
    except Exception:
        return "sin acceso"


def _control_servicio(accion: str) -> None:
    import win32serviceutil

    if accion == "start":
        win32serviceutil.StartService("USBMonitorService")
    elif accion == "stop":
        win32serviceutil.StopService("USBMonitorService")
    elif accion == "restart":
        win32serviceutil.RestartService("USBMonitorService")


def ejecutar_gui() -> None:
    """Instrumento de seguridad: grafito y acero, datos en
    monoespaciada, el estado como palabra con punto de color."""
    import tkinter as tk
    from tkinter import messagebox

    FONDO = "#232a31"
    PANEL = "#2b333b"
    TEXTO = "#e8edf1"
    TENUE = "#9fb0bd"
    ACERO = "#4d7ca6"
    VERDE = "#3fa46a"
    ROJO = "#c0453e"
    MONO = ("Consolas", 10)
    NORMAL = ("Segoe UI", 10)
    TITULO = ("Segoe UI", 13, "bold")

    ventana = tk.Tk()
    ventana.title("USBMonitor — Gestión del agente")
    ventana.configure(bg=FONDO)
    ventana.geometry("560x600")
    ventana.resizable(False, False)
    try:
        ventana.iconbitmap(str(Path(__file__).with_name("usb_monitor_service.ico")))
    except Exception:
        pass

    def etiqueta(texto, fuente=NORMAL, color=TEXTO, **kw):
        return tk.Label(
            ventana, text=texto, font=fuente, fg=color, bg=FONDO, anchor="w", **kw
        )

    etiqueta("USBMonitor · Gestión del agente", TITULO).pack(
        anchor="w", padx=18, pady=(16, 2)
    )
    estado_var = tk.StringVar(value="● Consultando…")
    tk.Label(
        ventana, textvariable=estado_var, font=MONO, fg=TENUE, bg=FONDO, anchor="w"
    ).pack(anchor="w", padx=18)

    servicio_var = tk.StringVar(value="servicio: …")

    def refrescar_estado():
        diario = Diario().estado()
        n = len(diario["dispositivos_deshabilitados"])
        bloqueados = 0
        try:
            datos = json.loads(ARCHIVO_PENDIENTES.read_text(encoding="utf-8"))
            bloqueados = len(datos)
        except Exception:
            pass
        estado_var.set(
            f"● servidor {config.url_base()} · bloqueados ahora: {bloqueados}"
            f" · nodos por restaurar: {n}"
        )
        servicio_var.set(f"servicio: {_estado_servicio()}")
        ventana.after(4000, refrescar_estado)

    # Control del servicio y accesos (la «caja de herramientas»)
    marco0 = tk.LabelFrame(
        ventana, text=" Servicio y herramientas ", font=NORMAL, fg=TENUE,
        bg=FONDO, bd=1, relief="solid",
    )
    marco0.pack(fill="x", padx=18, pady=(10, 2))
    tk.Label(
        marco0, textvariable=servicio_var, font=MONO, fg=TEXTO, bg=FONDO
    ).pack(anchor="w", padx=10, pady=(6, 2))
    fila0 = tk.Frame(marco0, bg=FONDO)
    fila0.pack(fill="x", padx=10, pady=(2, 8))

    def controlar(accion):
        try:
            _control_servicio(accion)
        except Exception as exc:
            messagebox.showwarning(
                "Servicio",
                f"No se pudo {accion} el servicio (¿falta administrador?): {exc}",
            )
        ventana.after(800, refrescar_estado)

    for texto, accion in (("Iniciar", "start"), ("Detener", "stop"),
                          ("Reiniciar", "restart")):
        tk.Button(
            fila0, text=texto, command=lambda a=accion: controlar(a),
            bg=PANEL, fg=TEXTO, font=NORMAL, bd=0, padx=10, pady=4,
        ).pack(side="left", padx=(0, 6))
    tk.Button(
        fila0, text="Compañero",
        command=lambda: _lanzar_modo("prompt"),
        bg=PANEL, fg=TEXTO, font=NORMAL, bd=0, padx=10, pady=4,
    ).pack(side="left", padx=(6, 6))
    tk.Button(
        fila0, text="Visor de seriales",
        command=lambda: _lanzar_modo("visor"),
        bg=PANEL, fg=TEXTO, font=NORMAL, bd=0, padx=10, pady=4,
    ).pack(side="left")

    # Servidor
    marco = tk.LabelFrame(
        ventana, text=" Servidor ", font=NORMAL, fg=TENUE, bg=FONDO,
        bd=1, relief="solid",
    )
    marco.pack(fill="x", padx=18, pady=12)
    var_host = tk.StringVar(value=config.host_servidor())
    var_puerto = tk.StringVar(value=str(config.puerto_servidor()))
    var_esquema = tk.StringVar(value=config.esquema_servidor())
    for texto, var, ancho in (("Host / IP", var_host, 26), ("Puerto", var_puerto, 8)):
        fila = tk.Frame(marco, bg=FONDO)
        fila.pack(fill="x", padx=10, pady=3)
        tk.Label(fila, text=texto, font=NORMAL, fg=TEXTO, bg=FONDO, width=10,
                 anchor="w").pack(side="left")
        tk.Entry(fila, textvariable=var, font=MONO, width=ancho).pack(side="left")
    fila = tk.Frame(marco, bg=FONDO)
    fila.pack(fill="x", padx=10, pady=3)
    tk.Label(fila, text="Esquema", font=NORMAL, fg=TEXTO, bg=FONDO, width=10,
             anchor="w").pack(side="left")
    tk.OptionMenu(fila, var_esquema, "http", "https").pack(side="left")

    def guardar_servidor():
        try:
            puerto = int(var_puerto.get())
        except ValueError:
            messagebox.showwarning("Puerto inválido", "El puerto debe ser un número.")
            return
        if config.guardar(
            {
                "serverHost": var_host.get().strip() or "localhost",
                "serverPort": puerto,
                "serverScheme": var_esquema.get(),
            }
        ):
            messagebox.showinfo(
                "Servidor guardado",
                "Reinicia el servicio para aplicar la nueva dirección.",
            )

    tk.Button(
        marco, text="Guardar servidor", command=guardar_servidor,
        bg=ACERO, fg="white", font=NORMAL, bd=0, padx=12, pady=4,
    ).pack(anchor="e", padx=10, pady=8)

    # Credencial
    marco2 = tk.LabelFrame(
        ventana, text=" Credencial del agente ", font=NORMAL, fg=TENUE,
        bg=FONDO, bd=1, relief="solid",
    )
    marco2.pack(fill="x", padx=18, pady=4)
    fila = tk.Frame(marco2, bg=FONDO)
    fila.pack(fill="x", padx=10, pady=6)
    tk.Label(fila, text="Token del equipo", font=NORMAL, fg=TEXTO,
             bg=FONDO).pack(anchor="w")
    var_credencial = tk.StringVar()
    tk.Entry(fila, textvariable=var_credencial, font=MONO, width=52, show="•").pack(
        anchor="w", pady=2
    )

    def guardar_credencial():
        valor = var_credencial.get().strip()
        if not valor:
            messagebox.showwarning("Vacío", "Escribe el token del equipo.")
            return
        if config.guardar({"agentToken": config.cifrar(valor)}):
            var_credencial.set("")
            messagebox.showinfo(
                "Credencial guardada",
                "Se guardó cifrada en server.json. Reinicia el servicio.",
            )

    tk.Button(
        fila, text="Guardar credencial", command=guardar_credencial,
        bg=ACERO, fg="white", font=NORMAL, bd=0, padx=12, pady=4,
    ).pack(anchor="w", pady=4)
    tk.Label(
        marco2,
        text="Lo genera un administrador en el panel: Equipos, botón «Token del agente».",
        font=("Segoe UI", 8), fg=TENUE, bg=FONDO,
    ).pack(anchor="w", padx=10, pady=(0, 8))

    # Acciones
    acciones = tk.Frame(ventana, bg=FONDO)
    acciones.pack(fill="x", padx=18, pady=10)

    def restaurar():
        if messagebox.askyesno(
            "Restaurar todo",
            "Se reactivan los dispositivos que el agente deshabilitó y se "
            "sueltan los volúmenes retenidos. ¿Continuar?",
        ):
            resumen = restaurar_sin_servicio()
            messagebox.showinfo(
                "Restauración",
                f"Reactivados: {resumen['reactivados']} · "
                f"Sin revertir: {len(resumen['sin_revertir'])}",
            )
            refrescar_estado()

    tk.Button(
        acciones, text="Restaurar todo", command=restaurar,
        bg=ROJO, fg="white", font=NORMAL, bd=0, padx=12, pady=5,
    ).pack(side="left")
    tk.Button(
        acciones, text="Abrir página de emergencia",
        command=lambda: __import__("webbrowser").open(
            f"http://127.0.0.1:{PUERTO_LOCAL}/desbloquear"
        ),
        bg=PANEL, fg=TEXTO, font=NORMAL, bd=0, padx=12, pady=5,
    ).pack(side="left", padx=8)

    # Registro
    etiqueta("Registro", NORMAL, TENUE).pack(anchor="w", padx=18, pady=(6, 2))
    caja = tk.Text(
        ventana, font=("Consolas", 8), bg=PANEL, fg=TEXTO, height=9,
        wrap="none", state="disabled",
    )
    caja.pack(fill="both", expand=True, padx=18, pady=(0, 14))

    def cargar_log():
        try:
            lineas = (registro.PROGRAM_DATA_DIR / "agente.log").read_text(
                encoding="utf-8", errors="replace"
            ).splitlines()[-60:]
            caja.configure(state="normal")
            caja.delete("1.0", "end")
            caja.insert("end", "\n".join(lineas))
            caja.see("end")
            caja.configure(state="disabled")
        except Exception:
            pass
        ventana.after(5000, cargar_log)

    refrescar_estado()
    cargar_log()
    ventana.mainloop()


# ══ Entrada ══════════════════════════════════════════════════════

def _lanzar_modo(modo: str) -> None:
    """Abre otro modo de ESTE ejecutable (compañero, visor)."""
    import subprocess

    if getattr(sys, "frozen", False):
        comando = [sys.executable, modo]
    else:
        comando = [sys.executable, str(Path(__file__).resolve()), modo]
    subprocess.Popen(comando, close_fds=True)


def main() -> None:
    argumentos = sys.argv[1:]
    if argumentos and argumentos[0] == "gui":
        ejecutar_gui()
        return
    if argumentos and argumentos[0] == "prompt":
        import companero

        companero.main()
        return
    if argumentos and argumentos[0] == "visor":
        import visor

        visor.main()
        return
    if argumentos and argumentos[0] == "restaurar":
        resumen = restaurar_sin_servicio()
        print(json.dumps(resumen, ensure_ascii=False))
        return
    if argumentos and argumentos[0] == "debug":
        agente = Agente()
        try:
            agente.arrancar()
            while True:
                time.sleep(1)
        except KeyboardInterrupt:
            agente.detener()
        return
    if ServicioUSBMonitor is not None:
        import win32serviceutil

        if argumentos:
            win32serviceutil.HandleCommandLine(ServicioUSBMonitor)
        else:
            # Lanzado a mano sin argumentos (doble clic): abre la
            # gestión en vez de fallar contra el SCM.
            try:
                import servicemanager

                servicemanager.Initialize()
                servicemanager.PrepareToHostSingle(ServicioUSBMonitor)
                servicemanager.StartServiceCtrlDispatcher()
            except Exception:
                ejecutar_gui()


if __name__ == "__main__":
    main()
