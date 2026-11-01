"""Tests de los bloqueos locales (detección amplia)."""

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
