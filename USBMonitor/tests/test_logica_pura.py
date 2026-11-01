"""Tests de la lógica pura del agente (Fase 7 del plan de arreglos).

Cubren lo que no necesita Windows: seriales, la cola persistente, el
contador de la emergencia sin red, la extracción del hash PHC, el
descifrado fail-closed, la reconciliación de bloqueos sin red y el
programador de reintentos de liberación.

Ejecutar desde la raíz del repo:  python -m pytest USBMonitor/tests
"""

import json
import time

import pytest

import usb_monitor_service as svc


# ── Seriales ────────────────────────────────────────────────────────────

def test_serial_normaliza_a_mayusculas_sin_espacios():
    assert svc.normalize_serial_candidate("  aa01 0122 4051 ") == "AA0101224051"


def test_serial_descarta_centinelas_y_vacios():
    for malo in ("UNKNOWN", "N/A", "None", "", "   ", None, 12345):
        assert svc.normalize_serial_candidate(malo) is None


def test_serial_quita_caracteres_no_permitidos():
    assert svc.normalize_serial_candidate("AB-12_3.4$%") == "AB-12_3.4"


def test_serial_desde_device_id():
    device_id = r"USBSTOR\DISK&VEN_KINGSTON&PROD_DATATRAVELER\AA0101224051701614&0"
    assert svc.extract_serial_from_device_id(device_id) == "AA0101224051701614"


# ── Hash del panel ──────────────────────────────────────────────────────

def test_extract_argon2_phc_desde_formato_del_panel():
    stored = "argon2id$$argon2id$v=19$m=65536,t=3,p=4$c2FsdA$aGFzaA"
    assert svc._extract_argon2_phc(stored) == "$argon2id$v=19$m=65536,t=3,p=4$c2FsdA$aGFzaA"


def test_extract_argon2_phc_sin_phc_devuelve_none():
    assert svc._extract_argon2_phc("bcrypt$2y$10$loquesea") is None


# ── Descifrado fail-closed (Fase 0) ─────────────────────────────────────

def test_decrypt_sin_prefijo_pasa_tal_cual():
    assert svc.decrypt_value("valor-plano") == "valor-plano"


def test_decrypt_corrupto_se_descarta_no_se_usa():
    # Antes devolvía el texto cifrado como si fuera la credencial.
    assert svc.decrypt_value("ENC:esto-no-es-un-fernet-valido") == ""


# ── Cola persistente ────────────────────────────────────────────────────

@pytest.fixture()
def cola_tmp(tmp_path, monkeypatch):
    archivo = tmp_path / "queue_store.jsonl"
    monkeypatch.setattr(svc, "QUEUE_STORE_FILE", archivo)
    monkeypatch.setattr(svc, "_ensure_queue_flusher_started", lambda: None)
    return archivo


def test_cola_escribe_y_lee_en_orden(cola_tmp):
    assert svc.enqueue_persistent("event", {"n": 1}) is True
    assert svc.enqueue_persistent("event", {"n": 2}) is True
    records = svc._read_queue_records()
    assert [r["payload"]["n"] for r in records] == [1, 2]
    assert all(r["kind"] == "event" and r["id"] for r in records)


def test_cola_descarta_lineas_corruptas(cola_tmp):
    svc.enqueue_persistent("event", {"n": 1})
    with open(cola_tmp, "a", encoding="utf-8") as fh:
        fh.write("{esto no es json\n")
    svc.enqueue_persistent("event", {"n": 2})
    assert [r["payload"]["n"] for r in svc._read_queue_records()] == [1, 2]


def test_cola_pop_borra_solo_el_confirmado(cola_tmp):
    svc.enqueue_persistent("event", {"n": 1})
    svc.enqueue_persistent("event", {"n": 2})
    primero = svc._read_queue_records()[0]
    svc._pop_queue_record(primero["id"])
    restantes = svc._read_queue_records()
    assert len(restantes) == 1 and restantes[0]["payload"]["n"] == 2


# ── Emergencia sin red: contador y bloqueo ──────────────────────────────

@pytest.fixture()
def emergencia_tmp(tmp_path, monkeypatch):
    archivo = tmp_path / "emergency_state.json"
    monkeypatch.setattr(svc, "EMERGENCY_STATE_FILE", archivo)
    monkeypatch.setattr(svc, "_ensure_queue_flusher_started", lambda: None)
    monkeypatch.setattr(svc, "QUEUE_STORE_FILE", tmp_path / "queue.jsonl")
    return archivo


