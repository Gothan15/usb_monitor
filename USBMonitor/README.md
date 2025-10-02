# USB Monitor - Sistema Completo

Sistema de monitoreo y control de dispositivos USB para Windows con autenticación de usuarios.

## 📋 Descripción General

Este sistema consta de dos componentes principales:

1. **USB Monitor Service** (`usb_monitor_service.py`): Servicio de Windows que detecta conexiones USB, las bloquea en modo solo lectura y gestiona el desbloqueo tras autenticación.

2. **USB Monitor Agent** (`usb_monitor_agent.py`): Aplicación de usuario con interfaz gráfica que permite al usuario autenticarse para desbloquear las unidades USB.

## 🏗️ Arquitectura del Sistema

```
┌─────────────────────────────────────────────────────────────┐
│                        USUARIO                               │
│  ┌─────────────────────────────────────────────────────┐   │
│  │  USB Monitor Agent (GUI)                            │   │
│  │  - Corre en bandeja del sistema                     │   │
│  │  - Muestra formulario de login                      │   │
│  │  - Valida credenciales                              │   │
│  └─────────────────────────────────────────────────────┘   │
│                           ↕                                  │
│                    (Archivo de señal)                        │
│                           ↕                                  │
│  ┌─────────────────────────────────────────────────────┐   │
│  │  USB Monitor Service (Servicio Windows)             │   │
│  │  - Detecta conexión USB                             │   │
│  │  - Bloquea con diskpart (readonly)                  │   │
│  │  - Espera autorización                              │   │
│  │  - Desbloquea si autorizado                         │   │
│  └─────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────┘
                           ↕
                     (API REST)
                           ↕
┌─────────────────────────────────────────────────────────────┐
│                    SERVIDOR BACKEND                          │
│  - Gestión de usuarios                                       │
│  - Autenticación                                             │
│  - Registro de eventos                                       │
│  - Control de autorizaciones                                 │
└─────────────────────────────────────────────────────────────┘
```

## 🚀 Instalación Rápida

### 1. Instalar Dependencias

```powershell
# Dependencias del servicio
pip install pywin32 wmi requests

# Dependencias del agente
pip install pillow pystray requests
```

O usar los archivos de requisitos:

```powershell
pip install -r requirements_service.txt
pip install -r requirements_agent.txt
```

### 2. Instalar el Servicio de Windows

```powershell
# Instalar el servicio
python usb_monitor_service.py install

# Iniciar el servicio
python usb_monitor_service.py start
```

### 3. Instalar el Agente de Usuario

```powershell
# Instalar en el inicio de Windows
python install_agent.py install

# Iniciar el agente manualmente (opcional)
python usb_monitor_agent.py
```

## 🔄 Flujo de Trabajo

### Escenario: Usuario conecta una memoria USB

1. **Detección**: El servicio detecta la conexión de la unidad USB (por ejemplo, E:)

2. **Bloqueo automático**: El servicio ejecuta `diskpart` para establecer la unidad en modo solo lectura

3. **Notificación al backend**: El servicio envía un evento POST al servidor con:

   - Nombre del PC
   - IP del PC
   - Usuario de Windows
   - Letra de unidad
   - Estado de protección

4. **Registro de desbloqueo**: El servicio crea un registro de "desbloqueo pendiente" en el backend

5. **Señal al agente**: El servicio crea un archivo de señal JSON en `C:\ProgramData\USBMonitor\browser_signal.json`

6. **Agente detecta señal**: El agente (corriendo en segundo plano) detecta la señal cada 2 segundos

7. **Ventana de login**: El agente muestra una ventana de login en primer plano con:

   - Nombre del PC
   - Letra de la unidad USB
   - Campos para usuario y contraseña

8. **Autenticación**: El usuario introduce sus credenciales y hace clic en "Desbloquear"

9. **Validación con el servidor**: El agente envía las credenciales al endpoint `/api/auth/login`

10. **Autorización**: Si las credenciales son válidas, el agente llama a `/api/usb-unlock/authorize`

11. **Polling de autorización**: El servicio hace polling al endpoint `/api/usb-unlock/status` cada 3 segundos

