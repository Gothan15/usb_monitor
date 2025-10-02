"""Script de Verificación del Sistema USB Monitor

Verifica el estado de instalación y funcionamiento del sistema.

Uso:
    python check_status.py
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


def check_service_status() -> tuple[bool, str]:
    """Verifica el estado del servicio de Windows."""
    try:
        result = subprocess.run(
            ["sc", "query", "USBMonitorService"],
            capture_output=True,
            text=True,
        )
        
        if "RUNNING" in result.stdout:
            return True, "🟢 En ejecución"
        elif "STOPPED" in result.stdout:
            return True, "🟡 Detenido"
        elif "does not exist" in result.stderr or "no existe" in result.stderr:
            return False, "❌ No instalado"
        else:
            return False, "⚠️  Estado desconocido"
    except Exception as e:
        return False, f"❌ Error: {e}"


def check_agent_startup() -> tuple[bool, str]:
    """Verifica si el agente está instalado en el inicio."""
    try:
        import winreg
        key_path = r"Software\Microsoft\Windows\CurrentVersion\Run"
        key = winreg.OpenKey(
            winreg.HKEY_CURRENT_USER,
            key_path,
            0,
            winreg.KEY_READ
        )
        
        try:
            value, _ = winreg.QueryValueEx(key, "USBMonitorAgent")
            winreg.CloseKey(key)
            
            # Verificar si el script existe
            if "usb_monitor_agent.py" in value:
                script_path = value.split('"')[1] if '"' in value else value.split()[1]
                if Path(script_path).exists():
                    return True, f"🟢 Instalado: {script_path}"
                else:
                    return False, f"⚠️  Instalado pero script no existe: {script_path}"
            return True, f"🟢 Instalado: {value}"
        except FileNotFoundError:
            winreg.CloseKey(key)
            return False, "❌ No instalado en registro"
    except Exception as e:
        return False, f"❌ Error: {e}"


def check_agent_running() -> tuple[bool, str]:
    """Verifica si el agente está en ejecución."""
    try:
        result = subprocess.run(
            ["tasklist", "/FI", "IMAGENAME eq python.exe", "/FO", "CSV"],
            capture_output=True,
            text=True,
        )
        
        if "usb_monitor_agent" in result.stdout.lower():
            return True, "🟢 En ejecución"
        else:
            return False, "🟡 No está corriendo"
    except Exception as e:
        return False, f"❌ Error: {e}"


def check_log_files() -> dict:
    """Verifica la existencia de archivos de log."""
    log_files = {
        "Log del Servicio": Path("D:/Monitor_USB/usb_monitor.log"),
        "Log del Agente": Path("C:/ProgramData/USBMonitor/agent.log"),
        "Archivo de Señal": Path("C:/ProgramData/USBMonitor/browser_signal.json"),
    }
    
    results = {}
    for name, path in log_files.items():
        if path.exists():
            try:
                size = path.stat().st_size / 1024  # KB
                results[name] = (True, f"🟢 Existe ({size:.1f} KB)")
            except:
                results[name] = (True, "🟢 Existe")
        else:
            results[name] = (False, "❌ No existe")
    
    return results


def check_dependencies() -> dict:
    """Verifica las dependencias de Python instaladas."""
    dependencies = {
        "pywin32": "pywin32",
        "wmi": "wmi",
        "requests": "requests",
        "pillow": "PIL",
        "pystray": "pystray",
    }
    
    results = {}
    for name, import_name in dependencies.items():
        try:
            __import__(import_name)
            results[name] = (True, "🟢 Instalado")
        except ImportError:
            results[name] = (False, "❌ No instalado")
    
    return results


def check_environment_vars() -> dict:
    """Verifica las variables de entorno."""
    env_vars = {
        "USB_MONITOR_SERVER_HOST": "172.20.10.12 (por defecto)",
        "USB_MONITOR_SERVER_PORT": "3000 (por defecto)",
        "USB_MONITOR_API_KEY": "(Opcional)",
    }
    
    results = {}
    for var, default in env_vars.items():
        value = os.environ.get(var)
        if value:
            results[var] = (True, f"🟢 Configurado: {value}")
        else:
            results[var] = (False, f"⚪ No configurado, usando: {default}")
    
    return results


def read_recent_logs(log_path: Path, lines: int = 10) -> list:
    """Lee las últimas líneas de un archivo de log."""
    try:
        if not log_path.exists():
            return []
        
        with open(log_path, 'r', encoding='utf-8', errors='ignore') as f:
            all_lines = f.readlines()
            return all_lines[-lines:] if len(all_lines) > lines else all_lines
    except Exception:
        return []


def main():
    """Función principal."""
    print_header("VERIFICACIÓN DEL SISTEMA USB MONITOR")
    
    # 1. Estado del servicio
    print("\n📊 ESTADO DEL SERVICIO")
    print("-" * 60)
    service_ok, service_status = check_service_status()
    print(f"Servicio USBMonitorService: {service_status}")
    
    # 2. Estado del agente
    print("\n📊 ESTADO DEL AGENTE")
    print("-" * 60)
    startup_ok, startup_status = check_agent_startup()
    print(f"Instalación en inicio:       {startup_status}")
    
    running_ok, running_status = check_agent_running()
    print(f"Proceso en ejecución:        {running_status}")
    
    # 3. Archivos de log
    print("\n📂 ARCHIVOS DEL SISTEMA")
    print("-" * 60)
    log_results = check_log_files()
    for name, (exists, status) in log_results.items():
        print(f"{name:25s} {status}")
    
    # 4. Dependencias
    print("\n📦 DEPENDENCIAS DE PYTHON")
    print("-" * 60)
    dep_results = check_dependencies()
    all_deps_ok = all(ok for ok, _ in dep_results.values())
    for name, (installed, status) in dep_results.items():
        print(f"{name:15s} {status}")
    
    if not all_deps_ok:
        print("\n💡 Para instalar dependencias faltantes:")
        print("   pip install -r requirements.txt")
    
    # 5. Variables de entorno
    print("\n⚙️  VARIABLES DE ENTORNO")
    print("-" * 60)
    env_results = check_environment_vars()
    for var, (configured, status) in env_results.items():
        print(f"{var:30s} {status}")
    
    # 6. Logs recientes (opcional)
    print("\n📝 ÚLTIMAS LÍNEAS DEL LOG DEL SERVICIO")
    print("-" * 60)
    service_log = Path("D:/Monitor_USB/usb_monitor.log")
    recent_lines = read_recent_logs(service_log, 5)
    if recent_lines:
        for line in recent_lines:
            print("  " + line.rstrip())
    else:
        print("  (No hay log disponible)")
    
    print("\n📝 ÚLTIMAS LÍNEAS DEL LOG DEL AGENTE")
    print("-" * 60)
    agent_log = Path("C:/ProgramData/USBMonitor/agent.log")
    recent_lines = read_recent_logs(agent_log, 5)
    if recent_lines:
        for line in recent_lines:
            print("  " + line.rstrip())
    else:
        print("  (No hay log disponible)")
    
    # Resumen final
    print_header("RESUMEN")
    
    components_ok = 0
    components_total = 4
    
    if service_ok and "ejecución" in service_status:
        components_ok += 1
        print("✅ Servicio instalado y en ejecución")
    elif service_ok:
        print("⚠️  Servicio instalado pero detenido")
    else:
        print("❌ Servicio no instalado")
    
    if startup_ok:
        components_ok += 1
        print("✅ Agente instalado en inicio de Windows")
    else:
        print("❌ Agente no instalado en inicio")
    
    if running_ok:
        components_ok += 1
        print("✅ Agente en ejecución")
    else:
        print("⚠️  Agente no está corriendo actualmente")
    
    if all_deps_ok:
        components_ok += 1
        print("✅ Todas las dependencias instaladas")
    else:
        print("❌ Faltan algunas dependencias")
    
    print("\n" + "=" * 60)
    if components_ok == components_total:
        print("🎉 SISTEMA COMPLETAMENTE FUNCIONAL")
    elif components_ok >= 2:
        print(f"⚠️  SISTEMA PARCIALMENTE FUNCIONAL ({components_ok}/{components_total})")
    else:
        print(f"❌ SISTEMA NO FUNCIONAL ({components_ok}/{components_total})")
    print("=" * 60)
    
    # Sugerencias
    if not service_ok or not startup_ok:
        print("\n💡 Para instalar el sistema:")
        print("   python setup_complete.py")
    
    if service_ok and "etenido" in service_status:
        print("\n💡 Para iniciar el servicio:")
        print("   python usb_monitor_service.py start")
    
    if startup_ok and not running_ok:
        print("\n💡 Para iniciar el agente:")
        print("   python usb_monitor_agent.py")
    
    print("\n💡 Para ver logs en tiempo real:")
    print("   Servicio: Get-Content -Path 'D:\\Monitor_USB\\usb_monitor.log' -Wait -Tail 50")
    print("   Agente:   Get-Content -Path 'C:\\ProgramData\\USBMonitor\\agent.log' -Wait -Tail 50")
    
    print()


if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        print("\n\n⚠️  Verificación cancelada")
    except Exception as e:
        print(f"\n❌ Error inesperado: {e}")
        import traceback
        traceback.print_exc()
