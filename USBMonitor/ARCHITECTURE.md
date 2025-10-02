# 📊 Arquitectura del Sistema USB Monitor

## 🏗️ Componentes del Sistema

```
┌─────────────────────────────────────────────────────────────────────┐
│                         NIVEL DE USUARIO                             │
├─────────────────────────────────────────────────────────────────────┤
│                                                                       │
│  ┌──────────────────────────────────────────────────────────────┐  │
│  │  🖥️ USB Monitor Agent (usb_monitor_agent.py)                 │  │
│  │                                                                │  │
│  │  • Corre en la sesión del usuario                            │  │
│  │  • Icono en bandeja del sistema (system tray)                │  │
│  │  • Monitorea archivo de señales cada 2 segundos              │  │
│  │  • Muestra ventana de login al detectar señal                │  │
│  │  • Valida credenciales con el backend                        │  │
│  │  • Envía autorización de desbloqueo                          │  │
│  │                                                                │  │
│  │  Instalación: install_agent.py install                       │  │
│  │  Inicio: Automático con Windows (Registro/Startup)           │  │
│  └──────────────────────────────────────────────────────────────┘  │
│                                                                       │
└─────────────────────────────────────────────────────────────────────┘
                                  ↕
                    (Archivo de señal JSON)
                 C:\ProgramData\USBMonitor\browser_signal.json
                                  ↕
┌─────────────────────────────────────────────────────────────────────┐
│                      NIVEL DE SISTEMA                                │
├─────────────────────────────────────────────────────────────────────┤
│                                                                       │
│  ┌──────────────────────────────────────────────────────────────┐  │
│  │  ⚙️ USB Monitor Service (usb_monitor_service.py)             │  │
│  │                                                                │  │
│  │  • Servicio de Windows (LocalSystem)                         │  │
│  │  • Detecta eventos de conexión USB (WMI)                     │  │
│  │  • Bloquea unidades con diskpart (readonly)                  │  │
│  │  • Crea señal para el agente                                 │  │
│  │  • Hace polling al backend cada 3s                           │  │
│  │  • Desbloquea unidad si autorizado                           │  │
│  │  • Registra todos los eventos                                │  │
│  │                                                                │  │
│  │  Instalación: usb_monitor_service.py install                 │  │
│  │  Inicio: Automático con Windows (Servicio)                   │  │
│  └──────────────────────────────────────────────────────────────┘  │
│                                                                       │
└─────────────────────────────────────────────────────────────────────┘
                                  ↕
                           (API REST - HTTPS)
                                  ↕
┌─────────────────────────────────────────────────────────────────────┐
│                       SERVIDOR BACKEND                               │
├─────────────────────────────────────────────────────────────────────┤
│                                                                       │
│  📡 API REST (Node.js/Express, Puerto 3000)                         │
│                                                                       │
│  Endpoints:                                                          │
│  • POST /api/usb-event                 → Registrar evento USB       │
│  • POST /api/usb-event/pending-unlock  → Crear registro pendiente  │
│  • POST /api/auth/login                → Validar credenciales      │
│  • POST /api/usb-unlock/authorize      → Autorizar desbloqueo      │
│  • GET  /api/usb-unlock/status         → Consultar autorización    │
│                                                                       │
│  💾 Base de Datos                                                    │
│  • Usuarios y credenciales                                          │
│  • Historial de eventos USB                                         │
│  • Registros de desbloqueo                                          │
│  • Logs de auditoría                                                │
│                                                                       │
└─────────────────────────────────────────────────────────────────────┘
```

## 🔄 Flujo de Datos Detallado

### 1️⃣ Detección de USB (0-2 segundos)

```
Usuario conecta USB
      ↓
WMI detecta evento (Win32_VolumeChangeEvent)
      ↓
Servicio identifica letra de unidad (E:)
      ↓
diskpart: "select volume E" + "attributes volume set readonly"
      ↓
Unidad E: ahora es SOLO LECTURA 🔒
```

### 2️⃣ Notificación al Backend (2-5 segundos)