def test_emergencia_bloquea_tras_max_fallos(emergencia_tmp):
    for _ in range(svc.EMERGENCY_MAX_FAILURES):
        svc._emergency_register_failure("dueno", "E:", "SERIAL1")
    assert svc._emergency_locked_remaining() > 0
    estado = json.loads(emergencia_tmp.read_text(encoding="utf-8"))
    assert estado["lockedUntil"] > time.time()


def test_emergencia_exito_reinicia_el_contador(emergencia_tmp):
    svc._emergency_register_failure("dueno", "E:", "SERIAL1")
    svc._emergency_register_success("dueno", "E:", "SERIAL1")
    assert svc._load_emergency_state() == {"failures": 0, "lockedUntil": 0.0}


# ── Reconciliación de bloqueos creados sin red (Fase 1) ─────────────────

@pytest.fixture()
def pendientes_tmp(tmp_path, monkeypatch):
    archivo = tmp_path / "pending_local.json"
    monkeypatch.setattr(svc, "PENDING_LOCAL_FILE", archivo)
    return archivo


def _escribe_pendientes(archivo, datos):
    archivo.write_text(json.dumps(datos), encoding="utf-8")


def test_reconcile_registra_solo_bloqueados_sin_id(pendientes_tmp, monkeypatch):
    _escribe_pendientes(pendientes_tmp, [
        {"id": None, "pcName": "PC-1", "driveLetter": "E:", "serialNumber": "S1",
         "deviceLabel": "Pendrive", "whitelisted": True, "status": "BLOCKED"},
        {"id": "ya-tiene", "pcName": "PC-1", "driveLetter": "F:", "status": "BLOCKED"},
        {"id": None, "pcName": "PC-1", "driveLetter": "G:", "status": "UNLOCKED"},
    ])
    monkeypatch.setattr(
        svc, "_create_pending_unlock_request",
        lambda *a, **k: (True, "srv-123"),
    )
    assert svc.reconcile_local_pendings() == 1
    datos = json.loads(pendientes_tmp.read_text(encoding="utf-8"))
    assert datos[0]["id"] == "srv-123"
    assert datos[1]["id"] == "ya-tiene"
    assert datos[2]["id"] is None


def test_reconcile_sin_red_no_rompe_ni_borra(pendientes_tmp, monkeypatch):
    _escribe_pendientes(pendientes_tmp, [
        {"id": None, "pcName": "PC-1", "driveLetter": "E:", "status": "BLOCKED"},
    ])

    def falla(*a, **k):
        raise ConnectionError("sin red")

    monkeypatch.setattr(svc, "_create_pending_unlock_request", falla)
    assert svc.reconcile_local_pendings() == 0
    datos = json.loads(pendientes_tmp.read_text(encoding="utf-8"))
    assert datos[0]["id"] is None and datos[0]["status"] == "BLOCKED"


# ── Reintentos de liberación (Fase 2) ───────────────────────────────────

def _servicio_desnudo():
    obj = object.__new__(svc.USBMonitorService)
    obj.pending_usbs = {}
    obj.block_state = {}
    obj.unlocked_active = {}
    obj.release_retries = {}
    return obj


def test_reintento_se_programa_con_espera():
    obj = _servicio_desnudo()
    obj._schedule_release_retry("E:", {"serialNumber": "S1"}, attempts=1)
    entrada = obj.release_retries["E"]
    assert entrada["attempts"] == 1
    assert entrada["next_at"] > time.time()


def test_reintento_agotado_avisa_al_panel_y_se_descarta(monkeypatch):
    obj = _servicio_desnudo()
    encolados = []
    monkeypatch.setattr(
        svc, "enqueue_persistent",
        lambda kind, payload: encolados.append((kind, payload)) or True,
    )
    obj._schedule_release_retry(
        "E:", {"serialNumber": "S1"}, attempts=len(obj.RELEASE_RETRY_DELAYS) + 1
    )
    assert "E" not in obj.release_retries
    assert encolados and "UNLOCK_RELEASE_FAILED" in encolados[0][1]["event"]
