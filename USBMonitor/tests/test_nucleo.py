"""Lógica pura del núcleo v2: config, diario, dispositivos."""
import json

import nucleo.config as config
import nucleo.dispositivos as dis
from nucleo.diario import Diario


# ── config ────────────────────────────────────────────────────────

def test_config_archivo_manda_sobre_entorno(tmp_path, monkeypatch):
    (tmp_path / "server.json").write_text(
        json.dumps({"serverHost": "192.168.1.50", "serverPort": 3200}),
        encoding="utf-8",
    )
    monkeypatch.setattr(config, "directorio_app", lambda: tmp_path)
    monkeypatch.setattr(config, "PROGRAM_DATA_DIR", tmp_path / "pd")
    monkeypatch.setenv("USB_MONITOR_SERVER_HOST", "10.0.0.9")
    monkeypatch.setenv("USB_MONITOR_SERVER_PORT", "4100")
    config._cache.update(ruta=None, mtime=None, datos={})
    assert config.host_servidor() == "192.168.1.50"
    assert config.puerto_servidor() == 3200
    assert config.url_base() == "http://192.168.1.50:3200"


def test_config_guardar_y_releer(tmp_path, monkeypatch):
    monkeypatch.setattr(config, "directorio_app", lambda: tmp_path)
    monkeypatch.setattr(config, "PROGRAM_DATA_DIR", tmp_path / "pd")
    config._cache.update(ruta=None, mtime=None, datos={})
    assert config.guardar({"serverHost": "1.2.3.4", "serverPort": 3000})
    datos = json.loads((tmp_path / "server.json").read_text(encoding="utf-8"))
    assert datos["serverHost"] == "1.2.3.4"
    assert config.host_servidor() == "1.2.3.4"


# ── diario ────────────────────────────────────────────────────────

def test_diario_restaurar_solo_lo_confirmado(tmp_path):
    diario = Diario(ruta=tmp_path / "diario.json")
    diario.anotar_deshabilitado("USBSTOR\\A", "S1")
    diario.anotar_deshabilitado("USBSTOR\\B", "S2")
    resumen = diario.restaurar_todo(
        lambda inst: inst.endswith("A"), lambda activo: True
    )
    assert resumen["reactivados"] == 1
    assert resumen["sin_revertir"] == ["USBSTOR\\B"]
    estado = diario.estado()
    assert list(estado["dispositivos_deshabilitados"]) == ["USBSTOR\\B"]
    # El diario persiste en disco y se relee igual.
    otro = Diario(ruta=tmp_path / "diario.json")
    assert otro.hay_pendientes()


# ── dispositivos: clasificación y seriales ────────────────────────

def test_limpiar_serial():
    assert dis.limpiar_serial("  AA0101  ") == "AA0101"
    assert dis.limpiar_serial("ABC&0") == "ABC"
    assert dis.limpiar_serial("N/A") == ""
    assert dis.limpiar_serial("0") == ""
    assert dis.limpiar_serial(None) == ""
    assert dis.serial_desde_instancia("USBSTOR\\DISK&VEN_X\\4C530001&0") == "4C530001"


def test_clasificar_disco():
    assert dis.clasificar_disco("USBSTOR\\DISK&VEN_SANDISK", []) == "DISCO"
    # Carcasa UAS: SCSI con ancestro USB.
    assert (
        dis.clasificar_disco("SCSI\\DISK&VEN_X", ["USB\\VID_1234"]) == "DISCO"
    )
    # SATA interno: SCSI sin ancestro USB -> jamas.
    assert dis.clasificar_disco("SCSI\\DISK&VEN_X", ["PCI\\VEN_8086"]) is None
    assert dis.clasificar_disco("SCSI\\DISK&VEN_X", []) is None


def test_optico_usb():
    assert dis.es_optico_usb("USBSTOR\\CDROM&VEN_HL-DT-ST", "DVDRAM")
    assert not dis.es_optico_usb("USBSTOR\\CDROM&VEN_X", "Virtual CD")
    assert not dis.es_optico_usb("SCSI\\CDROM&VEN_X", "DVDRAM")
