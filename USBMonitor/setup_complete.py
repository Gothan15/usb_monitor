"""Instalador/Desinstalador Completo del Sistema USB Monitor

Script interactivo para instalar, desinstalar y configurar el sistema USB Monitor.

INSTALACIÓN:
1. Verifica dependencias de Python
2. Instala las dependencias necesarias
3. Configura variables de entorno
4. Instala el servicio de Windows
5. Instala el agente de usuario
6. Inicia los componentes

DESINSTALACIÓN:
1. Detiene procesos del agente en ejecución
2. Detiene el servicio de Windows
3. Desinstala el servicio de Windows
4. Desinstala el agente del inicio de Windows
5. (Opcional) Elimina archivos de log y configuración

Uso:
    python setup_complete.py                 # Instalar el sistema
    python setup_complete.py --uninstall     # Desinstalar (mantener logs)
    python setup_complete.py --full-remove   # Desinstalar (eliminar todo)
    python setup_complete.py --help          # Mostrar ayuda

Ejemplos:
    # Instalación completa
    python setup_complete.py

    # Desinstalación manteniendo logs para diagnóstico
    python setup_complete.py --uninstall

    # Desinstalación completa incluyendo todos los archivos
    python setup_complete.py --full-remove

Requisitos:
    - Windows 7 o superior
    - Python 3.7 o superior
    - Permisos de administrador (recomendado)
"""
import os
import subprocess
import sys
from pathlib import Path


def print_header(text: str) -> None:
    """Imprime un encabezado formateado."""
    print("\n" + "=" * 60)
    print(text.center(60))
    print("=" * 60)


def print_step(step: int, total: int, text: str) -> None:
    """Imprime un paso del proceso."""
    print(f"\n[{step}/{total}] {text}")
    print("-" * 60)


def run_command(cmd: list, description: str) -> bool:
    """Ejecuta un comando y maneja errores."""
    print(f"  Ejecutando: {' '.join(cmd)}")
    try:
        result = subprocess.run(
            cmd,
            check=True,
            capture_output=True,
            text=True,
        )
        print(f"  ✅ {description} - Éxito")
        return True
    except subprocess.CalledProcessError as e:
        print(f"  ❌ {description} - Error")
        print(f"     {e.stderr}")
        return False
    except FileNotFoundError:
        print(f"  ❌ {description} - Comando no encontrado")
        return False


def check_admin() -> bool:
    """Verifica si el script se ejecuta como administrador."""
    try:
        import ctypes
        return ctypes.windll.shell32.IsUserAnAdmin() != 0
    except:
        return False


def check_python_version() -> bool:
    """Verifica la versión de Python."""
    version = sys.version_info
    if version.major >= 3 and version.minor >= 7:
        print(f"  ✅ Python {version.major}.{version.minor}.{version.micro}")
        return True
    else:
        print(f"  ❌ Python {version.major}.{version.minor}.{version.micro}")
        print("     Se requiere Python 3.7 o superior")
        return False


def install_dependencies() -> bool:
    """Instala las dependencias de Python."""
    requirements_file = Path(__file__).parent / "requirements.txt"
    
    if not requirements_file.exists():
        print("  ⚠️  Archivo requirements.txt no encontrado")
        print("     Instalando dependencias manualmente...")
        
        packages = [
            "pywin32",
            "wmi",
            "requests",
            "pillow",
            "pystray",
        ]
        
        for package in packages:
            if not run_command(
                [sys.executable, "-m", "pip", "install", package],
                f"Instalando {package}"
            ):
                return False
        return True
    else:
        return run_command(
            [sys.executable, "-m", "pip", "install", "-r", str(requirements_file)],
            "Instalando dependencias desde requirements.txt"
        )


def install_service() -> bool:
    """Instala el servicio de Windows."""
    service_script = Path(__file__).parent / "usb_monitor_service.py"
    
    if not service_script.exists():
        print("  ❌ usb_monitor_service.py no encontrado")
        return False
    
    return run_command(
        [sys.executable, str(service_script), "install"],
        "Instalando servicio de Windows"
    )


def start_service() -> bool:
    """Inicia el servicio de Windows."""
    service_script = Path(__file__).parent / "usb_monitor_service.py"
    
    return run_command(
        [sys.executable, str(service_script), "start"],
        "Iniciando servicio de Windows"
    )


def install_agent() -> bool:
    """Instala el agente de usuario."""
    install_script = Path(__file__).parent / "install_agent.py"
    
    if not install_script.exists():
        print("  ❌ install_agent.py no encontrado")
        return False
    
    return run_command(
        [sys.executable, str(install_script), "install"],
        "Instalando agente de usuario"
    )


