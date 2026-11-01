"""Configuración en archivo server.json.

El archivo manda sobre las variables de entorno; sin archivo, el
comportamiento es el de siempre (entorno y valores por defecto).
Las rutas se sustituyen por un server.json temporal.
"""

import json

import usb_monitor_service as svc


def _usar_config(monkeypatch, tmp_path, datos):
    ruta = tmp_path / "server.json"
    if datos is not None:
        ruta.write_text(json.dumps(datos), encoding="utf-8")
    monkeypatch.setattr(svc, "_server_config_paths", lambda: [ruta])
    svc._SERVER_CONFIG_CACHE.update(path=None, mtime=None, data={})
    return ruta


def test_sin_archivo_usa_entorno(monkeypatch, tmp_path):
    _usar_config(monkeypatch, tmp_path, None)
    monkeypatch.setenv("USB_MONITOR_SERVER_HOST", "10.0.0.9")
    monkeypatch.setenv("USB_MONITOR_SERVER_PORT", "4100")
    assert svc.get_server_host() == "10.0.0.9"
    assert svc.get_server_port() == 4100


def test_archivo_manda_sobre_entorno(monkeypatch, tmp_path):
    _usar_config(
        monkeypatch,
        tmp_path,
        {"serverHost": "192.168.1.50", "serverPort": 3200, "serverScheme": "https"},
    )
    monkeypatch.setenv("USB_MONITOR_SERVER_HOST", "10.0.0.9")
    monkeypatch.setenv("USB_MONITOR_SERVER_PORT", "4100")
    assert svc.get_server_host() == "192.168.1.50"
    assert svc.get_server_port() == 3200
    assert svc.build_url("/api/x") == "https://192.168.1.50:3200/api/x"


def test_puerto_invalido_en_archivo_cae_al_entorno(monkeypatch, tmp_path):
    _usar_config(monkeypatch, tmp_path, {"serverPort": "no-es-numero"})
    monkeypatch.setenv("USB_MONITOR_SERVER_PORT", "4100")
    assert svc.get_server_port() == 4100


def test_token_y_api_key_desde_archivo(monkeypatch, tmp_path):
    _usar_config(
        monkeypatch,
        tmp_path,
        {"agentToken": "token-del-archivo", "apiKey": "clave-del-archivo"},
    )
    monkeypatch.delenv("USB_MONITOR_AGENT_TOKEN", raising=False)
    monkeypatch.delenv("USB_MONITOR_API_KEY", raising=False)
    assert svc.get_agent_token() == "token-del-archivo"
    assert svc.get_configured_api_key() == "clave-del-archivo"
    headers = svc.get_auth_headers()
    assert headers.get("Authorization") == "AgentToken token-del-archivo"


def test_guardar_y_releer(monkeypatch, tmp_path):
    ruta = _usar_config(monkeypatch, tmp_path, {"serverHost": "1.2.3.4"})
    monkeypatch.setattr(svc, "get_app_directory", lambda: tmp_path)
    assert svc.save_server_config({"serverHost": "5.6.7.8", "serverPort": 3000})
    datos = json.loads(ruta.read_text(encoding="utf-8"))
    assert datos["serverHost"] == "5.6.7.8"
    assert datos["serverPort"] == 3000
    # La caché se invalida al guardar: la lectura ya ve el nuevo host.
    assert svc.get_server_host() == "5.6.7.8"