12. **Desbloqueo**: Una vez autorizado, el servicio ejecuta `diskpart` para remover el atributo readonly

13. **Confirmación**: El agente muestra un mensaje de éxito y se cierra la ventana

14. **Evento de desbloqueo**: El servicio envía otro evento POST al servidor confirmando el desbloqueo

15. **Acceso completo**: El usuario puede usar la unidad USB con permisos de lectura y escritura

## 📁 Estructura de Archivos

```
USBMonitor/
├── usb_monitor_service.py      # Servicio de Windows
├── usb_monitor_agent.py        # Aplicación de usuario con GUI
├── install_agent.py            # Instalador del agente
├── setup_complete.py           # Instalador/Desinstalador completo
├── check_status.py             # Verificador de estado
├── build_agent_exe.py          # Compilador a ejecutable
├── test_agent.py               # Script de pruebas
├── requirements.txt            # Todas las dependencias
├── requirements_service.txt    # Dependencias del servicio
├── requirements_agent.txt      # Dependencias del agente
├── README.md                   # Este archivo
└── README_AGENT.md            # Documentación del agente
```

## 🗑️ Desinstalación

### Desinstalación Completa (Automática)

```powershell
# Desinstalar manteniendo logs para diagnóstico
python setup_complete.py --uninstall

# O desinstalar eliminando TODO (incluyendo logs)
python setup_complete.py --full-remove
```

### Desinstalación Manual

```powershell
# 1. Detener y desinstalar el servicio
python usb_monitor_service.py stop
python usb_monitor_service.py remove

# 2. Desinstalar el agente
python install_agent.py uninstall

# 3. (Opcional) Eliminar archivos de log manualmente
Remove-Item -Path "D:\Monitor_USB\usb_monitor.log" -Force
Remove-Item -Path "C:\ProgramData\USBMonitor\*" -Recurse -Force
```

### Verificar Desinstalación

```powershell
# Verificar que el servicio fue eliminado
sc query USBMonitorService

# Verificar que el agente fue desinstalado
python install_agent.py status
```

## ⚙️ Configuración

### Variables de Entorno

Ambos componentes usan las mismas variables de entorno:

```powershell
# Host del servidor backend (por defecto: 172.20.10.12)
$env:USB_MONITOR_SERVER_HOST = "192.168.1.100"

# Puerto del servidor (por defecto: 3000)
$env:USB_MONITOR_SERVER_PORT = "8080"

# Endpoint de eventos (por defecto: /api/usb-event)
$env:USB_MONITOR_ENDPOINT = "/api/usb-event"

# API Key para autenticación (opcional)
$env:USB_MONITOR_API_KEY = "tu-api-key-aqui"

# Ruta del log del servicio (opcional)
$env:USB_MONITOR_LOG_PATH = "D:/Monitor_USB/usb_monitor.log"
```

### Archivos del Sistema

- **Log del servicio**: `D:\Monitor_USB\usb_monitor.log`
- **Log del agente**: `C:\ProgramData\USBMonitor\agent.log`
- **Archivo de señal**: `C:\ProgramData\USBMonitor\browser_signal.json`

## 🧪 Pruebas

### Probar el Servicio

```powershell
# Ejecutar en modo debug (consola)
python usb_monitor_service.py debug
```

Luego conecta una memoria USB y observa los logs en tiempo real.

### Probar el Agente

```powershell
# Terminal 1: Ejecutar el agente
python usb_monitor_agent.py

# Terminal 2: Simular una señal
python test_agent.py
```

Selecciona la opción 1 para crear una señal de prueba. El agente debería mostrar la ventana de login.

## 🔍 Solución de Problemas

### El servicio no detecta USB

1. Verifica que el servicio está en ejecución:

   ```powershell
   sc query USBMonitorService
   ```

2. Revisa los logs:

   ```powershell
   notepad D:\Monitor_USB\usb_monitor.log
   ```

3. Ejecuta en modo debug para ver errores en tiempo real

### El agente no muestra la ventana

1. Verifica que el agente está en ejecución (icono en bandeja del sistema)

2. Revisa el archivo de señal:

   ```powershell
   notepad C:\ProgramData\USBMonitor\browser_signal.json
   ```

