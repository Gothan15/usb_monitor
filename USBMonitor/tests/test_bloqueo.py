"""Motor de bloqueo: capas, verificación, idempotencia, extracción
y ausencia de carreras bajo uso concurrente."""
import threading

from nucleo.bloqueo import (
    CAPA_PNP,
    CAPA_SOLO_LECTURA,
    CAPA_VOLUMEN,
    ESTADO_BLOQUEADO,
    MotorBloqueo,
)
from nucleo.diario import Diario
from nucleo.dispositivos import Dispositivo


class SistemaFalso:
    """Doble de las costuras del sistema."""

    def __init__(self, *, pnp_ok=True, volumen_ok=True, sl_ok=True):
        self.pnp_ok = pnp_ok
        self.volumen_ok = volumen_ok
        self.sl_ok = sl_ok
        self.deshabilitados = set()
        self.retenidas = set()
        self.solo_lectura = set()
        self.llamadas_habilitar = 0

    def deshabilitar(self, instancia):
        if not self.pnp_ok:
            return False
        self.deshabilitados.add(instancia)
        return True

    def habilitar(self, instancia):
        self.llamadas_habilitar += 1
        self.deshabilitados.discard(instancia)
        return True

    def esta_deshabilitado(self, instancia):
        return instancia in self.deshabilitados

    def accesible(self, letra):
        return letra not in self.retenidas


class CandadosFalsos:
    def __init__(self, sistema):
        self.sistema = sistema

    def bloquear(self, letra):
        if not self.sistema.volumen_ok:
            return False
        self.sistema.retenidas.add(letra)
        return True

    def soltar(self, letra):
        self.sistema.retenidas.discard(letra)

    def soltar_todos(self):
        self.sistema.retenidas.clear()

    def retenida(self, letra):
        return letra in self.sistema.retenidas


def hacer_motor(tmp_path, sistema):
    diario = Diario(ruta=tmp_path / "diario.json")
    motor = MotorBloqueo(
        diario,
        deshabilitar=sistema.deshabilitar,
        habilitar=sistema.habilitar,
        esta_deshabilitado=sistema.esta_deshabilitado,
        candados=CandadosFalsos(sistema),
        accesible=sistema.accesible,
        poner_solo_lectura=lambda letra: sistema.sl_ok and not sistema.solo_lectura.add(letra),
        quitar_solo_lectura=lambda letra: sistema.solo_lectura.discard(letra) or True,
    )
    return motor, diario


DISP = Dispositivo(
    instancia="USBSTOR\\DISK&VEN_X\\S1",
    serial="S1",
    nombre="Memoria X",
    tipo="DISCO",
    letras=["E:"],
)


def test_capa_pnp_y_diario(tmp_path):
    sistema = SistemaFalso()
    motor, diario = hacer_motor(tmp_path, sistema)
    reg = motor.bloquear(DISP, True)
    assert reg.estado == ESTADO_BLOQUEADO and reg.capa == CAPA_PNP
    assert "USBSTOR\\DISK&VEN_X\\S1" in diario.estado()["dispositivos_deshabilitados"]
    assert motor.liberar(DISP.clave)
    assert sistema.deshabilitados == set()
    assert not diario.hay_pendientes()


def test_respaldo_volumen_y_degradado(tmp_path):
    sistema = SistemaFalso(pnp_ok=False)
    motor, _ = hacer_motor(tmp_path, sistema)
    reg = motor.bloquear(DISP, True)
    assert reg.capa == CAPA_VOLUMEN and not reg.degradado

    sistema2 = SistemaFalso(pnp_ok=False, volumen_ok=False)
    motor2, _ = hacer_motor(tmp_path, sistema2)
    reg2 = motor2.bloquear(DISP, False)
    assert reg2.capa == CAPA_SOLO_LECTURA and reg2.degradado


def test_liberar_es_idempotente(tmp_path):
    sistema = SistemaFalso()
    motor, _ = hacer_motor(tmp_path, sistema)
    motor.bloquear(DISP, True)
    assert motor.liberar(DISP.clave)
    llamadas = sistema.llamadas_habilitar
    assert motor.liberar(DISP.clave)  # segunda vez: no-op
    assert sistema.llamadas_habilitar == llamadas


def test_extraccion_reactiva_el_nodo(tmp_path):
    sistema = SistemaFalso()
    motor, diario = hacer_motor(tmp_path, sistema)
    motor.bloquear(DISP, True)
    motor.al_extraer(DISP.clave)  # el dispositivo ya no esta
    assert sistema.deshabilitados == set()
    assert not diario.hay_pendientes()
    assert motor.registro(DISP.clave) is None


def test_vigia_reaplica_si_revive(tmp_path):
    sistema = SistemaFalso()
    motor, _ = hacer_motor(tmp_path, sistema)
    motor.bloquear(DISP, True)
    sistema.deshabilitados.clear()  # alguien lo reactivo a mano
    reaplicadas = motor.vigilar()
    assert reaplicadas == [DISP.clave]
    assert DISP.instancia in sistema.deshabilitados


def test_sin_carreras_bajo_concurrencia(tmp_path):
    sistema = SistemaFalso()
    motor, diario = hacer_motor(tmp_path, sistema)
    errores = []

    def martillo(n):
        try:
            for _ in range(30):
                if n % 2:
                    motor.bloquear(DISP, True)
                else:
                    motor.liberar(DISP.clave)
        except Exception as exc:  # pragma: no cover
            errores.append(exc)

    hilos = [threading.Thread(target=martillo, args=(i,)) for i in range(8)]
    for h in hilos:
        h.start()
    for h in hilos:
        h.join()
    assert not errores
    # Estado final coherente: si quedo bloqueado, el sistema y el
    # diario concuerdan; si quedo liberado, ninguno retiene nada.
    reg = motor.registro(DISP.clave)
    if reg and reg.estado == ESTADO_BLOQUEADO:
        assert DISP.instancia in sistema.deshabilitados
        assert diario.hay_pendientes()
    else:
        assert DISP.instancia not in sistema.deshabilitados
        assert not diario.hay_pendientes()