```
POST /api/usb-event
{
  "pc_name": "DESKTOP-ABC123",
  "pc_ip": "192.168.1.100",
  "pc_user": "juan.perez",
  "drive_letter": "E:",
  "readonly_status": "readonly aplicado",
  "event": "USB inserted: E:"
}
      ↓
Backend registra evento en BD
      ↓
POST /api/usb-event/pending-unlock
{
  "pcName": "DESKTOP-ABC123",
  "driveLetter": "E:"
}
      ↓
Backend crea registro de desbloqueo pendiente
```

### 3️⃣ Señal al Agente (5-7 segundos)

```
Servicio crea archivo JSON
C:\ProgramData\USBMonitor\browser_signal.json
{
  "timestamp": "2025-10-02T14:30:45",
  "pc_name": "DESKTOP-ABC123",
  "drive_letter": "E:",
  "url": "http://172.20.10.12:3000/login?pcName=DESKTOP-ABC123",
  "processed": false
}
      ↓
Agente detecta archivo (polling cada 2s)
      ↓
Agente marca archivo como "processed": true
      ↓
Agente muestra ventana de login 🖥️
```

### 4️⃣ Autenticación (Usuario interactúa)

```
Usuario ve ventana:
┌────────────────────────────────┐
│  🔒 Desbloqueo de USB          │
│  PC: DESKTOP-ABC123            │
│  Unidad: E:                    │
│                                 │
│  Usuario:    [juan.perez    ]  │
│  Contraseña: [••••••••••••••]  │
│                                 │
│  [Desbloquear]    [Cancelar]   │
└────────────────────────────────┘
      ↓
Usuario ingresa credenciales y hace clic en "Desbloquear"
      ↓
POST /api/auth/login
{
  "username": "juan.perez",
  "password": "********",
  "pcName": "DESKTOP-ABC123"
}
      ↓
Backend valida contra BD
      ↓
Backend responde con token JWT
```

### 5️⃣ Autorización (5-10 segundos)

```
Agente recibe token
      ↓
POST /api/usb-unlock/authorize
{
  "pcName": "DESKTOP-ABC123",
  "authorized": true
}
Headers: { Authorization: "Bearer <token>" }
      ↓
Backend actualiza registro: desbloqueo AUTORIZADO ✅
```

### 6️⃣ Polling y Desbloqueo (3-15 segundos)

```
Servicio hace polling cada 3 segundos:
GET /api/usb-unlock/status?pcName=DESKTOP-ABC123&check=true
      ↓
Backend responde:
{ "unlocked": true }
      ↓
Servicio ejecuta desbloqueo:
diskpart: "select volume E" + "attributes volume clear readonly"
      ↓
Unidad E: ahora es LECTURA/ESCRITURA 🔓
      ↓
Servicio envía evento de confirmación:
POST /api/usb-event
{
  "event": "USB desbloqueado: E:",
  "readonly_status": "DESBLOQUEADO"
}
      ↓
Agente muestra mensaje de éxito ✅
```

## 📂 Estructura de Archivos

```
USBMonitor/
│
├── 🐍 APLICACIONES PRINCIPALES
│   ├── usb_monitor_service.py     (23 KB) - Servicio de Windows
│   └── usb_monitor_agent.py       (19 KB) - Agente de usuario
│
├── 🔧 INSTALADORES Y HERRAMIENTAS
│   ├── install_agent.py           (8 KB)  - Instalar agente
│   ├── setup_complete.py          (11 KB) - Instalador completo
│   └── build_agent_exe.py         (4 KB)  - Compilar a .exe
│
├── 🧪 PRUEBAS
│   └── test_agent.py              (3 KB)  - Probar señales
│
├── 📦 DEPENDENCIAS
│   ├── requirements.txt           - Todas las dependencias
│   └── requirements_agent.txt     - Solo agente
│
└── 📚 DOCUMENTACIÓN
    ├── README.md                  (12 KB) - Documentación completa
    ├── README_AGENT.md            (8 KB)  - Documentación del agente
    ├── QUICK_START.md             (3 KB)  - Inicio rápido
    └── ARCHITECTURE.md            - Este archivo
```

## 🔐 Niveles de Seguridad

### Nivel 1: Hardware

- 🔒 Unidad USB bloqueada físicamente (atributo readonly del sistema)
- ⚙️ Diskpart requiere permisos de SYSTEM

### Nivel 2: Sistema Operativo

