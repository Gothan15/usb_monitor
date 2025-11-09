"""
Script de prueba para verificar la encriptación/desencriptación de API keys

Ejecutar desde el directorio USBMonitor:
    python test_encryption.py
"""

import sys
import os
from pathlib import Path

# Agregar el directorio actual al path para importar el servicio
sys.path.insert(0, str(Path(__file__).parent))

try:
    from usb_monitor_service import (
        encrypt_api_key,
        decrypt_api_key,
        CRYPTOGRAPHY_AVAILABLE,
    )
    print("✓ Módulos importados correctamente\n")
except ImportError as e:
    print(f"✗ Error al importar módulos: {e}")
    print("Asegúrate de estar en el directorio correcto y tener las dependencias instaladas")
    sys.exit(1)


def test_encryption():
    """Prueba la encriptación y desencriptación de una API key"""
    print("=" * 60)
    print("  TEST DE ENCRIPTACIÓN DE API KEY")
    print("=" * 60)
    print()

    # Verificar si cryptography está disponible
    if not CRYPTOGRAPHY_AVAILABLE:
        print("⚠ WARNING: El módulo cryptography NO está disponible")
        print("           Las API keys no se encriptarán")
        print()
        print("Para instalar cryptography, ejecuta:")
        print("    pip install cryptography")
        print()
        return False

    print("✓ Módulo cryptography disponible")
    print()

    # API key de prueba
    test_api_key = "test-api-key-12345-abcde"
    print(f"API key original:  {test_api_key}")
    print()

    # Encriptar
    print("Encriptando...")
    encrypted = encrypt_api_key(test_api_key)
    print(f"API key encriptada: {encrypted[:50]}...")
    print()

    # Verificar el prefijo
    if encrypted.startswith("ENC:"):
        print("✓ La API key encriptada tiene el prefijo 'ENC:'")
    else:
        print("✗ ERROR: La API key no tiene el prefijo esperado")
        return False
    print()

    # Desencriptar
    print("Desencriptando...")
    decrypted = decrypt_api_key(encrypted)
    print(f"API key desencriptada: {decrypted}")
    print()

    # Verificar que coincidan
    if decrypted == test_api_key:
        print("✓ SUCCESS: La API key desencriptada coincide con la original")
        return True
    else:
        print("✗ ERROR: La API key desencriptada NO coincide con la original")
        print(f"   Esperado: {test_api_key}")
        print(f"   Obtenido: {decrypted}")
        return False


def test_non_encrypted_key():
    """Prueba que las API keys sin encriptar sigan funcionando"""
    print()
    print("=" * 60)
    print("  TEST DE COMPATIBILIDAD CON KEYS SIN ENCRIPTAR")
    print("=" * 60)
    print()

    plain_key = "plain-api-key-without-encryption"
    print(f"API key sin encriptar: {plain_key}")
    print()

    # Intentar desencriptar (debería retornar la misma key)
    result = decrypt_api_key(plain_key)
    print(f"Resultado: {result}")
    print()

    if result == plain_key:
        print("✓ SUCCESS: Las API keys sin encriptar siguen funcionando")
        return True
    else:
        print("✗ ERROR: La API key sin encriptar no se maneja correctamente")
        return False


def test_multiple_encryptions():
    """Prueba que múltiples encriptaciones generen diferentes resultados"""
    print()
    print("=" * 60)
    print("  TEST DE MÚLTIPLES ENCRIPTACIONES")
    print("=" * 60)
    print()

    if not CRYPTOGRAPHY_AVAILABLE:
        print("⚠ Saltando test (cryptography no disponible)")
        return True

    test_key = "test-key-123"
    print(f"API key original: {test_key}")
    print()

    # Encriptar 3 veces
    encrypted1 = encrypt_api_key(test_key)
    encrypted2 = encrypt_api_key(test_key)
    encrypted3 = encrypt_api_key(test_key)

    print(f"Encriptación 1: {encrypted1[:50]}...")
    print(f"Encriptación 2: {encrypted2[:50]}...")
    print(f"Encriptación 3: {encrypted3[:50]}...")
    print()

    # Verificar que sean diferentes (Fernet usa un nonce aleatorio)
    if encrypted1 != encrypted2 and encrypted2 != encrypted3:
        print("✓ SUCCESS: Cada encriptación genera un resultado diferente")
        print("           (esto es normal y esperado con Fernet)")
    else:
        print("ℹ INFO: Algunas encriptaciones son iguales (poco probable pero posible)")
    print()

    # Verificar que todas se desencripten correctamente
    decrypted1 = decrypt_api_key(encrypted1)
    decrypted2 = decrypt_api_key(encrypted2)
    decrypted3 = decrypt_api_key(encrypted3)

    all_correct = (
        decrypted1 == test_key
        and decrypted2 == test_key
        and decrypted3 == test_key
    )

    if all_correct:
        print("✓ SUCCESS: Todas las encriptaciones se desencriptan correctamente")
        return True
    else:
        print("✗ ERROR: Alguna desencriptación falló")
        return False


def main():
    """Ejecuta todas las pruebas"""
    print()
    print("╔════════════════════════════════════════════════════════════╗")
    print("║  USB MONITOR - PRUEBAS DE ENCRIPTACIÓN                    ║")
    print("╚════════════════════════════════════════════════════════════╝")
    print()

    results = []

    # Test 1: Encriptación básica
    results.append(("Encriptación/Desencriptación", test_encryption()))

    # Test 2: Compatibilidad con keys sin encriptar
    results.append(("Compatibilidad con keys sin encriptar", test_non_encrypted_key()))

    # Test 3: Múltiples encriptaciones
    results.append(("Múltiples encriptaciones", test_multiple_encryptions()))

    # Resumen
    print()
    print("=" * 60)
    print("  RESUMEN DE PRUEBAS")
    print("=" * 60)
    print()

    passed = sum(1 for _, result in results if result)
    total = len(results)

    for test_name, result in results:
        status = "✓ PASS" if result else "✗ FAIL"
        print(f"{status:8} | {test_name}")

    print()
    print(f"Total: {passed}/{total} pruebas pasadas")
    print()

    if passed == total:
        print("🎉 ¡Todas las pruebas pasaron exitosamente!")
        return 0
    else:
        print("⚠ Algunas pruebas fallaron. Revisa los detalles arriba.")
        return 1


if __name__ == "__main__":
    exit_code = main()
    print()
    input("Presiona Enter para salir...")
    sys.exit(exit_code)
