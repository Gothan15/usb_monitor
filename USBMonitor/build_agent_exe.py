"""Script para compilar el agente a un ejecutable .exe

Este script usa PyInstaller para crear un ejecutable standalone
del USB Monitor Agent que no requiere Python instalado.

Requisitos:
    pip install pyinstaller

Uso:
    python build_agent_exe.py
"""
import os
import subprocess
import sys
from pathlib import Path


def check_pyinstaller():
    """Verifica si PyInstaller está instalado."""
    try:
        import PyInstaller
        return True
    except ImportError:
        print("❌ PyInstaller no está instalado")
        print("\nInstalar con:")
        print("  pip install pyinstaller")
        return False


def build_executable():
    """Compila el agente a un ejecutable."""
    print("=" * 60)
    print("USB Monitor Agent - Compilador")
    print("=" * 60)
    print()
    
    if not check_pyinstaller():
        return False
    
    script_path = Path(__file__).parent / "usb_monitor_agent.py"
    
    if not script_path.exists():
        print(f"❌ No se encuentra el script: {script_path}")
        return False
    
    print(f"📄 Script: {script_path}")
    print("\n🔨 Compilando...")
    
    # Comando de PyInstaller
    cmd = [
        "pyinstaller",
        "--onefile",                    # Un solo archivo .exe
        "--windowed",                   # Sin consola
        "--name=USBMonitorAgent",       # Nombre del ejecutable
        "--icon=NONE",                  # Sin icono personalizado
        "--clean",                      # Limpiar archivos temporales
        str(script_path),
    ]
    
    try:
        result = subprocess.run(cmd, check=True, capture_output=True, text=True)
        
        exe_path = Path("dist") / "USBMonitorAgent.exe"
        
        if exe_path.exists():
            print(f"\n✅ Ejecutable creado exitosamente:")
            print(f"   {exe_path.absolute()}")
            print(f"\n📦 Tamaño: {exe_path.stat().st_size / 1024 / 1024:.2f} MB")
            print("\n📝 Para instalar el agente:")
            print("   1. Copiar el .exe a una ubicación permanente")
            print("   2. Ejecutar el instalador con la ruta del .exe")
            print("\n💡 Nota: El instalador detect automáticamente ejecutables")
            return True
        else:
            print("\n❌ El ejecutable no se creó correctamente")
            return False
            
    except subprocess.CalledProcessError as e:
        print(f"\n❌ Error al compilar:")
        print(e.stderr)
        return False
    except Exception as e:
        print(f"\n❌ Error inesperado: {e}")
        return False


def clean_build_files():
    """Limpia archivos de compilación."""
    import shutil
    
    dirs_to_clean = ["build", "__pycache__"]
    files_to_clean = ["*.spec"]
    
    print("\n🧹 Limpiando archivos temporales...")
    
    for dir_name in dirs_to_clean:
        dir_path = Path(dir_name)
        if dir_path.exists():
            shutil.rmtree(dir_path)
            print(f"   Eliminado: {dir_name}/")
    
    for pattern in files_to_clean:
        for file_path in Path(".").glob(pattern):
            file_path.unlink()
            print(f"   Eliminado: {file_path}")
    
    print("✅ Limpieza completada")


def main():
    """Función principal."""
    success = build_executable()
    
    if success:
        print("\n¿Desea limpiar los archivos temporales? (s/n): ", end="")
        try:
            response = input().strip().lower()
            if response in ["s", "si", "y", "yes"]:
                clean_build_files()
        except KeyboardInterrupt:
            print("\nCancelado")
    
    print("\n" + "=" * 60)


if __name__ == "__main__":
    main()
