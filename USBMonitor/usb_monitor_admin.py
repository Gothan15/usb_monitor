"""Herramienta gráfica de gestión del Monitor USB (Fase 6).

Aquí vive la interfaz de escritorio que antes estaba dentro de
usb_monitor_service.py: el servicio (sesión 0) no muestra ventanas
ni se conecta a la base de datos; esta herramienta se ejecuta en la
sesión del usuario, importa los ayudantes del módulo del servicio y
se lanza con «usb_monitor_admin.py» o con el argumento «gui» del
propio servicio.

El configurador de API key es MANUAL desde la Fase 6: antes listaba
todos los usuarios y sus claves leyendo PostgreSQL en directo; ahora
se pega la clave y se guarda (cifrada) con run_setx, como siempre se
aplicó. En instalaciones modernas el agente se autentica con el token
por equipo y esta clave es el camino heredado.
"""

from __future__ import annotations

import json
import os
import sys
import threading
import time

try:
    import win32service
except ImportError:  # pragma: no cover - sin pywin32 no hay estados
    win32service = None  # type: ignore[assignment]

from fluent_ui import create_window as fluent_window, fluent_page, start as fluent_start

from usb_monitor_service import *  # noqa: F401,F403 - ayudantes y constantes del servicio
from usb_monitor_service import (
    LOGGER,
    is_user_admin,
    run_setx,
    _execute_service_command,
    _get_service_autostart_status,
    _query_service_state,
    _set_server_host,
    _toggle_server_scheme,
    _toggle_service_autostart,
    _toggle_ssl_verify,
)


# ---------------------------------------------------------------------------
# Interfaz Fluent (pywebview): estado, comandos y configuración
# ---------------------------------------------------------------------------

_PAGE_JS = """
const $=id=>document.getElementById(id);
function setBusy(b){document.querySelectorAll('button.cmd').forEach(x=>x.disabled=b);}
function appendLog(line){const el=$('log'); el.textContent+=line+'\n'; el.scrollTop=el.scrollHeight;}
function showNotice(tipo,msg){const e=$('aviso'); e.className='estado '+(tipo||''); e.textContent=msg||'';}
function renderStatus(s){
  $('punto').style.background = s.kind==='ok' ? 'var(--exito)' : (s.kind==='error' ? 'var(--peligro)' : 'var(--suave)');
  $('servicio').textContent = 'Estado del servicio: '+s.description;
  $('auto').textContent = s.autostart;
  $('esquema').textContent = s.scheme;
  $('ssl').textContent = s.ssl;
  if(document.activeElement!==$('host')) $('host').value = s.host;
}
function cmd(nombre){ setBusy(true); window.pywebview.api.command(nombre); }
function alternar(cual){ setBusy(true); window.pywebview.api.toggle(cual); }
function guardarHost(){
  const v=$('host').value.trim();
  if(!v){ showNotice('error','Debes ingresar una IP o hostname válido.'); return; }
  setBusy(true); window.pywebview.api.set_host(v);
}
function aplicarClave(){
  const v=$('clave').value;
  if(!v.trim()){ showNotice('error','Escribe o pega la API key antes de aplicar.'); return; }
  window.pywebview.api.set_api_key(v);
}
window.addEventListener('pywebviewready',()=>window.pywebview.api.init());
"""


