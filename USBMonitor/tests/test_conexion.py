"""Salud de la conexión y «Probar conexión» del cliente del panel.

Sin red real: DNS, TCP y _peticion van simulados con monkeypatch.
"""
import socket

import requests

import nucleo.api as api_mod
from nucleo.api import ClientePanel


class Resp:
    def __init__(self, status_code=200, datos=None):
        self.status_code = status_code
        self._datos = datos if datos is not None else {"ok": True}

    def json(self):
        return self._datos


class ConexionFalsa:
    def __enter__(self):
        return self

    def __exit__(self, *exc):
        return False


def _cliente(tmp_path, monkeypatch):
    monkeypatch.setattr(api_mod, "ARCHIVO_COLA", tmp_path / "cola.json")
    return ClientePanel()


def _red_ok(monkeypatch):
    monkeypatch.setattr(
        api_mod.socket, "gethostbyname", lambda host: "192.0.2.10"
    )
    monkeypatch.setattr(
        api_mod.socket,
        "create_connection",
        lambda direccion, timeout=5: ConexionFalsa(),
    )


def test_probar_conexion_todo_ok(tmp_path, monkeypatch):
    cliente = _cliente(tmp_path, monkeypatch)
    _red_ok(monkeypatch)

    def peticion(falsa, metodo, ruta, **kwargs):
        return Resp(200, {"ok": True})

    monkeypatch.setattr(ClientePanel, "_peticion", peticion)
    pasos = cliente.probar_conexion()
    assert [p["paso"] for p in pasos] == [
        "Resolución del host",
        "Puerto TCP",
        "HTTP del panel",
        "Credencial y ajustes",
    ]
    assert all(p["ok"] for p in pasos)
    assert all("ms" in p and "detalle" in p for p in pasos)


def test_probar_conexion_host_no_resuelve(tmp_path, monkeypatch):
    cliente = _cliente(tmp_path, monkeypatch)

    def sin_dns(host):
        raise socket.gaierror("nombre no resuelto")

    def sin_tcp(direccion, timeout=5):
        raise OSError("sin ruta al host")

    monkeypatch.setattr(api_mod.socket, "gethostbyname", sin_dns)
    monkeypatch.setattr(api_mod.socket, "create_connection", sin_tcp)
    monkeypatch.setattr(
        ClientePanel, "_peticion", lambda falsa, metodo, ruta, **kw: None
    )
    pasos = cliente.probar_conexion()  # no debe lanzar
    assert len(pasos) == 4
    assert pasos[0]["ok"] is False
    assert all(not p["ok"] for p in pasos)


def test_probar_conexion_ping_404(tmp_path, monkeypatch):
    cliente = _cliente(tmp_path, monkeypatch)
    _red_ok(monkeypatch)

    def peticion(falsa, metodo, ruta, **kwargs):
        if ruta == "/api/agent/ping":
            return Resp(404, {})
        return Resp(200, {"ok": True})

    monkeypatch.setattr(ClientePanel, "_peticion", peticion)
    pasos = cliente.probar_conexion()
    assert pasos[0]["ok"] and pasos[1]["ok"]
    assert pasos[2]["ok"] is False
    assert "falta desplegar /api/agent/ping" in pasos[2]["detalle"]
    # La credencial, en cambio, sí pasa.
    assert pasos[3]["ok"] is True


def test_salud_registra_exito_y_fallo(tmp_path, monkeypatch):
    cliente = _cliente(tmp_path, monkeypatch)

    class SesionFalsa:
        def request(self, metodo, url, headers=None, timeout=None, verify=None, **kw):
            if "falla" in url:
                raise requests.ConnectionError("sin red de prueba")
            return Resp(200, {"ok": True})

    cliente._sesion = SesionFalsa()
    assert cliente._peticion("GET", "/ok") is not None
    assert cliente._peticion("GET", "/falla") is None

    salud = cliente.salud()
    assert salud["ok"] == 1
    assert salud["fallos"] == 1
    assert salud["ultimo_exito"] is not None
    assert salud["ultimo_fallo"] is not None
    assert "HTTP 200" in salud["detalle_ultimo_exito"]
    assert "sin red de prueba" in salud["detalle_ultimo_fallo"]
    assert salud["ultima_llamada"]["ruta"] == "/falla"
    assert salud["url_base"]
    assert salud["pc"]
