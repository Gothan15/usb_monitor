#!/usr/bin/env python3
"""
Script mejorado para verificar serial en whitelist y diagnosticar la conexión del backend.
"""
import os
import sys
import requests
import json
import subprocess
from pathlib import Path
from typing import Optional, Dict, Any, Tuple
from urllib.parse import quote

# Agregar el directorio del servicio al path
sys.path.insert(0, str(Path(__file__).parent.parent / "USBMonitor"))

# Importar funciones del servicio
from usb_monitor_service import (
    normalize_serial_candidate,
    get_server_host,
    get_server_port,
    build_url,
    get_auth_headers,
    LOGGER,
)

TEST_SERIAL = "1171"

def verify_whitelist(serial: str) -> Tuple[bool, Optional[Dict[str, Any]], str]:
    """Verifica si el serial está en la whitelist usando el mismo método del servicio."""
    
    print(f"\n{'='*70}")
    print(f"VERIFICACIÓN DE WHITELIST")
    print(f"{'='*70}")
    print(f"\n📋 Serial a verificar: {serial}")
    
    # Normalizar el serial
    normalized_serial = normalize_serial_candidate(serial)
    print(f"✓ Serial normalizado: {normalized_serial}")
    
    if not normalized_serial:
        msg = f"No se pudo normalizar el serial: {serial}"
        print(f"✗ {msg}")
        return False, None, msg
    
    # Construir la URL
    from urllib.parse import quote
    encoded_serial = quote(normalized_serial, safe="")
    endpoint = f"/api/whitelist/check?serial={encoded_serial}"
    url = build_url(endpoint)
    
    print(f"\n🔗 Configuración del backend:")
    print(f"   Host: {get_server_host()}")
    print(f"   Puerto: {get_server_port()}")
    print(f"   Endpoint: {endpoint}")
    print(f"   URL completa: {url}")
    
    # Obtener headers
    headers = get_auth_headers()
    api_key_present = bool(headers.get("Authorization"))
    print(f"   API Key configurada: {'Sí' if api_key_present else 'No'}")
    if api_key_present:
        print(f"   Authorization header: {headers.get('Authorization', 'N/A')[:20]}...")
    
    # Intentar conectar
    print(f"\n🔄 Enviando petición GET...")
    try:
        response = requests.get(url, headers=headers, timeout=8)
        response.raise_for_status()
        
        data = response.json()
        allowed = bool(data.get("allowed"))
        entry = data.get("entry") if allowed else None
        
        print(f"✓ Respuesta recibida (código {response.status_code})")
        print(f"  Respuesta JSON: {json.dumps(data, indent=2)}")
        
        if allowed:
            msg = f"✓ Serial {normalized_serial} ESTÁ AUTORIZADO en whitelist"
            print(f"\n{msg}")
            if entry:
                print(f"\n📌 Información del serial:")
                print(f"   Label: {entry.get('label', 'N/A')}")
                print(f"   Notas: {entry.get('notes', 'N/A')}")
                print(f"   Agregado: {entry.get('createdAt', 'N/A')}")
            return True, entry, msg
        else:
            msg = f"✗ Serial {normalized_serial} NO ESTÁ en la whitelist"
            print(f"\n{msg}")
            return False, None, msg
            
    except requests.Timeout:
        msg = f"✗ TIMEOUT: No se pudo conectar al backend (timeout: 8s)"
        print(f"\n{msg}")
        print(f"   El backend en {get_server_host()}:{get_server_port()} no responde")
        return False, None, msg
    except requests.ConnectionError as e:
        msg = f"✗ ERROR DE CONEXIÓN: No se pudo conectar al backend"
        print(f"\n{msg}")
        print(f"   Detalles: {e}")
        return False, None, msg
    except requests.RequestException as e:
        msg = f"✗ ERROR HTTP: {e}"
        print(f"\n{msg}")
        return False, None, msg
    except json.JSONDecodeError as e:
        msg = f"✗ ERROR: Respuesta no es JSON válido"
        print(f"\n{msg}")
        print(f"   Detalles: {e}")
        return False, None, msg
    except Exception as e:
        msg = f"✗ ERROR INESPERADO: {e}"
        print(f"\n{msg}")
        return False, None, msg


