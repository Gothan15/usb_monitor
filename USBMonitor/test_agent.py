"""Script de prueba para el USB Monitor Agent

Simula la creación de una señal del servicio para probar
el agente sin necesidad de conectar un USB real.

Uso:
    python test_agent.py
"""
import json
import time
from pathlib import Path


SIGNAL_FILE = Path("C:/ProgramData/USBMonitor/browser_signal.json")


def create_test_signal():
    """Crea una señal de prueba."""
    print("🧪 Creando señal de prueba...")
    
    # Asegurar que el directorio existe
    SIGNAL_FILE.parent.mkdir(parents=True, exist_ok=True)
    
    # Crear señal de prueba con timestamp único
    signal_data = {
        "timestamp": time.strftime("%Y-%m-%dT%H:%M:%S"),
        "url": "http://172.20.10.12:3000/login?pcName=TEST_PC",
        "pc_name": "TEST_PC",
        "drive_letter": "E:",
        "processed": False
    }
    
    # Escribir de forma atómica
    temp_file = SIGNAL_FILE.with_suffix('.tmp')
    with open(temp_file, 'w', encoding='utf-8') as f:
        json.dump(signal_data, f, indent=2)
    
    # Renombrar para evitar lecturas parciales
    if SIGNAL_FILE.exists():
        SIGNAL_FILE.unlink()
    temp_file.rename(SIGNAL_FILE)
    
    print(f"✅ Señal creada en: {SIGNAL_FILE}")
    print(f"\n📄 Contenido:")
    print(json.dumps(signal_data, indent=2))
    print("\n💡 Si el agente está en ejecución, debería mostrar")
    print("   la ventana de login en unos segundos...")
    print(f"\n⏱️  Timestamp: {signal_data['timestamp']}")
    print(f"🖥️  PC: {signal_data['pc_name']}")
    print(f"💾 Unidad: {signal_data['drive_letter']}")


def check_signal_status():
    """Verifica el estado de la señal."""
    if SIGNAL_FILE.exists():
        with open(SIGNAL_FILE, 'r', encoding='utf-8') as f:
            data = json.load(f)
        
        if data.get("processed"):
            print("\n✅ La señal fue procesada por el agente")
        else:
            print("\n⏳ La señal aún no ha sido procesada")
        
        print(f"\n📄 Estado actual:")
        print(json.dumps(data, indent=2))
    else:
        print("\n❌ No existe archivo de señal")


def clear_signal():
    """Elimina el archivo de señal."""
    if SIGNAL_FILE.exists():
        SIGNAL_FILE.unlink()
        print(f"🗑️  Señal eliminada: {SIGNAL_FILE}")
    else:
        print("ℹ️  No hay señal para eliminar")


def main():
    """Función principal."""
    print("=" * 60)
    print("USB Monitor Agent - Prueba de Señales")
    print("=" * 60)
    print()
    
    print("Opciones:")
    print("  1. Crear señal de prueba")
    print("  2. Verificar estado de señal")
    print("  3. Eliminar señal")
    print("  4. Crear señal y monitorear")
    print("  0. Salir")
    print()
    
    while True:
        try:
            choice = input("Seleccione una opción: ").strip()
            
            if choice == "1":
                create_test_signal()
                print("\n⏳ Esperando 5 segundos para verificar...")
                time.sleep(5)
                check_signal_status()
            elif choice == "2":
                check_signal_status()
            elif choice == "3":
                clear_signal()
            elif choice == "4":
                print("\n📡 Creando señal y monitoreando por 30 segundos...")
                create_test_signal()
                for i in range(6):
                    time.sleep(5)
                    print(f"\n⏱️  Verificando ({(i+1)*5}s)...")
                    check_signal_status()
                    if SIGNAL_FILE.exists():
                        with open(SIGNAL_FILE, 'r', encoding='utf-8') as f:
                            data = json.load(f)
                        if data.get("processed"):
                            print("\n✅ ¡Señal procesada exitosamente!")
                            break
                else:
                    print("\n⚠️  Señal no fue procesada después de 30 segundos")
                    print("   Verifique que el agente esté corriendo")
            elif choice == "0":
                print("\n👋 Hasta luego!")
                break
            else:
                print("❌ Opción inválida")
            
            print("\n" + "-" * 60)
            
        except KeyboardInterrupt:
            print("\n\n👋 Hasta luego!")
            break
        except Exception as e:
            print(f"\n❌ Error: {e}")


if __name__ == "__main__":
    main()