def _admin_page() -> str:
    body = """
    <h1><span class="punto" id="punto"></span><span id="servicio">Estado del servicio: …</span></h1>
    <p class="sub" style="margin-bottom:4px" id="auto">Inicio automático: …</p>
    <p class="sub" style="margin-bottom:4px" id="esquema">Esquema del backend: …</p>
    <p class="sub" id="ssl">Verificación SSL: …</p>
    <p class="sub">Ejecuta esta herramienta como administrador para instalar o controlar el servicio.</p>
    <div class="tarjeta">
      <p class="etq">Servicio</p>
      <div class="fila">
        <button class="cmd" onclick="cmd('install')">Instalar servicio</button>
        <button class="cmd" onclick="cmd('start')">Iniciar servicio</button>
        <button class="cmd" onclick="cmd('stop')">Detener servicio</button>
        <button class="cmd" onclick="cmd('remove')">Desinstalar servicio</button>
        <button class="cmd" onclick="alternar('autostart')">Alternar inicio automático</button>
        <span style="flex:1"></span>
        <button class="acento" onclick="window.pywebview.api.refresh()">Actualizar estado</button>
      </div>
    </div>
    <div class="tarjeta">
      <p class="etq">Servidor</p>
      <p class="etq" style="font-weight:400">Dirección IP o hostname del servidor backend</p>
      <div class="fila" style="align-items:stretch">
        <input type="text" id="host" style="flex:1;margin:0">
        <button class="cmd" onclick="guardarHost()">Guardar</button>
      </div>
      <div class="fila" style="margin-top:12px">
        <button class="cmd" onclick="alternar('scheme')">Alternar HTTP/HTTPS</button>
        <button class="cmd" onclick="alternar('ssl')">Alternar verificación SSL</button>
      </div>
    </div>
    <div class="tarjeta">
      <p class="etq">API key del backend</p>
      <p class="sub">Pega la API key del usuario del agente. Se guardará cifrada
      como variable de máquina USB_MONITOR_API_KEY (setx) y el servicio
      la usará al reiniciar.</p>
      <input type="password" id="clave">
      <label class="check"><input type="checkbox"
        onchange="document.getElementById('clave').type=this.checked?'text':'password'">
        Mostrar la clave</label>
      <div class="fila"><button onclick="aplicarClave()">Aplicar</button></div>
    </div>
    <div class="estado" id="aviso"></div>
    <div class="tarjeta"><p class="etq">Registro</p><div class="log" id="log"></div></div>
    """
    return fluent_page(body, extra_js=_PAGE_JS)