3. Revisa los logs del agente:
   ```powershell
   notepad C:\ProgramData\USBMonitor\agent.log
   ```

### La USB no se desbloquea

1. Verifica las credenciales del usuario en el backend

2. Verifica que el endpoint `/api/usb-unlock/authorize` funciona

3. Revisa los logs del servicio para ver si detecta la autorización

4. Verifica que `diskpart` tiene permisos (el servicio debe correr como SYSTEM)

## 🔐 Seguridad

### Recomendaciones

- **Usar HTTPS**: En producción, configura el backend para usar HTTPS
- **API Keys**: Configura API Keys para la comunicación servicio-backend
- **Permisos**: El servicio debe correr con permisos de SYSTEM
- **Logs**: Revisa regularmente los logs para detectar intentos sospechosos
- **Timeouts**: El servicio tiene un timeout de 5 minutos para autorización

### Permisos Requeridos

- **Servicio**: Permisos de SYSTEM para ejecutar `diskpart`
- **Agente**: Permisos de usuario normal para mostrar ventanas
- **Instaladores**: Pueden requerir permisos de administrador

## 📊 Endpoints del Backend

El sistema espera los siguientes endpoints en el backend:

### POST `/api/usb-event`

Envía eventos de conexión/desbloqueo USB

**Body:**

```json
{
  "pc_name": "DESKTOP-ABC123",
  "pc_ip": "192.168.1.100",
  "pc_user": "juan.perez",
  "drive_letter": "E:",
  "readonly_status": "readonly aplicado al volumen E:",
  "event": "USB inserted: E: | readonly aplicado al volumen E:"
}
```

### POST `/api/usb-event/pending-unlock`

Crea un registro de desbloqueo pendiente

**Body:**

```json
{
  "pcName": "DESKTOP-ABC123",
  "driveLetter": "E:"
}
```

### POST `/api/auth/login`

Valida credenciales de usuario

**Body:**

```json
{
  "username": "juan.perez",
  "password": "password123",
  "pcName": "DESKTOP-ABC123"
}
```

**Response:**

```json
{
  "success": true,
  "token": "jwt-token-aqui"
}
```

### POST `/api/usb-unlock/authorize`

Autoriza el desbloqueo de una unidad

**Body:**

```json
{
  "pcName": "DESKTOP-ABC123",
  "authorized": true
}
```

### GET `/api/usb-unlock/status?pcName=DESKTOP-ABC123&check=true`

Verifica si hay autorización de desbloqueo

**Response:**

```json
{
  "unlocked": true
}
```

## 🛠️ Desarrollo

### Compilar el Agente a .EXE

Para distribuir el agente sin necesidad de Python:

```powershell
# Instalar PyInstaller
pip install pyinstaller

# Compilar
python build_agent_exe.py
```

El ejecutable se generará en `dist/USBMonitorAgent.exe`

### Modificar el Código

- **Servicio**: Edita `usb_monitor_service.py`
- **Agente**: Edita `usb_monitor_agent.py`

Después de modificar el servicio, reinicialo:

```powershell
python usb_monitor_service.py stop
python usb_monitor_service.py start
```

## 📝 Comandos Útiles

### Setup Completo

```powershell
# Instalar sistema completo
python setup_complete.py

# Desinstalar (mantener logs)
python setup_complete.py --uninstall

# Desinstalar (eliminar todo)
python setup_complete.py --full-remove

# Ver ayuda
python setup_complete.py --help

# Verificar estado del sistema
python check_status.py
```

### Servicio

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

# Debug (consola)
python usb_monitor_service.py debug
```

### Agente

```powershell
# Instalar en inicio
python install_agent.py install

# Ver estado
python install_agent.py status

# Desinstalar
python install_agent.py uninstall

# Ejecutar manualmente
python usb_monitor_agent.py
```

## 📄 Licencia

[Especifica tu licencia aquí]

## 🤝 Contribuciones

[Especifica cómo contribuir]

## 📧 Contacto

[Tu información de contacto]

---

**Versión**: 1.0.0
**Última actualización**: Octubre 2025
