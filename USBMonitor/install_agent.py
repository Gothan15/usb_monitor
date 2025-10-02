"""Instalador del USB Monitor Agent

Script para instalar/desinstalar el agente de usuario en el inicio de Windows.

Uso:
    python install_agent.py install    # Instala el agente en el inicio
    python install_agent.py uninstall  # Desinstala el agente del inicio
    python install_agent.py status     # Verifica el estado de instalación
"""
import os
import sys
import winreg
from pathlib import Path


def get_python_executable() -> str:
    """Obtiene la ruta del ejecutable de Python."""
    if getattr(sys, 'frozen', False):
        # Si está compilado con PyInstaller
        return sys.executable
    else:
        # Python normal
        return sys.executable


def get_agent_script_path() -> Path:
    """Obtiene la ruta del script del agente."""
    if getattr(sys, 'frozen', False):
        # Si está compilado
        return Path(sys.executable)
    else:
        # Script Python
        current_dir = Path(__file__).parent
        return current_dir / "usb_monitor_agent.py"


def get_startup_command() -> str:
    """Obtiene el comando completo para ejecutar el agente."""
    python_exe = get_python_executable()
    agent_script = get_agent_script_path()
    
    if getattr(sys, 'frozen', False):
        # Si está compilado, ejecutar directamente
        return f'"{agent_script}"'
    else:
        # Si es script Python
        return f'"{python_exe}" "{agent_script}"'


def install_to_startup() -> bool:
    """Instala el agente en el registro de Windows para inicio automático."""
    try:
        key_path = r"Software\Microsoft\Windows\CurrentVersion\Run"
        key = winreg.OpenKey(
            winreg.HKEY_CURRENT_USER,
            key_path,
            0,
            winreg.KEY_SET_VALUE
        )
        
        command = get_startup_command()
        winreg.SetValueEx(
            key,
            "USBMonitorAgent",
            0,
            winreg.REG_SZ,
            command
        )
        
        winreg.CloseKey(key)
        
        print("✓ Agente instalado exitosamente en el inicio de Windows")
        print(f"  Comando: {command}")
        print("\nEl agente se iniciará automáticamente al iniciar sesión en Windows.")
        print("Para iniciarlo ahora sin reiniciar, ejecute:")
        print(f"  python {get_agent_script_path()}")
        
        return True
        
    except PermissionError:
        print("✗ Error: No se tienen permisos suficientes")
        print("  Intente ejecutar como administrador")
        return False
    except Exception as e:
        print(f"✗ Error al instalar: {e}")
        return False


def uninstall_from_startup() -> bool:
    """Desinstala el agente del registro de Windows."""
    try:
        key_path = r"Software\Microsoft\Windows\CurrentVersion\Run"
        key = winreg.OpenKey(
            winreg.HKEY_CURRENT_USER,
            key_path,
            0,
            winreg.KEY_SET_VALUE
        )
        
        try:
            winreg.DeleteValue(key, "USBMonitorAgent")
            print("✓ Agente desinstalado exitosamente del inicio de Windows")
        except FileNotFoundError:
            print("⚠ El agente no estaba instalado en el inicio")
        
        winreg.CloseKey(key)
        return True
        
    except PermissionError:
        print("✗ Error: No se tienen permisos suficientes")
        print("  Intente ejecutar como administrador")
        return False
    except Exception as e:
        print(f"✗ Error al desinstalar: {e}")
        return False


def check_installation_status() -> None:
    """Verifica si el agente está instalado en el inicio."""
    try:
        key_path = r"Software\Microsoft\Windows\CurrentVersion\Run"
        key = winreg.OpenKey(
            winreg.HKEY_CURRENT_USER,
            key_path,
            0,
            winreg.KEY_READ
        )
        
        try:
            value, _ = winreg.QueryValueEx(key, "USBMonitorAgent")
            print("✓ Estado: INSTALADO")
            print(f"  Comando: {value}")
            
            agent_script = get_agent_script_path()
            if agent_script.exists():
                print(f"  Script: {agent_script} (existe)")
            else:
                print(f"  Script: {agent_script} (NO EXISTE)")
                print("  ⚠ ADVERTENCIA: El script no existe, la instalación no funcionará")
            
        except FileNotFoundError:
            print("✗ Estado: NO INSTALADO")
            print(f"  Script disponible: {get_agent_script_path()}")
        
        winreg.CloseKey(key)
        
    except Exception as e:
        print(f"✗ Error al verificar estado: {e}")


def install_startup_folder() -> bool:
    """Método alternativo: instalar usando la carpeta de inicio."""
    try:
        startup_folder = Path(os.environ["APPDATA"]) / "Microsoft" / "Windows" / "Start Menu" / "Programs" / "Startup"
        startup_folder.mkdir(parents=True, exist_ok=True)
        
        shortcut_path = startup_folder / "USBMonitorAgent.bat"
        command = get_startup_command()
        
        # Crear archivo .bat
        bat_content = f'@echo off\nstart "" {command}\n'
        
        with open(shortcut_path, "w") as f:
            f.write(bat_content)
        
        print("✓ Agente instalado exitosamente en la carpeta de inicio")
        print(f"  Ubicación: {shortcut_path}")
        print(f"  Comando: {command}")
        
        return True
        
    except Exception as e:
        print(f"✗ Error al instalar en carpeta de inicio: {e}")
        return False


def uninstall_startup_folder() -> bool:
    """Método alternativo: desinstalar de la carpeta de inicio."""
    try:
        startup_folder = Path(os.environ["APPDATA"]) / "Microsoft" / "Windows" / "Start Menu" / "Programs" / "Startup"
        shortcut_path = startup_folder / "USBMonitorAgent.bat"
        
        if shortcut_path.exists():
            shortcut_path.unlink()
            print("✓ Agente desinstalado de la carpeta de inicio")
        else:
            print("⚠ El agente no estaba instalado en la carpeta de inicio")
        
        return True
        
    except Exception as e:
        print(f"✗ Error al desinstalar de carpeta de inicio: {e}")
        return False


def print_help() -> None:
    """Muestra la ayuda del instalador."""
    print(__doc__)
    print("\nComandos disponibles:")
    print("  install       Instala el agente en el inicio de Windows (registro)")
    print("  install-alt   Instala el agente en la carpeta de inicio (alternativo)")
    print("  uninstall     Desinstala el agente del inicio")
    print("  status        Verifica el estado de instalación")
    print("  help          Muestra esta ayuda")


def main():
    """Función principal."""
    if len(sys.argv) < 2:
        print_help()
        return
    
    command = sys.argv[1].lower()
    
    print("=" * 60)
    print("USB Monitor Agent - Instalador")
    print("=" * 60)
    print()
    
    if command == "install":
        install_to_startup()
    elif command == "install-alt":
        install_startup_folder()
    elif command == "uninstall":
        # Intentar desinstalar de ambos métodos
        uninstall_from_startup()
        uninstall_startup_folder()
    elif command == "status":
        check_installation_status()
    elif command == "help":
        print_help()
    else:
        print(f"✗ Comando desconocido: {command}")
        print()
        print_help()


if __name__ == "__main__":
    main()
