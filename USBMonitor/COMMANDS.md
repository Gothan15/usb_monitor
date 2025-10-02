# 🎯 Guía de Comandos - USB Monitor

Referencia rápida de todos los comandos disponibles.

---

## 🚀 INSTALACIÓN

### Instalación Completa (Recomendada)

```powershell
python setup_complete.py
```

Instala servicio + agente + dependencias + configuración

### Instalación Manual

```powershell
# 1. Dependencias
pip install -r requirements.txt

# 2. Servicio
python usb_monitor_service.py install
python usb_monitor_service.py start

# 3. Agente
python install_agent.py install
python usb_monitor_agent.py
```

---

## 🗑️ DESINSTALACIÓN

### Desinstalación Completa (Recomendada)

```powershell
# Mantener logs
python setup_complete.py --uninstall

# Eliminar TODO
python setup_complete.py --full-remove
```

### Desinstalación Manual

```powershell
# 1. Detener
python usb_monitor_service.py stop

# 2. Desinstalar
python usb_monitor_service.py remove
python install_agent.py uninstall

# 3. Limpiar (opcional)
Remove-Item -Path "D:\Monitor_USB" -Recurse -Force
Remove-Item -Path "C:\ProgramData\USBMonitor" -Recurse -Force
```

---

## ⚙️ GESTIÓN DEL SERVICIO

```powershell
# Instalar
python usb_monitor_service.py install

# Iniciar
python usb_monitor_service.py start

# Detener
python usb_monitor_service.py stop

# Reiniciar
python usb_monitor_service.py restart

# Desinstalar
python usb_monitor_service.py remove

# Debug (modo consola)
python usb_monitor_service.py debug

# Ver estado
sc query USBMonitorService
```

---

## 👤 GESTIÓN DEL AGENTE

```powershell
# Instalar en inicio
python install_agent.py install

# Instalar (método alternativo)
python install_agent.py install-alt

# Ver estado
python install_agent.py status

# Desinstalar
python install_agent.py uninstall

# Ejecutar manualmente
python usb_monitor_agent.py
```

---

## 🔍 VERIFICACIÓN Y DIAGNÓSTICO

```powershell
# Verificar estado completo
python check_status.py

# Ver logs en tiempo real
Get-Content -Path "D:\Monitor_USB\usb_monitor.log" -Wait -Tail 50
Get-Content -Path "C:\ProgramData\USBMonitor\agent.log" -Wait -Tail 50

# Ver archivo de señal
Get-Content "C:\ProgramData\USBMonitor\browser_signal.json" | ConvertFrom-Json

# Ver últimas líneas del log
Get-Content -Path "D:\Monitor_USB\usb_monitor.log" -Tail 20

# Buscar errores en logs
Select-String -Path "D:\Monitor_USB\usb_monitor.log" -Pattern "ERROR"
Select-String -Path "C:\ProgramData\USBMonitor\agent.log" -Pattern "ERROR"
```

---

## 🧪 PRUEBAS

```powershell
# Probar agente con señal simulada
python test_agent.py

# Ejecutar servicio en modo debug
python usb_monitor_service.py debug

# Ejecutar agente en modo debug
python usb_monitor_agent.py
```

---

## 🔧 CONFIGURACIÓN

### Variables de Entorno

```powershell
# Temporal (sesión actual)
$env:USB_MONITOR_SERVER_HOST = "192.168.1.100"
$env:USB_MONITOR_SERVER_PORT = "8080"
$env:USB_MONITOR_API_KEY = "mi-api-key"

# Permanente (Sistema)
[System.Environment]::SetEnvironmentVariable("USB_MONITOR_SERVER_HOST", "192.168.1.100", "Machine")
[System.Environment]::SetEnvironmentVariable("USB_MONITOR_SERVER_PORT", "8080", "Machine")

# Permanente (Usuario)
[System.Environment]::SetEnvironmentVariable("USB_MONITOR_SERVER_HOST", "192.168.1.100", "User")
[System.Environment]::SetEnvironmentVariable("USB_MONITOR_SERVER_PORT", "8080", "User")

# Ver variables actuales
Get-ChildItem Env: | Where-Object { $_.Name -like "USB_MONITOR*" }
```