def check_database_directly(serial: str) -> bool:
    """Verifica la base de datos directamente usando psql."""
    
    print(f"\n{'='*70}")
    print(f"VERIFICACIÓN DIRECTA DE LA BASE DE DATOS")
    print(f"{'='*70}")
    
    normalized_serial = normalize_serial_candidate(serial)
    if not normalized_serial:
        print(f"✗ No se pudo normalizar el serial")
        return False
    
    # Obtener configuración de la BD desde variables de entorno
    db_user = os.environ.get("DATABASE_USER", "postgres")
    db_password = os.environ.get("DATABASE_PASSWORD", "123456789")
    db_host = os.environ.get("DATABASE_HOST", "localhost")
    db_port = os.environ.get("DATABASE_PORT", "5432")
    db_name = os.environ.get("DATABASE_NAME", "monitor_usb")
    
    print(f"\n📊 Configuración de la BD:")
    print(f"   Host: {db_host}")
    print(f"   Puerto: {db_port}")
    print(f"   Base de datos: {db_name}")
    print(f"   Usuario: {db_user}")
    
    # Construir el query SQL - usando tabla correcta usb_whitelist
    query = f"""SELECT id, "serialNumber", label, notes, "createdAt" FROM usb_whitelist WHERE "serialNumber" = '{normalized_serial}';"""
    
    print(f"\n🔍 Ejecutando query SQL:")
    print(f"   {query.strip()}")
    
    try:
        # Configurar variables de entorno para psql con la contraseña
        env = os.environ.copy()
        env["PGPASSWORD"] = db_password
        
        # Ejecutar psql
        result = subprocess.run(
            [
                "psql",
                "-h", db_host,
                "-p", db_port,
                "-U", db_user,
                "-d", db_name,
                "-c", query
            ],
            capture_output=True,
            text=True,
            timeout=10,
            env=env
        )
        
        if result.returncode == 0:
            print(f"\n✓ Query ejecutado exitosamente")
            print(f"\n📋 Resultado:")
            print(result.stdout)
            
            if "(0 filas)" in result.stdout or "(0 rows)" in result.stdout:
                print(f"\n⚠️  No se encontró el serial en la base de datos")
                return False
            else:
                print(f"\n✓ Serial encontrado en la base de datos")
                return True
        else:
            print(f"\n✗ Error ejecutando query")
            print(f"   Error: {result.stderr}")
            return False
            
    except FileNotFoundError:
        print(f"\n✗ psql no está disponible o no está en el PATH")
        print(f"   Instala PostgreSQL o agrega su bin al PATH")
        return False
    except subprocess.TimeoutExpired:
        print(f"\n✗ Timeout ejecutando query")
        return False
    except Exception as e:
        print(f"\n✗ Error: {e}")
        return False


def main():
    print(f"\n{'#'*70}")
    print(f"# VERIFICACIÓN DE SERIAL EN WHITELIST")
    print(f"# Serial: {TEST_SERIAL}")
    print(f"{'#'*70}")
    
    # Paso 1: Verificar via API del backend
    print(f"\n\n[PASO 1/2] Verificar via API del backend")
    api_allowed, entry, api_msg = verify_whitelist(TEST_SERIAL)
    
    # Paso 2: Si no está en la API, verificar directamente en la BD
    if not api_allowed:
        print(f"\n\n[PASO 2/2] Verificar directamente en la base de datos")
        db_found = check_database_directly(TEST_SERIAL)
        
        if db_found:
            print(f"\n\n⚠️  DIAGNÓSTICO:")
            print(f"    • El serial EXISTE en la base de datos")
            print(f"    • Pero NO está siendo devuelto por la API")
            print(f"    • Posible problema: Error en la API del backend")
        else:
            print(f"\n\n⚠️  DIAGNÓSTICO:")
            print(f"    • El serial NO existe en la base de datos")
            print(f"    • Posible solución: Agregar el serial a la whitelist")
    else:
        print(f"\n\n✓ DIAGNÓSTICO:")
        print(f"    • El serial está autorizado en la whitelist")
        print(f"    • El backend está funcionando correctamente")
    
    print(f"\n{'#'*70}\n")


if __name__ == "__main__":
    main()