def start_agent() -> bool:
    """Inicia el agente de usuario."""
    agent_script = Path(__file__).parent / "usb_monitor_agent.py"
    
    if not agent_script.exists():
        print("  ❌ usb_monitor_agent.py no encontrado")
        return False
    
    print("  Iniciando agente en segundo plano...")
    try:
        # Iniciar en proceso separado
        subprocess.Popen(
            [sys.executable, str(agent_script)],
            creationflags=subprocess.CREATE_NEW_CONSOLE | subprocess.CREATE_NO_WINDOW,
        )
        print("  ✅ Agente iniciado")
        return True
    except Exception as e:
        print(f"  ❌ Error al iniciar agente: {e}")
        return False


def configure_environment() -> None:
    """Guía al usuario en la configuración de variables de entorno."""
    print("\n  Variables de entorno opcionales:")
    print("  - USB_MONITOR_SERVER_HOST (por defecto: 172.20.10.12)")
    print("  - USB_MONITOR_SERVER_PORT (por defecto: 3000)")
    print("  - USB_MONITOR_API_KEY (opcional)")
    print()
    
    response = input("  ¿Desea configurar variables de entorno ahora? (s/n): ").strip().lower()
    
    if response in ["s", "si", "y", "yes"]:
        host = input("  Host del servidor [172.20.10.12]: ").strip()
        if host:
            os.environ["USB_MONITOR_SERVER_HOST"] = host
            print(f"    USB_MONITOR_SERVER_HOST = {host}")
        
        port = input("  Puerto del servidor [3000]: ").strip()
        if port:
            os.environ["USB_MONITOR_SERVER_PORT"] = port
            print(f"    USB_MONITOR_SERVER_PORT = {port}")
        
        api_key = input("  API Key (opcional): ").strip()
        if api_key:
            os.environ["USB_MONITOR_API_KEY"] = api_key
            print(f"    USB_MONITOR_API_KEY = [configurada]")
        
        print("\n  ⚠️  Nota: Estas variables solo son temporales.")
        print("     Para hacerlas permanentes, configúrelas en:")
        print("     Panel de Control > Sistema > Configuración avanzada del sistema")
        print("     > Variables de entorno")


def show_summary() -> None:
    """Muestra un resumen de la instalación."""
    print_header("RESUMEN DE INSTALACIÓN")
    
    print("\n✅ Instalación completada exitosamente!")
    print("\n📋 Componentes instalados:")
    print("   1. Servicio USB Monitor (iniciado)")
    print("   2. Agente de usuario (iniciado)")
    print("\n📁 Ubicación de archivos:")
    print("   - Log servicio: D:\\Monitor_USB\\usb_monitor.log")
    print("   - Log agente: C:\\ProgramData\\USBMonitor\\agent.log")
    print("   - Señales: C:\\ProgramData\\USBMonitor\\browser_signal.json")
    print("\n🔍 Verificar estado:")
    print("   - Servicio: sc query USBMonitorService")
    print("   - Agente: buscar icono en bandeja del sistema")
    print("\n🧪 Probar sistema:")
    print("   1. Conectar una memoria USB")
    print("   2. El servicio la bloqueará automáticamente")
    print("   3. El agente mostrará la ventana de login")
    print("   4. Introducir credenciales para desbloquear")
    print("\n📚 Documentación:")
    print("   - README.md (sistema completo)")
    print("   - README_AGENT.md (agente de usuario)")
    print("\n💡 Comandos útiles:")
    print("   - Detener servicio: python usb_monitor_service.py stop")
    print("   - Ver logs: notepad D:\\Monitor_USB\\usb_monitor.log")
    print("   - Desinstalar: python setup_complete.py --uninstall")


def stop_agent_processes() -> bool:
    """Intenta detener procesos del agente en ejecución."""
    try:
        import subprocess
        # Buscar procesos de Python ejecutando el agente
        result = subprocess.run(
            ["tasklist", "/FI", "IMAGENAME eq python.exe", "/FO", "CSV"],
            capture_output=True,
            text=True,
        )
        
        if "usb_monitor_agent.py" in result.stdout:
            print("  Detectado agente en ejecución, intentando detener...")
            # Intentar cerrar gracefully mediante el archivo de señal
            signal_file = Path("C:/ProgramData/USBMonitor/stop_agent.signal")
            signal_file.parent.mkdir(parents=True, exist_ok=True)
            signal_file.touch()
            
            import time
            time.sleep(3)  # Dar tiempo para que el agente se cierre
            
            # Si aún está corriendo, forzar cierre
            subprocess.run(
                ["taskkill", "/F", "/FI", "WINDOWTITLE eq *usb_monitor_agent*"],
                capture_output=True,
            )
            print("  ✅ Procesos del agente detenidos")
        
        return True
    except Exception as e:
        print(f"  ⚠️  No se pudieron detener procesos del agente: {e}")
        return False