---

## 🏗️ DESARROLLO

### Compilar Agente a .EXE

```powershell
# Instalar PyInstaller
pip install pyinstaller

# Compilar
python build_agent_exe.py

# El ejecutable estará en:
# dist/USBMonitorAgent.exe
```

### Modificar y Reiniciar

```powershell
# Editar archivo
notepad usb_monitor_service.py

# Reiniciar servicio
python usb_monitor_service.py stop
python usb_monitor_service.py start

# O reinstalar si hay cambios importantes
python usb_monitor_service.py remove
python usb_monitor_service.py install
python usb_monitor_service.py start
```

---

## 🔐 COMANDOS ADMINISTRATIVOS

```powershell
# Ejecutar PowerShell como Administrador
Start-Process powershell -Verb RunAs

# Verificar permisos
whoami /groups | findstr "Administrator"

# Ver servicios de Windows
Get-Service | Where-Object { $_.Name -like "*USB*" }

# Ver procesos Python
Get-Process | Where-Object { $_.ProcessName -eq "python" }

# Matar proceso del agente
Stop-Process -Name python -Force

# Verificar puerto en uso
netstat -ano | findstr :3000
```

---

## 📊 MONITOREO

### Ver Unidades USB Conectadas

```powershell
Get-Volume | Where-Object { $_.DriveType -eq 'Removable' }
Get-Disk | Where-Object { $_.BusType -eq 'USB' }
```

### Ver Eventos del Sistema

```powershell
Get-EventLog -LogName System -Source "Service Control Manager" -Newest 20 | Where-Object { $_.Message -like "*USB*" }
```

### Ver Uso de diskpart

```powershell
diskpart
# En diskpart:
list volume
list disk
exit
```

---

## 🆘 SOLUCIÓN DE PROBLEMAS

### El servicio no inicia

```powershell
# Ver logs del servicio
Get-Content "D:\Monitor_USB\usb_monitor.log" -Tail 50

# Ver eventos de Windows
Get-EventLog -LogName Application -Source "USBMonitorService" -Newest 20

# Reinstalar
python usb_monitor_service.py remove
python usb_monitor_service.py install
python usb_monitor_service.py start
```

### El agente no muestra ventana

```powershell
# Verificar que está corriendo
python check_status.py

# Ver logs
Get-Content "C:\ProgramData\USBMonitor\agent.log" -Tail 50

# Probar manualmente
python test_agent.py
```

### No se puede conectar al servidor

```powershell
# Probar conexión
Test-NetConnection -ComputerName 172.20.10.12 -Port 3000

# O con curl
curl http://172.20.10.12:3000/api/health

# Verificar variables
echo $env:USB_MONITOR_SERVER_HOST
echo $env:USB_MONITOR_SERVER_PORT
```

### USB no se desbloquea

```powershell
# Verificar logs del servicio
Select-String -Path "D:\Monitor_USB\usb_monitor.log" -Pattern "desbloqueo|unlock" -Context 2,2

# Verificar autorización
Get-Content "C:\ProgramData\USBMonitor\agent.log" | Select-String "autoriza"

# Probar diskpart manualmente
diskpart
# En diskpart:
list volume
select volume E
attributes volume clear readonly
exit
```

---

## 📋 ARCHIVOS IMPORTANTES

```
D:\Monitor_USB\usb_monitor.log              # Log del servicio
C:\ProgramData\USBMonitor\agent.log         # Log del agente
C:\ProgramData\USBMonitor\browser_signal.json  # Archivo de señal
```

---

## 🔗 AYUDA

```powershell
# Ayuda del instalador
python setup_complete.py --help

# Documentación
notepad README.md
notepad README_AGENT.md
notepad QUICK_START.md
notepad ARCHITECTURE.md
```

---

**Tip**: Añade este archivo a favoritos para acceso rápido a comandos 🚀
