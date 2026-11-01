"""Aplicacion de escritorio para listar unidades USB y mostrar sus seriales.

Requisitos de ejecucion directa:
    pip install wmi pywin32

El script esta pensado para convertirse en un ejecutable (por ejemplo con
PyInstaller o Nuitka). Proporciona una interfaz Fluent (Windows 11, pywebview sin
tkinter) para inspeccionar unidades conectadas por USB y ver sus
numeros de serie.
"""
from __future__ import annotations

import json
import logging
import subprocess
import re
import threading
from dataclasses import dataclass
from typing import Iterable, List, Optional, Sequence


try:  # type: ignore
    import pythoncom  # type: ignore
    import wmi  # type: ignore
except ImportError as exc:  # pragma: no cover - dependencias externas
    pythoncom = None  # type: ignore
    wmi = None  # type: ignore
    IMPORT_ERROR = exc
else:
    IMPORT_ERROR = None

from fluent_ui import create_window as fluent_window, fluent_page, start as fluent_start

LOGGER = logging.getLogger("usb_serial_viewer")
logging.basicConfig(level=logging.INFO, format="%(levelname)s | %(message)s")

CONTROL_CHARS_REGEX = re.compile(r"[\x00-\x1F\x7F]")
SERIAL_ALLOWED_CHARS_REGEX = re.compile(r"[^0-9A-Za-z._-]")
SERIAL_SENTINELS = {
    "",
    "UNKNOWN",
    "UNAVAILABLE",
    "UNKNOW",
    "NONE",
    "N/A",
    "NOTAPPLICABLE",
    "NOTAVAILABLE",
}


@dataclass(frozen=True)
class USBDevice:
    model: str
    serial: str
    letters: Sequence[str]
    size_bytes: Optional[int]
    device_id: str


def normalize_serial_candidate(value: Optional[str]) -> Optional[str]:
    if not isinstance(value, str):
        return None
    stripped = CONTROL_CHARS_REGEX.sub("", value).strip()
    if not stripped:
        return None
    collapsed = re.sub(r"\s+", "", stripped)
    cleaned = SERIAL_ALLOWED_CHARS_REGEX.sub("", collapsed.upper())
    if not cleaned or cleaned in SERIAL_SENTINELS:
        return None
    if len(cleaned) < 4:
        return None
    return cleaned[:128]


def tail_tokens(text: str) -> Iterable[str]:
    for token in re.split(r"[\\&/_]", text):
        candidate = normalize_serial_candidate(token)
        if candidate:
            yield candidate


def extract_serial(device_id: Optional[str], serial_number: Optional[str]) -> str:
    serial = normalize_serial_candidate(serial_number)
    if serial:
        return serial
    if not isinstance(device_id, str):
        return "DESCONOCIDO"
    tail = device_id.split("\\")[-1]
    for candidate in tail_tokens(tail):
        return candidate
    return normalize_serial_candidate(tail) or "DESCONOCIDO"


def gather_drive_letters(drive: "wmi._wmi_object") -> List[str]:
    letters: List[str] = []
    try:
        for partition in drive.associators("Win32_DiskDriveToDiskPartition"):
            # El mapeo Win32_LogicalDiskToPartition nos da las letras asignadas.
            for logical in partition.associators("Win32_LogicalDiskToPartition"):
                device_id = getattr(logical, "DeviceID", None)
                if isinstance(device_id, str):
                    letters.append(device_id)
    except Exception as exc:
        LOGGER.debug("No se pudieron resolver letras de %s: %s", drive, exc)
    return sorted(set(letters))


def format_size(value: Optional[int]) -> str:
    if not value:
        return "-"
    units = ["Bytes", "KB", "MB", "GB", "TB"]
    size = float(value)
    for unit in units:
        if size < 1024.0 or unit == units[-1]:
            return f"{size:,.0f} {unit}".replace(",", "")
        size /= 1024.0
    return f"{value} Bytes"


def collect_usb_devices() -> List[USBDevice]:
    if IMPORT_ERROR is not None:
        raise RuntimeError(
            "No se pudieron importar las dependencias requeridas: %s" % IMPORT_ERROR
        )

    pythoncom.CoInitialize()
    try:
        connection = wmi.WMI()
        devices: List[USBDevice] = []
        for drive in connection.Win32_DiskDrive():
            interface = getattr(drive, "InterfaceType", None)
            device_id = getattr(drive, "PNPDeviceID", "") or ""
            tag = getattr(drive, "DeviceID", "") or ""
            interface_is_usb = isinstance(interface, str) and interface.upper() == "USB"
            id_is_usb = "USB" in device_id.upper() or "USB" in tag.upper()
            if not (interface_is_usb or id_is_usb):
                continue

            serial = extract_serial(device_id, getattr(drive, "SerialNumber", None))
            model = getattr(drive, "Model", None) or "Dispositivo USB"
            letters = gather_drive_letters(drive)
            size_raw = getattr(drive, "Size", None)
            try:
                size_value = int(size_raw) if size_raw is not None else None
            except (TypeError, ValueError):
                size_value = None

            devices.append(
                USBDevice(
                    model=model.strip() or "Dispositivo USB",
                    serial=serial,
                    letters=letters,
                    size_bytes=size_value,
                    device_id=device_id or tag,
                )
            )
        return devices
    finally:
        pythoncom.CoUninitialize()