class AdminApi:
    """Puente JS->Python: mismos ayudantes del servicio que usaba tkinter."""

    def __init__(self) -> None:
        self.window = None
        self._busy = False

    # -- infraestructura ----------------------------------------------
    def _js(self, code: str) -> None:
        if self.window is None:
            return
        try:
            self.window.evaluate_js(code)
        except Exception:
            pass

    def _log(self, text: str) -> None:
        stamp = time.strftime("%H:%M:%S")
        LOGGER.info("GUI: %s", text)
        self._js(f"window.appendLog && window.appendLog({json.dumps(f'[{stamp}] {text}')})")

    def _notice(self, tipo: str, msg: str) -> None:
        self._js(f"window.showNotice && window.showNotice({json.dumps(tipo)}, {json.dumps(msg)})")

    def _status(self) -> dict:
        state, description = _query_service_state()
        if win32service is not None and state == win32service.SERVICE_RUNNING:
            kind = "ok"
        elif state is None or (
            win32service is not None and state == win32service.SERVICE_STOPPED
        ):
            kind = "error"
        else:
            kind = "info"
        success, start_type = _get_service_autostart_status()
        if success and start_type is not None:
            if win32service is not None and start_type == win32service.SERVICE_AUTO_START:
                autostart = "Inicio automático: ✓ Activado"
            elif win32service is not None and start_type == win32service.SERVICE_DEMAND_START:
                autostart = "Inicio automático: ✗ Desactivado (Manual)"
            else:
                autostart = f"Inicio automático: Tipo {start_type}"
        else:
            autostart = "Inicio automático: Estado desconocido"
        scheme = os.environ.get("USB_MONITOR_SERVER_SCHEME", "http").lower()
        cert_path = os.environ.get("USB_MONITOR_SSL_CERT", "").strip()
        verify_env = os.environ.get("USB_MONITOR_SSL_VERIFY", "true").lower()
        if cert_path and os.path.exists(cert_path):
            ssl = f"Verificación SSL: CA personalizada ({cert_path})"
        else:
            ssl = "Verificación SSL: Activada" if verify_env != "false" else "Verificación SSL: Desactivada"
        return {
            "kind": kind,
            "description": description,
            "autostart": autostart,
            "scheme": f"Esquema del backend: {scheme.upper()}",
            "ssl": ssl,
            "host": os.environ.get("USB_MONITOR_SERVER_HOST", get_server_host()),
        }

    def _push_status(self) -> None:
        self._js(f"window.renderStatus && window.renderStatus({json.dumps(self._status())})")

    def _set_busy(self, busy: bool) -> None:
        self._busy = busy
        self._js(f"window.setBusy && window.setBusy({'true' if busy else 'false'})")

    def _finish(self, success: bool, message: str) -> None:
        self._set_busy(False)
        self._log(message)
        self._push_status()
        if not success:
            self._notice("error", message)
            LOGGER.error("GUI: comando finalizado con error - %s", message)
        else:
            LOGGER.info("GUI: comando finalizado correctamente - %s", message)

    def _run_async(self, intro: str, fn) -> None:
        if self._busy:
            return
        self._log(intro)
        self._set_busy(True)

        def worker() -> None:
            try:
                success, message = fn()
            except Exception as exc:  # pragma: no cover - red de seguridad
                success, message = False, str(exc)
            self._finish(success, message)

        threading.Thread(target=worker, daemon=True).start()

    # -- acciones desde la página --------------------------------------
    def init(self) -> None:
        self._log("Interfaz iniciada.")
        self._push_status()

    def refresh(self) -> None:
        self._push_status()

    def command(self, name: str) -> None:
        if name not in {"install", "start", "stop", "remove"}:
            return
        LOGGER.info("GUI: se solicitó ejecución del comando '%s'", name)
        self._run_async(
            f"Ejecutando '{name}'...",
            lambda: _execute_service_command(name),
        )

    def toggle(self, which: str) -> None:
        acciones = {
            "autostart": ("Alternando configuración de inicio automático...", _toggle_service_autostart),
            "scheme": ("Alternando esquema HTTP/HTTPS...", _toggle_server_scheme),
            "ssl": ("Alternando verificación SSL...", _toggle_ssl_verify),
        }
        if which not in acciones:
            return
        intro, fn = acciones[which]
        LOGGER.info("GUI: se solicitó alternar %s", which)
        self._run_async(intro, fn)

    def set_host(self, value: str) -> None:
        valor = str(value or "").strip()
        if not valor:
            self._notice("error", "Debes ingresar una IP o hostname válido.")
            return
        LOGGER.info("GUI: se solicitó actualizar USB_MONITOR_SERVER_HOST a %s", valor)
        self._run_async(
            f"Actualizando IP del servidor a '{valor}'...",
            lambda: _set_server_host(valor),
        )

    def set_api_key(self, value: str) -> None:
        self._log("Aplicando API key del backend...")
        if not is_user_admin():
            msg = "Ejecuta esta herramienta como administrador para escribir variables de entorno de sistema."
            self._notice("error", msg)
            self._log("No se pudo aplicar la API key: se requieren privilegios de administrador.")
            return
        clave = str(value or "").strip()
        if not clave:
            self._notice("error", "Escribe o pega la API key antes de aplicar.")
            return
        try:
            run_setx(clave)
        except Exception as exc:
            LOGGER.error("No se pudo guardar la API key: %s", exc)
            self._notice("error", f"No se pudo guardar: setx falló al escribir la variable de máquina. Detalles: {exc}")
            self._log("No se pudo aplicar la API key (setx falló).")
            return
        self._log("API key aplicada (USB_MONITOR_API_KEY); reinicia el servicio para usarla.")
        self._notice("ok", "La clave quedó guardada. Reinicia el servicio para que la use.")


def _auto_refresh(api: AdminApi) -> None:
    """El estado se refresca solo cada 5 s, como con la interfaz anterior."""
    while True:
        time.sleep(5)
        try:
            api._push_status()
        except Exception:
            pass


def run_gui() -> None:
    api = AdminApi()
    api.window = fluent_window(
        "USB Monitor Service", html=_admin_page(), js_api=api,
        width=620, height=860,
    )
    threading.Thread(target=_auto_refresh, args=(api,), daemon=True).start()
    fluent_start()


if __name__ == "__main__":
    run_gui()
