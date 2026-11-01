"""Tests de los bloqueos locales (detección amplia)."""

import json

import usb_monitor_service as svc
# ─── Detección amplia III: unidades ópticas USB ────────────────────
class FakeCD:
    def __init__(self, **kw):
        self.PNPDeviceID = kw.get("pnp")
        self.Drive = kw.get("drive")
        self.Name = kw.get("name")
        self.Caption = kw.get("name")
        self.VolumeName = kw.get("vol", "")


def _conn_con_cds(cds):
    class C:
        def Win32_CDROMDrive(self):
            return cds
    return C()


def test_optica_usb_detectada():
    conn = _conn_con_cds([
        FakeCD(pnp="USBSTOR\\CDROM&VEN_ASUS&PID_SDRW\\A1B2C3D4&0", drive="E:", name="ASUS SDRW-08D2S-U"),
        FakeCD(pnp="SCSI\\CDROM&VEN_DTSoftBusCd00", drive="F:", name="Virtual Daemon"),  # virtual -> fuera
        FakeCD(pnp="IDE\\CDROMHL-DT-ST_DVDRAM", drive="G:", name="Interna IDE"),  # interna -> fuera
    ])
    drives = svc.get_connected_optical_drives(conn)
    assert [d["driveLetter"] for d in drives] == ["E:"]
    assert drives[0]["serialNumber"] == "A1B2C3D4"
    assert drives[0]["mediaType"] == "CD-ROM"


def test_optica_sin_letra_se_omite():
    conn = _conn_con_cds([FakeCD(pnp="USBSTOR\\CDROM&VEN_X\\SER1&0", drive="", name="Sin letra")])
    assert svc.get_connected_optical_drives(conn) == []


# ─── Emergencia sin red también para móviles (sin letra) ──────────
def _preparar_emergencia(tmp_path, monkeypatch, pendings):
    from argon2 import PasswordHasher

    monkeypatch.setattr(svc, "PENDING_LOCAL_FILE", tmp_path / "pending_local.json")
    monkeypatch.setattr(svc, "OWNER_HASH_FILE", tmp_path / "owner_hash.json")
    monkeypatch.setattr(svc, "EMERGENCY_STATE_FILE", tmp_path / "emergency_state.json")
    monkeypatch.setattr(svc, "QUEUE_STORE_FILE", tmp_path / "queue.jsonl")
    svc._save_local_pendings(pendings)
    phc = PasswordHasher().hash("ClaveDelDueno1")
    svc.OWNER_HASH_FILE.write_text(
        json.dumps(
            {
                "username": "dueno",
                "passwordHash": svc.encrypt_value("argon2id$" + phc),
            }
        ),
        encoding="utf-8",
    )


def test_emergencia_movil_por_clave_serial(tmp_path, monkeypatch):
    _preparar_emergencia(
        tmp_path,
        monkeypatch,
        [
            {
                "status": "BLOCKED",
                "driveLetter": None,
                "serialNumber": "PIXEL8XYZ",
                "deviceLabel": "Pixel 8",
                "deviceKind": "WPD",
            }
        ],
    )
    status, serial, pending = svc._check_emergency_credentials(
        "dueno", "ClaveDelDueno1", "SER:PIXEL8XYZ"
    )
    assert status == "ok"
    assert serial == "PIXEL8XYZ"
    assert pending["deviceLabel"] == "Pixel 8"


def test_emergencia_movil_clave_incorrecta(tmp_path, monkeypatch):
    _preparar_emergencia(
        tmp_path,
        monkeypatch,
        [
            {
                "status": "BLOCKED",
                "driveLetter": None,
                "serialNumber": "PIXEL8XYZ",
                "deviceLabel": "Pixel 8",
            }
        ],
    )
    status, _serial, _pending = svc._check_emergency_credentials(
        "dueno", "otra-clave", "SER:PIXEL8XYZ"
    )
    assert status == "fail"
    assert svc._load_emergency_state()["failures"] == 1


def test_emergencia_letra_sigue_funcionando(tmp_path, monkeypatch):
    _preparar_emergencia(
        tmp_path,
        monkeypatch,
        [{"status": "BLOCKED", "driveLetter": "E:", "serialNumber": "SERDISCO"}],
    )
    status, serial, _p = svc._check_emergency_credentials(
        "dueno", "ClaveDelDueno1", "e"
    )
    assert status == "ok"
    assert serial == "SERDISCO"
