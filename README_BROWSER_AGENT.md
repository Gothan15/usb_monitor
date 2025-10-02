# 🔌 Sistema de Apertura Automática de Navegador para USB Monitor

## 📖 Resumen

Este sistema resuelve el problema de **abrir el navegador automáticamente** cuando se detecta un USB en un **servicio de Windows** (que corre en sesión 0 sin acceso al escritorio del usuario).

### Problema Original

Los servicios de Windows no pueden abrir ventanas ni aplicaciones gráficas en la sesión interactiva del usuario por restricciones de seguridad de Windows.

### Solución Implementada

**Arquitectura de 2 procesos comunicados mediante archivo de señal:**

1. **Servicio (Sesión 0)**: Detecta USB → Escribe señal en archivo JSON
2. **Agente (Sesión Usuario)**: Lee señal → Abre navegador

```
┌─────────────────┐         ┌─────────────────┐         ┌─────────────────┐
│  USB Monitor    │ escribe │  browser_signal │  lee    │  Browser Agent  │
│  Service        │-------->│  .json          │-------->│  (Usuario)      │
│  (Sesión 0)     │         │  (Compartido)   │         │  Abre Navegador │
└─────────────────┘         └─────────────────┘         └─────────────────┘
```

## 📦 Componentes Nuevos

### 1. `usb_browser_agent.py`

**Aplicación que corre en la sesión del usuario**

- ✅ Se ejecuta en la bandeja del sistema (system tray)
- ✅ Monitorea archivo de señal cada segundo
- ✅ Abre navegador cuando detecta señal nueva
- ✅ Se instala en inicio automático de Windows
- ✅ Interfaz gráfica mínima (ícono en bandeja)

**Comandos:**

```bash
# Instalar en inicio de Windows
python usb_browser_agent.py --install

# Ejecutar en bandeja del sistema
python usb_browser_agent.py --hidden

# Ejecutar en primer plano (ver logs)
python usb_browser_agent.py

# Desinstalar del inicio
python usb_browser_agent.py --uninstall
```

### 2. `install_complete_system.py`

**Script de instalación automatizada**

Instala y configura todo el sistema:

- Verifica dependencias
- Instala servicio de Windows
- Instala agente de navegador
- Configura variables de entorno
- Inicia componentes

**Uso:**

```bash
# Ejecutar como Administrador
python install_complete_system.py
```

### 3. `test_browser_signal.py`

**Script de prueba del sistema de señales**

Simula la creación de una señal para verificar que el agente funciona.

**Uso:**

```bash
python test_browser_signal.py
```

## 🔧 Modificaciones a Archivos Existentes

### `usb_monitor_service.py`

**Cambios en la función `open_browser_login()`:**

**ANTES** (no funcionaba en servicio):

```python
def open_browser_login() -> None:
    webbrowser.open(url)  # No funciona en sesión 0
```

**DESPUÉS** (usa archivo de señal):

```python
def open_browser_login() -> None:
    # Escribe señal en archivo JSON
    signal_data = {
        "timestamp": "...",
        "url": "http://...",
        "pc_name": "...",
        "processed": False
    }
    with open(signal_file, 'w') as f:
        json.dump(signal_data, f)
```

## 🚀 Instalación Rápida

### Opción A: Instalador Automático (Recomendado)

```powershell
# 1. Instalar dependencias
cd D:\Monitor_USB\scripts
pip install -r usb_monitor_requirements.txt

# 2. Ejecutar instalador como Administrador
python install_complete_system.py

# 3. Seguir instrucciones en pantalla
```

### Opción B: Manual

```powershell
# 1. Instalar dependencias
pip install pywin32 wmi requests pystray pillow

# 2. Instalar servicio (como Admin)
python usb_monitor_service.py install

# 3. Instalar agente (como usuario normal)
python usb_browser_agent.py --install

# 4. Configurar variables de entorno (como Admin)
setx USB_MONITOR_SERVER_HOST "172.20.10.12" /M
setx USB_MONITOR_SERVER_PORT "3000" /M
setx USB_MONITOR_API_KEY "uk_xxx" /M

# 5. Iniciar servicio (como Admin)
python usb_monitor_service.py start

# 6. Iniciar agente
python usb_browser_agent.py --hidden
```

## 🧪 Pruebas

### Prueba 1: Verificar Agente Funciona

```bash
# 1. Iniciar agente en primer plano
python usb_browser_agent.py

# 2. En otra terminal, ejecutar prueba
python test_browser_signal.py

# Resultado esperado: El navegador se abre automáticamente
```

### Prueba 2: Prueba Completa con USB (Modo Debug)

```bash
# 1. Iniciar backend
npm run dev

# 2. Iniciar agente
python usb_browser_agent.py --hidden

# 3. Iniciar servicio en modo debug
python usb_monitor_service.py debug

# 4. Conectar USB
# Resultado esperado:
# - USB se bloquea (readonly)
# - Navegador se abre automáticamente
# - Página de login carga con pcName
```