def clean_log_files() -> bool:
    """Elimina los archivos de log del sistema."""
    try:
        log_files = [
            Path("D:/Monitor_USB/usb_monitor.log"),
            Path("C:/ProgramData/USBMonitor/agent.log"),
            Path("C:/ProgramData/USBMonitor/browser_signal.json"),
            Path("C:/ProgramData/USBMonitor/stop_agent.signal"),
        ]
        
        deleted = 0
        for log_file in log_files:
            if log_file.exists():
                try:
                    log_file.unlink()
                    deleted += 1
                    print(f"  🗑️  Eliminado: {log_file}")
                except Exception as e:
                    print(f"  ⚠️  No se pudo eliminar {log_file}: {e}")
        
        # Intentar eliminar directorios vacíos
        try:
            log_dir = Path("C:/ProgramData/USBMonitor")
            if log_dir.exists() and not any(log_dir.iterdir()):
                log_dir.rmdir()
                print(f"  🗑️  Directorio eliminado: {log_dir}")
        except:
            pass
        
        try:
            monitor_dir = Path("D:/Monitor_USB")
            if monitor_dir.exists() and not any(monitor_dir.iterdir()):
                monitor_dir.rmdir()
                print(f"  🗑️  Directorio eliminado: {monitor_dir}")
        except:
            pass
        
        if deleted > 0:
            print(f"  ✅ {deleted} archivo(s) de log eliminados")
            return True
        else:
            print("  ℹ️  No se encontraron archivos de log para eliminar")
            return True
            
    except Exception as e:
        print(f"  ❌ Error al limpiar archivos de log: {e}")
        return False


def uninstall_all(keep_logs: bool = False) -> None:
    """Desinstala todo el sistema."""
    print_header("DESINSTALACIÓN DEL SISTEMA USB MONITOR")
    
    print("\n📋 Este proceso realizará las siguientes acciones:")
    print("   1. Detener procesos del agente en ejecución")
    print("   2. Detener el servicio de Windows")
    print("   3. Desinstalar el servicio de Windows")
    print("   4. Desinstalar el agente del inicio de Windows")
    if not keep_logs:
        print("   5. Eliminar archivos de log y configuración")
    else:
        print("   5. Mantener archivos de log (opción seleccionada)")
    
    response = input("\n⚠️  ¿Está seguro que desea continuar? (s/n): ").strip().lower()
    
    if response not in ["s", "si", "y", "yes"]:
        print("\n❌ Desinstalación cancelada")
        return
    
    success_count = 0
    total_steps = 5 if not keep_logs else 4
    
    # Paso 1: Detener procesos del agente
    print_step(1, total_steps, "Deteniendo procesos del agente")
    if stop_agent_processes():
        success_count += 1
    
    # Paso 2: Detener servicio
    print_step(2, total_steps, "Deteniendo servicio de Windows")
    service_script = Path(__file__).parent / "usb_monitor_service.py"
    if service_script.exists():
        if run_command(
            [sys.executable, str(service_script), "stop"],
            "Deteniendo servicio USBMonitorService"
        ):
            success_count += 1
    else:
        print("  ⚠️  Script del servicio no encontrado, omitiendo...")
    
    # Paso 3: Desinstalar servicio
    print_step(3, total_steps, "Desinstalando servicio de Windows")
    if service_script.exists():
        if run_command(
            [sys.executable, str(service_script), "remove"],
            "Desinstalando servicio USBMonitorService"
        ):
            success_count += 1
    else:
        print("  ⚠️  Script del servicio no encontrado, omitiendo...")
    
    # Paso 4: Desinstalar agente
    print_step(4, total_steps, "Desinstalando agente del inicio de Windows")
    install_script = Path(__file__).parent / "install_agent.py"
    if install_script.exists():
        if run_command(
            [sys.executable, str(install_script), "uninstall"],
            "Desinstalando agente de usuario"
        ):
            success_count += 1
    else:
        print("  ⚠️  Script del instalador no encontrado, omitiendo...")
    
    # Paso 5: Limpiar archivos de log (opcional)
    if not keep_logs:
        print_step(5, total_steps, "Eliminando archivos de log y configuración")
        if clean_log_files():
            success_count += 1
    
    # Resumen
    print("\n" + "=" * 60)
    if success_count == total_steps:
        print("✅ DESINSTALACIÓN COMPLETADA EXITOSAMENTE")
    elif success_count > 0:
        print(f"⚠️  DESINSTALACIÓN PARCIAL ({success_count}/{total_steps} pasos completados)")
    else:
        print("❌ DESINSTALACIÓN FALLIDA")
    
    print("=" * 60)
    
    if keep_logs:
        print("\n📝 Archivos de log conservados en:")
        print("   - D:\\Monitor_USB\\usb_monitor.log")
        print("   - C:\\ProgramData\\USBMonitor\\agent.log")
    else:
        print("\n🗑️  Todos los archivos del sistema han sido eliminados")
    
    print("\n💡 Para reinstalar el sistema, ejecute:")
    print("   python setup_complete.py")
    
    print("\n✅ Puede cerrar esta ventana")