- 🛡️ Servicio corriendo como LocalSystem
- 🔑 Agente corriendo en sesión de usuario
- 📁 Archivos protegidos en ProgramData

### Nivel 3: Red

- 🌐 Comunicación HTTP con el backend (HTTPS recomendado)
- 🔑 API Keys opcionales para autenticación servicio-backend
- 🎫 JWT tokens para sesiones de usuario

### Nivel 4: Aplicación

- 👤 Autenticación de usuario obligatoria
- ⏱️ Timeout de 5 minutos para autorización
- 📝 Logs de auditoría completos
- 🔄 Registro de todos los eventos

## ⚡ Rendimiento

### Latencias Típicas

| Operación                           | Tiempo    |
| ----------------------------------- | --------- |
| Detección USB → Bloqueo             | 0.5-2s    |
| Bloqueo → Señal al agente           | 2-3s      |
| Señal → Ventana visible             | 2-4s      |
| Login → Validación                  | 0.5-1s    |
| Autorización → Desbloqueo           | 3-6s      |
| **TOTAL (conexión → desbloqueado)** | **8-16s** |

### Recursos del Sistema

| Componente        | CPU  | RAM      | Disco     |
| ----------------- | ---- | -------- | --------- |
| Servicio (idle)   | <1%  | 20-30 MB | Log files |
| Servicio (activo) | 2-5% | 30-50 MB | Log files |
| Agente (idle)     | <1%  | 15-25 MB | Log files |
| Agente (ventana)  | 1-3% | 30-40 MB | Log files |

## 🔍 Puntos de Monitoreo

### Logs del Servicio

```
D:\Monitor_USB\usb_monitor.log
```

- Eventos de detección USB
- Operaciones de diskpart
- Comunicación con backend
- Errores y warnings

### Logs del Agente

```
C:\ProgramData\USBMonitor\agent.log
```

- Señales detectadas
- Intentos de login
- Respuestas del backend
- Errores de UI

### Archivo de Señal

```
C:\ProgramData\USBMonitor\browser_signal.json
```

- Estado actual de señalización
- Timestamp de última señal
- Estado de procesamiento

## 🛠️ Comandos de Diagnóstico

```powershell
# Estado del servicio
sc query USBMonitorService

# Ver logs en tiempo real (servicio)
Get-Content -Path "D:\Monitor_USB\usb_monitor.log" -Wait -Tail 50

# Ver logs en tiempo real (agente)
Get-Content -Path "C:\ProgramData\USBMonitor\agent.log" -Wait -Tail 50

# Ver archivo de señal
Get-Content -Path "C:\ProgramData\USBMonitor\browser_signal.json" | ConvertFrom-Json

# Probar conexión al backend
Invoke-WebRequest -Uri "http://172.20.10.12:3000/api/health" -Method GET

# Ver unidades USB montadas
Get-Volume | Where-Object {$_.DriveType -eq 'Removable'}
```

## 🎯 Casos de Uso

### ✅ Caso Normal: Desbloqueo Exitoso

1. Usuario conecta USB → Bloqueado ✅
2. Ventana aparece → Usuario se autentica ✅
3. Backend valida → Autoriza ✅
4. Servicio desbloquea → USB disponible ✅

### ❌ Caso Error: Credenciales Inválidas

1. Usuario conecta USB → Bloqueado ✅
2. Ventana aparece → Usuario se autentica ❌
3. Backend rechaza → Mensaje de error
4. Usuario puede reintentar
5. USB permanece bloqueado 🔒

### ⏱️ Caso Timeout: Sin Autorización

1. Usuario conecta USB → Bloqueado ✅
2. Ventana aparece → Usuario cancela o no responde
3. Timeout de 5 minutos ⏱️
4. USB permanece bloqueado 🔒
5. Requiere reconexión para reintentar

### 🔌 Caso Desconexión: Sin Backend

1. Usuario conecta USB → Bloqueado ✅
2. Ventana aparece → Usuario se autentica
3. Backend no responde ❌
4. Mensaje: "No se puede conectar al servidor"
5. USB permanece bloqueado 🔒

---

**Versión del Sistema**: 1.0.0  
**Última actualización**: 2 de octubre de 2025