### Prueba 3: Como Servicio (Producción)

```bash
# 1. Iniciar servicio como Windows Service
python usb_monitor_service.py start

# 2. Verificar agente está en bandeja del sistema

# 3. Conectar USB
# Resultado esperado: mismo que Prueba 2
```

## 📁 Archivos y Ubicaciones

```
D:/Monitor_USB/
├── scripts/
│   ├── usb_monitor_service.py          # Servicio principal (modificado)
│   ├── usb_browser_agent.py            # ⭐ NUEVO: Agente de navegador
│   ├── install_complete_system.py      # ⭐ NUEVO: Instalador automático
│   ├── test_browser_signal.py          # ⭐ NUEVO: Script de prueba
│   └── usb_monitor_requirements.txt    # Actualizado con nuevas deps
│
├── GUIA_INSTALACION_COMPLETA.md        # ⭐ NUEVO: Guía completa
├── README_BROWSER_AGENT.md             # ⭐ ESTE ARCHIVO
└── README_UNLOCK_SYSTEM.md             # Sistema de desbloqueo

C:/ProgramData/USBMonitor/
└── browser_signal.json                 # Archivo de señal compartido

%USERPROFILE%/
└── usb_browser_agent.log              # Log del agente
```

## 🔍 Troubleshooting

### El navegador no se abre

**Verificar:**

```powershell
# 1. ¿Está el agente corriendo?
# Buscar en bandeja del sistema o:
Get-Process | Where-Object {$_.Name -like "*python*"}

# 2. ¿Existe el archivo de señal?
Get-Content C:\ProgramData\USBMonitor\browser_signal.json

# 3. ¿Tiene permisos?
Test-Path C:\ProgramData\USBMonitor\ -PathType Container

# 4. Ver logs del agente
Get-Content ~\usb_browser_agent.log -Tail 50
```

**Soluciones:**

```bash
# Reiniciar agente
# Cerrar desde bandeja del sistema y:
python usb_browser_agent.py --hidden

# O revisar logs para errores
notepad %USERPROFILE%\usb_browser_agent.log
```

### El agente no se inicia al arrancar Windows

**Verificar instalación:**

```powershell
# Ver registro de inicio
Get-ItemProperty -Path "HKCU:\Software\Microsoft\Windows\CurrentVersion\Run"

# Debe aparecer: USBBrowserAgent
```

**Reinstalar:**

```bash
python usb_browser_agent.py --uninstall
python usb_browser_agent.py --install
```

### Señal se crea pero no se procesa

**Posibles causas:**

1. Señal expiró (>5 minutos)
2. Archivo corrupto
3. Agente no tiene permisos de lectura

**Solución:**

```bash
# Limpiar señal y reconectar USB
Remove-Item C:\ProgramData\USBMonitor\browser_signal.json
# Reconectar USB
```

## 📊 Monitoreo

### Ver logs en tiempo real

**Agente:**

```powershell
Get-Content ~\usb_browser_agent.log -Wait -Tail 10
```

**Servicio:**

```powershell
Get-Content D:\Monitor_USB\usb_monitor.log -Wait -Tail 10
```

### Estado del sistema

```powershell
# Servicio de Windows
Get-Service | Where-Object {$_.Name -like "*USB*"}

# Procesos Python
Get-Process | Where-Object {$_.Name -like "*python*"}

# Archivo de señal
if (Test-Path C:\ProgramData\USBMonitor\browser_signal.json) {
    Get-Content C:\ProgramData\USBMonitor\browser_signal.json | ConvertFrom-Json
}
```

## 🎯 Ventajas de Esta Solución

✅ **Simple**: Un archivo JSON como medio de comunicación  
✅ **Confiable**: No depende de red o sockets  
✅ **Seguro**: Permisos de archivo estándar de Windows  
✅ **Mantenible**: Fácil de debuggear (ver archivo JSON)  
✅ **Ligero**: Agente consume <10MB RAM  
✅ **No invasivo**: Ícono discreto en bandeja del sistema

## 🔄 Alternativas Consideradas

| Método               | ¿Por qué NO?                           |
| -------------------- | -------------------------------------- |
| Named Pipes          | Complejo de implementar entre sesiones |
| Sockets TCP/UDP      | Requiere firewall, más complejo        |
| Windows Messages     | No cruzan sesiones 0 ↔ usuario         |
| COM/DCOM             | Deprecated, problemas de seguridad     |
| **Archivo de señal** | ✅ **Elegido: Simple y funciona**      |

## 📚 Referencias

- [Guía de instalación completa](GUIA_INSTALACION_COMPLETA.md)
- [Sistema de desbloqueo USB](README_UNLOCK_SYSTEM.md)
- [Documentación original](GUIA_PASO_A_PASO.md)

---

**Última actualización:** 1 de octubre de 2025  
**Versión:** 2.0 - Sistema de navegador automático
