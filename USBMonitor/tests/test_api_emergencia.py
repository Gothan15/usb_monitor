"""Cola de eventos del cliente (store-and-forward) y emergencia
sin red: orden, persistencia y formato de los intentos."""
import nucleo.api as api_mod
import nucleo.emergencia as em_mod
from nucleo.api import ClientePanel
from nucleo.emergencia import Emergencia


class Resp:
    def __init__(self, status_code=200, datos=None):
        self.status_code = status_code
        self._datos = datos or {"ok": True}

    def json(self):
        return self._datos


def test_cola_fifo_y_persistencia(tmp_path, monkeypatch):
    monkeypatch.setattr(api_mod, "ARCHIVO_COLA", tmp_path / "cola.json")
    cliente = ClientePanel()
    salidas = []
    en_linea = {"ok": False}

    def peticion(falsa, metodo, ruta, **kwargs):
        if not en_linea["ok"]:
            return None
        salidas.append(kwargs["json"]["event"])
        return Resp(200)

    monkeypatch.setattr(ClientePanel, "_peticion", peticion)
    cliente.evento("CONNECTED", letra="E:", serial="S1")
    cliente.evento("BLOCKED", letra="E:", serial="S1")
    assert cliente.vaciar_cola() == 0  # sin red: nada sale, nada se pierde
    assert cliente.eventos_en_cola() == 2
    en_linea["ok"] = True
    assert cliente.vaciar_cola() == 2
    assert salidas == ["CONNECTED", "BLOCKED"]  # orden FIFO
    assert cliente.eventos_en_cola() == 0


def test_emergencia_dueno_y_bloqueo_temporal(tmp_path, monkeypatch):
    from argon2 import PasswordHasher

    monkeypatch.setattr(em_mod, "ARCHIVO_DUENO", tmp_path / "dueno.json")
    monkeypatch.setattr(em_mod, "ARCHIVO_ESTADO", tmp_path / "estado.json")
    monkeypatch.setattr(em_mod, "ARCHIVO_INTENTOS", tmp_path / "intentos.json")
    em = Emergencia()
    em.guardar_hash("duena", PasswordHasher().hash("ClaveSegura1"))

    ok, _ = em.verificar("CLAVE1", "duena", "ClaveSegura1", letra="E:", serial="S1")
    assert ok
    # Otro usuario, aunque acierte la clave, no es el dueno.
    ok, _ = em.verificar("CLAVE1", "admin", "ClaveSegura1", letra="E:", serial="S1")
    assert not ok
    for _ in range(5):
        ok, motivo = em.verificar("CLAVE1", "duena", "mala", letra="E:", serial="S1")
        assert not ok
    # Tras 5 fallos, ni la buena entra hasta que pase la espera.
    ok, motivo = em.verificar("CLAVE1", "duena", "ClaveSegura1", letra="E:", serial="S1")
    assert not ok and motivo == "espera"

    intentos = em.intentos_pendientes()
    assert intentos[0]["result"] == "OFFLINE_OK"
    assert intentos[0]["driveLetter"] == "E:"
    assert {i["usernameTried"] for i in intentos} <= {"duena", "admin"}
