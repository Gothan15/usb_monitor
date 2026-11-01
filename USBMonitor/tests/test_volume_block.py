"""Bloqueo por volumen (FSCTL lock + dismount con handle retenido).

Las llamadas al sistema se sustituyen por dobles: lo que se prueba
es la lógica (orden lock->dismount, verificación por sonda, handle
retenido y su liberación), no la API de Windows.
"""

import usb_monitor_service as svc


class FakeVolumen:
    """Doble de las costuras de sistema del bloqueo por volumen."""

    def __init__(self, monkeypatch, *, lock_ok=True, dismount_ok=True, accesible=False):
        self.ioctls = []
        self.cerrados = []
        self.accesible = accesible
        monkeypatch.setattr(svc, "_open_volume_handle", lambda letra: 4242)
        monkeypatch.setattr(svc, "_close_volume_handle", lambda h: self.cerrados.append(h))

        def _ioctl(handle, code):
            self.ioctls.append(code)
            if code == svc.FSCTL_LOCK_VOLUME:
                return lock_ok
            return dismount_ok

        monkeypatch.setattr(svc, "_volume_ioctl", _ioctl)
        monkeypatch.setattr(svc, "_volume_is_accessible", lambda letra: self.accesible)
        svc._VOLUME_LOCKS.clear()


def test_bloqueo_ok_retiene_el_handle(monkeypatch):
    fake = FakeVolumen(monkeypatch)
    ok, _msg = svc.lock_and_dismount_volume("E:")
    assert ok
    assert fake.ioctls == [svc.FSCTL_LOCK_VOLUME, svc.FSCTL_DISMOUNT_VOLUME]
    assert svc._VOLUME_LOCKS == {"E": 4242}
    assert fake.cerrados == []


def test_si_el_lock_falla_no_se_desmonta_ni_se_retiene(monkeypatch):
    fake = FakeVolumen(monkeypatch, lock_ok=False)
    ok, _msg = svc.lock_and_dismount_volume("E:", attempts=3, delay_s=0)
    assert not ok
    assert svc.FSCTL_DISMOUNT_VOLUME not in fake.ioctls
    assert svc._VOLUME_LOCKS == {}
    assert fake.cerrados == [4242]  # el handle se cierra al rendirse


def test_si_sigue_accesible_tras_desmontar_no_hay_bloqueo(monkeypatch):
    fake = FakeVolumen(monkeypatch, accesible=True)
    ok, _msg = svc.lock_and_dismount_volume("E:")
    assert not ok
    assert svc._VOLUME_LOCKS == {}
    assert fake.cerrados == [4242]


def test_liberar_cierra_el_handle_y_es_idempotente(monkeypatch):
    FakeVolumen(monkeypatch)
    assert svc.lock_and_dismount_volume("E:")[0]
    ok, _msg = svc.release_volume_lock("E:")
    assert ok
    assert svc._VOLUME_LOCKS == {}
    # Segunda vez: sin handle, sigue siendo éxito (ya remontado).
    assert svc.release_volume_lock("E:")[0]


def test_apply_block_prioriza_el_volumen(monkeypatch):
    monkeypatch.setattr(
        svc, "lock_and_dismount_volume", lambda letra: (True, "volumen ok")
    )

    def _pnp_prohibido(_instance):
        raise AssertionError("no debió intentar PnP habiendo volumen")

    monkeypatch.setattr(svc, "disable_pnp_device", _pnp_prohibido)
    monkeypatch.setattr(svc, "lock_session_on_insert_if_enabled", lambda: None)
    _letra, ok, _detalle, method = svc.apply_block("E:", None, "USBSTOR\\DISK&VEN_X")
    assert ok
    assert method == svc.BLOCK_METHOD_VOLUME


def test_apply_block_cae_a_pnp_si_el_volumen_falla(monkeypatch):
    monkeypatch.setattr(
        svc, "lock_and_dismount_volume", lambda letra: (False, "sin lock")
    )
    monkeypatch.setattr(svc, "disable_pnp_device", lambda i: (True, "pnp ok"))
    monkeypatch.setattr(svc, "lock_session_on_insert_if_enabled", lambda: None)
    _letra, ok, _detalle, method = svc.apply_block("E:", None, "USBSTOR\\DISK&VEN_X")
    assert ok
    assert method == svc.BLOCK_METHOD_PNP