# ---------------------------------------------------------------------------
# Interfaz Fluent (pywebview): tabla de dispositivos y copia del serial
# ---------------------------------------------------------------------------

_PAGE_JS = """
const $=id=>document.getElementById(id);
let seleccionado='';
function estado(msg){$('estado').textContent=msg;}
function renderDevices(devices){
  const tb=$('cuerpo'); tb.innerHTML=''; seleccionado='';
  for(const d of devices){
    const tr=document.createElement('tr'); tr.className='fila-dato';
    tr.onclick=()=>{document.querySelectorAll('tr.seleccionada').forEach(x=>x.classList.remove('seleccionada'));
      tr.classList.add('seleccionada'); seleccionado=d.serial;};
    for(const v of [d.serial, d.letters, d.size, d.model]){
      const td=document.createElement('td'); td.textContent=v; tr.appendChild(td);}
    tb.appendChild(tr);
  }
  estado(devices.length ? ('Se detectaron '+devices.length+' dispositivo(s) USB.')
                         : 'No se detectaron dispositivos USB.');
  $('actualizar').disabled=false;
}
function renderError(msg){ estado('Error al escanear: '+msg); $('actualizar').disabled=false; }
function refrescar(){ $('actualizar').disabled=true; estado('Escaneando dispositivos USB…');
  window.pywebview.api.refresh(); }
async function copiar(){
  if(!seleccionado){ estado('Selecciona un dispositivo para copiar su serial.'); return; }
  const ok=await window.pywebview.api.copy_serial(seleccionado);
  estado(ok ? 'Serial copiado al portapapeles.' : 'No se pudo copiar el serial.');
}
window.addEventListener('pywebviewready', refrescar);
"""


def _viewer_page() -> str:
    body = """
    <h1>USB Serial Inspector</h1>
    <p class="sub">Unidades USB conectadas y sus números de serie.
    Haz clic en una fila para seleccionarla y copiar su serial.</p>
    <div class="tarjeta" style="padding:6px 12px">
      <table>
        <thead><tr><th>Serial</th><th>Letras</th><th>Tamaño</th><th>Modelo</th></tr></thead>
        <tbody id="cuerpo"></tbody>
      </table>
    </div>
    <div class="fila">
      <button class="acento" id="actualizar" onclick="refrescar()">Actualizar</button>
      <button onclick="copiar()">Copiar serial</button>
    </div>
    <div class="estado" id="estado">Listo</div>
    """
    return fluent_page(body, extra_js=_PAGE_JS)


class ViewerApi:
    """Puente JS->Python del visor."""

    def __init__(self) -> None:
        self.window = None
        self._refreshing = False

    def refresh(self) -> None:
        if self._refreshing:
            return
        self._refreshing = True
        threading.Thread(target=self._worker, daemon=True).start()

    def _worker(self) -> None:
        try:
            devices = collect_usb_devices()
            data = [
                {
                    "serial": d.serial,
                    "letters": ", ".join(d.letters) if d.letters else "-",
                    "size": format_size(d.size_bytes),
                    "model": d.model,
                }
                for d in devices
            ]
            self._js(f"window.renderDevices && window.renderDevices({json.dumps(data)})")
        except Exception as exc:
            LOGGER.exception("Fallo al escanear dispositivos USB: %s", exc)
            self._js(
                "window.renderError && window.renderError("
                f"{json.dumps(str(exc))})"
            )
        finally:
            self._refreshing = False

    def copy_serial(self, serial: str) -> bool:
        if not serial:
            return False
        try:
            subprocess.run(
                ["clip"], input=str(serial), text=True, check=True,
                capture_output=True,
            )
            return True
        except Exception as exc:
            LOGGER.warning("No se pudo copiar al portapapeles: %s", exc)
            return False

    def _js(self, code: str) -> None:
        if self.window is None:
            return
        try:
            self.window.evaluate_js(code)
        except Exception:
            pass


def main() -> None:
    if IMPORT_ERROR is not None:
        body = (
            "<h1>USB Serial Inspector</h1><div class='tarjeta'>"
            "<p class='sub' style='margin:0'>No se pudieron importar las "
            "dependencias requeridas (wmi, pywin32): "
            f"{_escape(str(IMPORT_ERROR))}</p></div>"
        )
        fluent_window("USB Serial Inspector", html=fluent_page(body),
                      width=560, height=260, resizable=False)
        fluent_start()
        return
    api = ViewerApi()
    api.window = fluent_window(
        "USB Serial Inspector", html=_viewer_page(), js_api=api,
        width=780, height=460,
    )
    fluent_start()


def _escape(text: str) -> str:
    import html

    return html.escape(text)


if __name__ == "__main__":
    main()
