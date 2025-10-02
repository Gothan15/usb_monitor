# 📚 Índice General - Sistema USB Monitor

Guía completa de todos los archivos y su propósito.

---

## 🎯 ARCHIVOS PRINCIPALES (Aplicaciones)

### `usb_monitor_service.py` (23 KB)

**Servicio de Windows que monitorea y controla dispositivos USB**

- Detecta conexiones USB usando WMI
- Bloquea unidades en modo solo lectura con diskpart
- Se comunica con el backend para registrar eventos
- Gestiona autorización de desbloqueo
- Se ejecuta como servicio de Windows (LocalSystem)

**Comandos principales:**

```powershell
python usb_monitor_service.py install   # Instalar
python usb_monitor_service.py start     # Iniciar
python usb_monitor_service.py stop      # Detener
python usb_monitor_service.py debug     # Modo consola
```

---

### `usb_monitor_agent.py` (19 KB)

**Aplicación de usuario con interfaz gráfica**

- Corre en la sesión del usuario
- Icono en bandeja del sistema (system tray)
- Muestra formulario de login cuando se detecta USB
- Valida credenciales con el backend
- Envía autorización de desbloqueo

**Uso:**

```powershell
python usb_monitor_agent.py
```

---

## 🔧 HERRAMIENTAS DE INSTALACIÓN

### `setup_complete.py` (19 KB) ⭐ **MÁS USADO**

**Instalador/Desinstalador completo del sistema**

- Instala dependencias automáticamente
- Configura servicio + agente
- Verifica permisos y requisitos
- Desinstala completamente el sistema

**Comandos:**

```powershell
python setup_complete.py               # Instalar
python setup_complete.py --uninstall   # Desinstalar (mantener logs)
python setup_complete.py --full-remove # Desinstalar (eliminar todo)
python setup_complete.py --help        # Ayuda
```

---

### `install_agent.py` (8 KB)

**Instalador específico del agente de usuario**

- Añade el agente al registro de Windows
- Configura inicio automático
- Método alternativo: carpeta de inicio

**Comandos:**

```powershell
python install_agent.py install        # Instalar
python install_agent.py status         # Ver estado
python install_agent.py uninstall      # Desinstalar
python install_agent.py install-alt    # Método alternativo
```

---

### `build_agent_exe.py` (4 KB)

**Compilador del agente a ejecutable .exe**

- Usa PyInstaller para crear .exe standalone
- No requiere Python instalado para ejecutar
- Limpia archivos temporales

**Uso:**

```powershell
pip install pyinstaller
python build_agent_exe.py
# Genera: dist/USBMonitorAgent.exe
```

---

## 🧪 HERRAMIENTAS DE PRUEBA Y DIAGNÓSTICO

### `check_status.py` (10 KB) ⭐ **DIAGNÓSTICO**

**Verificador completo del estado del sistema**

- Estado del servicio (instalado/corriendo)
- Estado del agente (instalado/corriendo)
- Dependencias instaladas
- Variables de entorno
- Archivos de log
- Últimas líneas de logs

**Uso:**

```powershell
python check_status.py
```

---

### `test_agent.py` (3 KB)

**Script de prueba del agente sin USB real**

- Crea señales simuladas
- Verifica procesamiento de señales
- Limpia archivos de señal

**Uso:**

```powershell
python test_agent.py
# Opción 1: Crear señal de prueba
# Opción 2: Verificar estado
# Opción 3: Limpiar señal
```

---

## 📦 ARCHIVOS DE DEPENDENCIAS

### `requirements.txt` (0.3 KB) ⭐ **RECOMENDADO**

**Todas las dependencias del sistema**

Incluye:

- pywin32 (Windows service/WMI)
- wmi (Detección USB)
- requests (HTTP)
- pillow (Iconos)
- pystray (System tray)

```powershell
pip install -r requirements.txt
```

---

### `requirements_agent.txt` (0.2 KB)

**Solo dependencias del agente**

```powershell
pip install -r requirements_agent.txt
```

---

### `requirements_service.txt` (Crear si necesario)

**Solo dependencias del servicio**

```powershell
pip install -r requirements_service.txt
```

---

## 📖 DOCUMENTACIÓN

### `README.md` (13 KB) ⭐ **DOCUMENTACIÓN PRINCIPAL**

**Documentación completa del sistema**

Incluye:

- Descripción general y arquitectura
- Instalación paso a paso
- Configuración y uso
- Flujo de trabajo completo
- Endpoints del backend
- Solución de problemas
- Comandos útiles

**Leer primero este archivo**

---

### `README_AGENT.md` (8 KB)

**Documentación específica del agente**

Incluye:

- Características del agente
- Instalación del agente
- Uso y flujo de trabajo
- Configuración
- Solución de problemas
- Arquitectura del agente

---

### `QUICK_START.md` (5 KB) ⭐ **INICIO RÁPIDO**

**Guía de inicio rápido en 3 pasos**

- Instalación en minutos
- Verificación rápida
- Comandos esenciales
- Problemas comunes

**Para usuarios nuevos**

---

### `ARCHITECTURE.md` (14 KB)

