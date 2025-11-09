"""Aplicacion de escritorio para listar unidades USB y mostrar sus seriales.

Requisitos de ejecucion directa:
    pip install wmi pywin32

El script esta pensado para convertirse en un ejecutable (por ejemplo con
PyInstaller o Nuitka). Proporciona una interfaz grafica simple basada en Tkinter
que permite inspeccionar unidades conectadas por USB y ver sus numeros de
serie.
"""
from __future__ import annotations

import logging
import re
import threading
from dataclasses import dataclass
from typing import Iterable, List, Optional, Sequence

import tkinter as tk
from tkinter import messagebox, ttk

try:  # type: ignore
    import pythoncom  # type: ignore
    import wmi  # type: ignore
except ImportError as exc:  # pragma: no cover - dependencias externas
    pythoncom = None  # type: ignore
    wmi = None  # type: ignore
    IMPORT_ERROR = exc
else:
    IMPORT_ERROR = None

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


class USBSerialViewer(tk.Tk):
    def __init__(self) -> None:
        super().__init__()
        self.title("USB Serial Inspector")
        self.geometry("720x360")
        self.resizable(True, True)

        self._create_widgets()
        self.after(100, self.refresh_devices)

    def _create_widgets(self) -> None:
        self.columnconfigure(0, weight=1)
        self.rowconfigure(0, weight=1)

        self.tree = ttk.Treeview(
            self,
            columns=("serial", "letters", "size", "model"),
            show="headings",
        )
        self.tree.heading("serial", text="Serial")
        self.tree.heading("letters", text="Letras")
        self.tree.heading("size", text="Tamano")
        self.tree.heading("model", text="Modelo")
        self.tree.column("serial", width=180, anchor="w")
        self.tree.column("letters", width=120, anchor="center")
        self.tree.column("size", width=120, anchor="e")
        self.tree.column("model", width=240, anchor="w")
        self.tree.grid(row=0, column=0, sticky="nsew", padx=12, pady=(12, 6))

        scrollbar = ttk.Scrollbar(
            self, orient="vertical", command=self.tree.yview
        )
        self.tree.configure(yscrollcommand=scrollbar.set)
        scrollbar.grid(row=0, column=1, sticky="ns", pady=(12, 6))

        btn_frame = ttk.Frame(self)
        btn_frame.grid(row=1, column=0, columnspan=2, sticky="ew", padx=12, pady=6)
        btn_frame.columnconfigure(0, weight=1)
        btn_frame.columnconfigure(1, weight=1)

        self.refresh_button = ttk.Button(
            btn_frame, text="Actualizar", command=self.refresh_devices
        )
        self.refresh_button.grid(row=0, column=0, padx=(0, 6), sticky="ew")

        self.copy_button = ttk.Button(
            btn_frame, text="Copiar serial", command=self.copy_selected_serial
        )
        self.copy_button.grid(row=0, column=1, sticky="ew")

        self.status_var = tk.StringVar(value="Listo")
        status_bar = ttk.Label(self, textvariable=self.status_var, anchor="w")
        status_bar.grid(row=2, column=0, columnspan=2, sticky="ew", padx=12, pady=6)

    def refresh_devices(self) -> None:
        if getattr(self, "_refresh_in_progress", False):
            return
        self._refresh_in_progress = True
        self.refresh_button.state(["disabled"])
        self.status_var.set("Escaneando dispositivos USB...")
        thread = threading.Thread(target=self._refresh_worker, daemon=True)
        thread.start()

    def _refresh_worker(self) -> None:
        try:
            devices = collect_usb_devices()
        except Exception as exc:
            LOGGER.exception("Fallo al escanear dispositivos USB: %s", exc)
            self.after(0, self._handle_refresh_error, exc)
            return
        self.after(0, self._complete_refresh, devices)

    def _handle_refresh_error(self, exc: Exception) -> None:
        self._refresh_in_progress = False
        self.refresh_button.state(["!disabled"])
        self.status_var.set("Error al escanear. Revise el log.")
        messagebox.showerror("USB Serial Inspector", str(exc), parent=self)

    def _complete_refresh(self, devices: Sequence[USBDevice]) -> None:
        self.tree.delete(*self.tree.get_children())
        for device in devices:
            letters = ", ".join(device.letters) if device.letters else "-"
            size = format_size(device.size_bytes)
            self.tree.insert(
                "",
                "end",
                values=(device.serial, letters, size, device.model),
                tags=(device.device_id,),
            )
        count = len(devices)
        self.status_var.set(
            "Se detectaron %d dispositivo(s) USB." % count
            if count
            else "No se detectaron dispositivos USB."
        )
        self.refresh_button.state(["!disabled"])
        self._refresh_in_progress = False

    def copy_selected_serial(self) -> None:
        selection = self.tree.selection()
        if not selection:
            messagebox.showinfo(
                "USB Serial Inspector",
                "Seleccione un dispositivo para copiar el serial.",
                parent=self,
            )
            return
        item = self.tree.item(selection[0])
        serial = item.get("values", [""])[0]
        if not serial:
            messagebox.showwarning(
                "USB Serial Inspector",
                "El dispositivo seleccionado no tiene serial disponible.",
                parent=self,
            )
            return
        self.clipboard_clear()
        self.clipboard_append(serial)
        self.status_var.set("Serial copiado al portapapeles.")


def main() -> None:
    if IMPORT_ERROR is not None:
        messagebox.showerror(
            "USB Serial Inspector",
            "No se pudieron importar las dependencias requeridas: %s" % IMPORT_ERROR,
        )
        return
    app = USBSerialViewer()
    app.mainloop()


if __name__ == "__main__":
    main()