def print_usage() -> None:
    """Imprime la ayuda de uso del script."""
    print(__doc__)
    print("\nUSO:")
    print("  python setup_complete.py                 # Instalar el sistema")
    print("  python setup_complete.py --uninstall     # Desinstalar (mantener logs)")
    print("  python setup_complete.py --full-remove   # Desinstalar (eliminar todo)")
    print("  python setup_complete.py --help          # Mostrar esta ayuda")
    print("\nOPCIONES:")
    print("  --uninstall      Desinstala el sistema pero mantiene archivos de log")
    print("  --full-remove    Desinstala el sistema y elimina todos los archivos")
    print("  --help, -h       Muestra esta ayuda")
    print("\nEJEMPLOS:")
    print("  # Instalación normal")
    print("  python setup_complete.py")
    print()
    print("  # Desinstalación manteniendo logs para diagnóstico")
    print("  python setup_complete.py --uninstall")
    print()
    print("  # Desinstalación completa incluyendo logs")
    print("  python setup_complete.py --full-remove")


def main():
    """Función principal."""
    # Procesar argumentos de línea de comandos
    if len(sys.argv) > 1:
        arg = sys.argv[1].lower()
        
        if arg in ["--help", "-h", "help"]:
            print_usage()
            return
        elif arg == "--uninstall":
            uninstall_all(keep_logs=True)
            return
        elif arg == "--full-remove":
            uninstall_all(keep_logs=False)
            return
        else:
            print(f"❌ Argumento desconocido: {sys.argv[1]}")
            print("\nUse --help para ver las opciones disponibles")
            return
    
    print_header("INSTALADOR USB MONITOR")
    print("\n🚀 Este script instalará y configurará el sistema completo")
    print("   de monitoreo USB con autenticación de usuarios.")
    
    # Verificar permisos de administrador
    if not check_admin():
        print("\n⚠️  ADVERTENCIA: No se detectaron permisos de administrador")
        print("   Algunas operaciones pueden fallar.")
        response = input("\n¿Desea continuar de todas formas? (s/n): ").strip().lower()
        if response not in ["s", "si", "y", "yes"]:
            print("Instalación cancelada")
            return
    
    # Paso 1: Verificar Python
    print_step(1, 6, "Verificando versión de Python")
    if not check_python_version():
        print("\n❌ Instalación abortada: versión de Python incompatible")
        return
    
    # Paso 2: Instalar dependencias
    print_step(2, 6, "Instalando dependencias de Python")
    if not install_dependencies():
        print("\n❌ Instalación abortada: error al instalar dependencias")
        return
    
    # Paso 3: Configurar entorno
    print_step(3, 6, "Configurando variables de entorno")
    configure_environment()
    
    # Paso 4: Instalar servicio
    print_step(4, 6, "Instalando servicio de Windows")
    if not install_service():
        print("\n⚠️  Error al instalar el servicio")
        response = input("¿Desea continuar con la instalación del agente? (s/n): ").strip().lower()
        if response not in ["s", "si", "y", "yes"]:
            return
    else:
        # Iniciar servicio
        print("\n  Iniciando servicio...")
        start_service()
    
    # Paso 5: Instalar agente
    print_step(5, 6, "Instalando agente de usuario")
    if not install_agent():
        print("\n⚠️  Error al instalar el agente")
    
    # Paso 6: Iniciar agente
    print_step(6, 6, "Iniciando agente de usuario")
    start_agent()
    
    # Resumen
    show_summary()
    
    print("\n" + "=" * 60)
    input("\nPresione Enter para salir...")


if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        print("\n\n⚠️  Instalación cancelada por el usuario")
    except Exception as e:
        print(f"\n❌ Error inesperado: {e}")
        import traceback
        traceback.print_exc()