**Arquitectura detallada del sistema**

Incluye:

- Diagramas de componentes
- Flujo de datos
- Estructura de archivos
- Niveles de seguridad
- Métricas de rendimiento
- Puntos de monitoreo

**Para desarrolladores y arquitectos**

---

### `COMMANDS.md` (7 KB) ⭐ **REFERENCIA RÁPIDA**

**Guía de todos los comandos disponibles**

Incluye:

- Instalación/Desinstalación
- Gestión del servicio
- Gestión del agente
- Verificación y diagnóstico
- Pruebas
- Configuración
- Solución de problemas

**Para acceso rápido a comandos**

---

### `INDEX.md` (Este archivo)

**Índice general de todos los archivos**

---

## 📂 ESTRUCTURA RECOMENDADA DE LECTURA

### Para Instalación Rápida:

1. `QUICK_START.md` - Inicio rápido
2. `setup_complete.py` - Ejecutar instalador
3. `check_status.py` - Verificar instalación

### Para Entender el Sistema:

1. `README.md` - Documentación principal
2. `ARCHITECTURE.md` - Arquitectura detallada
3. `README_AGENT.md` - Detalles del agente

### Para Uso Diario:

1. `COMMANDS.md` - Referencia de comandos
2. `check_status.py` - Verificar estado
3. `test_agent.py` - Probar funcionalidad

### Para Desarrollo:

1. `ARCHITECTURE.md` - Entender arquitectura
2. `usb_monitor_service.py` - Código del servicio
3. `usb_monitor_agent.py` - Código del agente
4. `build_agent_exe.py` - Compilar

### Para Solución de Problemas:

1. `check_status.py` - Diagnóstico
2. `COMMANDS.md` - Comandos de troubleshooting
3. `README.md` - Sección de problemas comunes

---

## 📊 RESUMEN DE ARCHIVOS

| Archivo                  | Tamaño | Tipo   | Prioridad | Descripción             |
| ------------------------ | ------ | ------ | --------- | ----------------------- |
| `usb_monitor_service.py` | 23 KB  | App    | ⭐⭐⭐    | Servicio principal      |
| `usb_monitor_agent.py`   | 19 KB  | App    | ⭐⭐⭐    | Agente de usuario       |
| `setup_complete.py`      | 19 KB  | Tool   | ⭐⭐⭐    | Instalador completo     |
| `check_status.py`        | 10 KB  | Tool   | ⭐⭐⭐    | Verificador de estado   |
| `README.md`              | 13 KB  | Doc    | ⭐⭐⭐    | Documentación principal |
| `QUICK_START.md`         | 5 KB   | Doc    | ⭐⭐⭐    | Inicio rápido           |
| `COMMANDS.md`            | 7 KB   | Doc    | ⭐⭐      | Referencia de comandos  |
| `ARCHITECTURE.md`        | 14 KB  | Doc    | ⭐⭐      | Arquitectura detallada  |
| `README_AGENT.md`        | 8 KB   | Doc    | ⭐⭐      | Doc. del agente         |
| `install_agent.py`       | 8 KB   | Tool   | ⭐        | Instalador del agente   |
| `build_agent_exe.py`     | 4 KB   | Tool   | ⭐        | Compilador a .exe       |
| `test_agent.py`          | 3 KB   | Tool   | ⭐        | Script de pruebas       |
| `requirements.txt`       | 0.3 KB | Config | ⭐⭐⭐    | Dependencias            |
| `requirements_agent.txt` | 0.2 KB | Config | ⭐        | Deps. del agente        |
| `INDEX.md`               | 6 KB   | Doc    | ⭐        | Este archivo            |

**Total:** 14 archivos | ~150 KB

---

## 🎯 CASOS DE USO

### Caso 1: Primera instalación

```powershell
1. Leer QUICK_START.md
2. pip install -r requirements.txt
3. python setup_complete.py
4. python check_status.py
```

### Caso 2: Verificar si todo funciona

```powershell
python check_status.py
```

### Caso 3: Probar sin USB real

```powershell
# Terminal 1
python usb_monitor_agent.py

# Terminal 2
python test_agent.py
```

### Caso 4: Ver logs en tiempo real

```powershell
Get-Content -Path "D:\Monitor_USB\usb_monitor.log" -Wait -Tail 50
```

### Caso 5: Desinstalar completamente

```powershell
python setup_complete.py --full-remove
```

### Caso 6: Compilar para distribución

```powershell
python build_agent_exe.py
# Distribuir: dist/USBMonitorAgent.exe
```

---

## 🔗 ENLACES RÁPIDOS

- **Instalación**: `QUICK_START.md` → Sección "Instalación en 3 Pasos"
- **Desinstalación**: `COMMANDS.md` → Sección "DESINSTALACIÓN"
- **Problemas**: `README.md` → Sección "Solución de Problemas"
- **Comandos**: `COMMANDS.md` → Todo el archivo
- **Arquitectura**: `ARCHITECTURE.md` → Sección "Componentes"
- **Estado**: Ejecutar `python check_status.py`

---

**Última actualización**: 2 de octubre de 2025  
**Versión del sistema**: 1.0.0
