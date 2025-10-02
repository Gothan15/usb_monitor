# Guía de Instalación - Sistema USB Monitor con Navegador Automático

## 🎯 Arquitectura del Sistema

El sistema consta de **3 componentes principales**:

```
┌─────────────────────────────────────────────────────────────────┐
│                        USUARIO (Sesión Interactiva)             │
│  ┌────────────────────────────────────────────────────────┐    │
│  │  USB Browser Agent (usb_browser_agent.py)             │    │
│  │  - Corre en bandeja del sistema                       │    │
│  │  - Monitorea archivo de señal                         │    │
│  │  - Abre navegador cuando recibe señal                 │    │
│  └────────────────────────────────────────────────────────┘    │
│                              ↑                                   │
│                              │ Lee señal                         │
│                              │                                   │
└──────────────────────────────┼───────────────────────────────────┘
                               │
                    ┌──────────┴──────────┐
                    │  Archivo de Señal   │
                    │  (JSON compartido)  │
                    │  C:/ProgramData/    │
                    │  USBMonitor/        │
                    │  browser_signal.json│
                    └──────────┬──────────┘
                               │
                               │ Escribe señal
                               ↓
┌─────────────────────────────────────────────────────────────────┐
│                    SISTEMA (Sesión 0 - Servicio)                │
│  ┌────────────────────────────────────────────────────────┐    │
│  │  USB Monitor Service (usb_monitor_service.py)         │    │
│  │  - Detecta conexión USB (WMI)                         │    │
│  │  - Aplica readonly (diskpart)                         │    │
│  │  - Escribe señal para abrir navegador                 │    │
│  │  - Espera autorización (polling)                      │    │
│  │  - Desbloquea USB si es autorizado                    │    │
│  └────────────────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────────────────┘
                               ↕
                         (HTTP POST/GET)
                               ↕
┌─────────────────────────────────────────────────────────────────┐
│                      BACKEND (Next.js Server)                   │
│  - API de autenticación                                         │
│  - Base de datos (usuarios, eventos, pending_unlocks)          │
│  - Sistema de roles (admin/user)                               │
└─────────────────────────────────────────────────────────────────┘
```

## 📦 Requisitos Previos

### Software Necesario

- **Windows 10/11**
- **Python 3.8+**
- **Privilegios de Administrador** (para instalar servicio)
- **Node.js 18+** (para backend)

### Dependencias Python

```bash
pip install pywin32 wmi requests pystray pillow
```

O usando el archivo de requisitos:

```bash
cd scripts
pip install -r usb_monitor_requirements.txt
```

## 🚀 Instalación Completa (Método Recomendado)

### Opción 1: Instalador Automático

```bash
# Ejecutar como Administrador
cd scripts
python install_complete_system.py
```

El instalador hará:

1. ✅ Verificar dependencias
2. ✅ Instalar servicio de Windows
3. ✅ Instalar agente de navegador en inicio
4. ✅ Configurar variables de entorno
5. ✅ Iniciar agente de navegador

### Opción 2: Instalación Manual

#### Paso 1: Instalar Servicio de Windows

```bash
# Ejecutar como Administrador
cd scripts
python usb_monitor_service.py install
```

#### Paso 2: Instalar Agente de Navegador

```bash
# Como usuario normal (NO como Admin)
cd scripts
python usb_browser_agent.py --install
```

Esto agregará el agente al inicio automático de Windows.

#### Paso 3: Configurar Variables de Entorno

**Como Administrador**, ejecutar:

```powershell
# Host del servidor
setx USB_MONITOR_SERVER_HOST "172.20.10.12" /M

# Puerto del servidor
setx USB_MONITOR_SERVER_PORT "3000" /M

# API Key (obtener del backend)
setx USB_MONITOR_API_KEY "uk_xxxxxxxxxxxxxxxxx" /M

# Opcional: ruta de log personalizada
setx USB_MONITOR_LOG_PATH "D:/Monitor_USB/" /M
```

**Importante:** Después de configurar variables de entorno, **reiniciar la sesión** o reiniciar los servicios.

## 🎮 Uso del Sistema

### Iniciar los Componentes

#### 1. Backend (Next.js)

```bash
cd Monitor_USB
npm run dev
```

#### 2. Servicio de Windows

**Modo Producción** (como servicio):

```bash
python usb_monitor_service.py start
```

**Modo Debug** (consola):

```bash
python usb_monitor_service.py debug
```

#### 3. Agente de Navegador

**Automático** (si está instalado en inicio):

- Se inicia al hacer login en Windows

**Manual** (con bandeja del sistema):

```bash
python usb_browser_agent.py --hidden
```

**Manual** (sin bandeja):

```bash
python usb_browser_agent.py
```

### Flujo de Uso Normal

1. **Conectar USB** → Sistema detecta automáticamente
2. **Navegador se abre** → Página de login con pcName
3. **Ingresar credenciales**:
   - **Usuario normal**: Ve mensaje "USB desbloqueado" y cierra
   - **Admin**: Accede al dashboard completo
4. **USB se desbloquea** → Puede leer y escribir

## 🔧 Gestión del Sistema

### Comandos del Servicio

```bash
# Instalar servicio
python usb_monitor_service.py install

# Iniciar servicio
python usb_monitor_service.py start

# Detener servicio
python usb_monitor_service.py stop

# Desinstalar servicio
python usb_monitor_service.py remove

# Modo debug (pruebas)
python usb_monitor_service.py debug
```

### Comandos del Agente de Navegador

```bash
# Instalar en inicio de Windows
python usb_browser_agent.py --install

# Desinstalar del inicio
python usb_browser_agent.py --uninstall

# Ejecutar en primer plano
python usb_browser_agent.py

# Ejecutar en bandeja del sistema
python usb_browser_agent.py --hidden
```

### Verificar Estado

#### Ver logs del servicio:

```powershell
Get-Content D:\Monitor_USB\usb_monitor.log -Tail 50
```

#### Ver logs del agente:

```powershell
Get-Content ~\usb_browser_agent.log -Tail 50
```

#### Verificar servicio está corriendo:

```powershell
Get-Service | Where-Object {$_.Name -like "*USB*"}
```

#### Verificar archivo de señal:

```powershell
Get-Content C:\ProgramData\USBMonitor\browser_signal.json
```

## 🐛 Troubleshooting

### Problema: El navegador no se abre

**Causas posibles:**

1. **Agente no está corriendo**

   ```bash
   # Verificar que el agente esté en la bandeja del sistema
   # O iniciar manualmente:
   python usb_browser_agent.py --hidden
   ```

2. **Archivo de señal no se crea**

   ```bash
   # Verificar permisos en C:/ProgramData/USBMonitor/
   # El servicio debe poder escribir ahí
   ```

3. **Señal expira antes de procesarse**
   ```bash
   # Las señales expiran en 5 minutos
   # Reconectar el USB para crear una nueva señal
   ```

**Solución:**

```bash
# Ver logs del agente
notepad %USERPROFILE%\usb_browser_agent.log

# Ver logs del servicio
notepad D:\Monitor_USB\usb_monitor.log
```

### Problema: USB no se bloquea

**Verificar:**

1. Servicio tiene privilegios de administrador
2. diskpart está disponible en el sistema
3. La unidad USB fue detectada correctamente

```bash
# Ejecutar en modo debug para ver errores
python usb_monitor_service.py debug
```

### Problema: USB no se desbloquea después de login

**Verificar:**

1. **Backend está corriendo**

   ```bash
   curl http://172.20.10.12:3000/api/health
   ```

2. **API Key es válida**

   ```powershell
   echo $env:USB_MONITOR_API_KEY
   ```

3. **Registro de pending_unlock existe**

   - Ver en dashboard admin → eventos USB

4. **Polling funciona**
   - Ver logs del servicio: debe mostrar "Esperando autorización..."

### Problema: Agente se instala pero no arranca al iniciar Windows

**Verificar registro de Windows:**

```powershell
Get-ItemProperty -Path "HKCU:\Software\Microsoft\Windows\CurrentVersion\Run" | Select-Object USBBrowserAgent
```

**Reinstalar:**

```bash
python usb_browser_agent.py --uninstall
python usb_browser_agent.py --install
```

### Problema: Error "pystray no disponible"

**Instalar dependencias faltantes:**

```bash
pip install pystray pillow
```

Si sigue sin funcionar, ejecutar sin bandeja:

```bash
python usb_browser_agent.py
```

## 📁 Archivos Importantes

### Ubicaciones

| Componente          | Ruta                                                |
| ------------------- | --------------------------------------------------- |
| Servicio Python     | `D:\Monitor_USB\scripts\usb_monitor_service.py`     |
| Agente de Navegador | `D:\Monitor_USB\scripts\usb_browser_agent.py`       |
| Instalador          | `D:\Monitor_USB\scripts\install_complete_system.py` |
| Log del Servicio    | `D:\Monitor_USB\usb_monitor.log`                    |
| Log del Agente      | `%USERPROFILE%\usb_browser_agent.log`               |
| Archivo de Señal    | `C:\ProgramData\USBMonitor\browser_signal.json`     |
| Base de Datos       | `D:\Monitor_USB\db\custom.db`                       |

### Formato del Archivo de Señal

```json
{
  "timestamp": "2025-10-01T15:30:45",
  "url": "http://172.20.10.12:3000/login?pcName=DESKTOP-ABC",
  "pc_name": "DESKTOP-ABC",
  "processed": false
}
```

## 🔐 Seguridad

### Permisos Requeridos

- **Servicio**: Requiere privilegios de Administrador (para diskpart)
- **Agente**: Corre con permisos del usuario (sesión interactiva)
- **Archivo de señal**: Lectura/escritura para ambos componentes

### Mejores Prácticas

1. **No compartir API Keys** públicamente
2. **Rotar API Keys** regularmente con `npx tsx scripts/rotateApiKey.ts`
3. **Monitorear logs** para detectar intentos no autorizados
4. **Actualizar contraseñas** de usuarios regularmente

## 📊 Monitoreo y Mantenimiento

### Logs Recomendados

**Servicio** (revisar diariamente):

```bash
# Ver últimas 100 líneas
Get-Content D:\Monitor_USB\usb_monitor.log -Tail 100
```

**Agente** (revisar semanalmente):

```bash
# Ver últimas 50 líneas
Get-Content ~\usb_browser_agent.log -Tail 50
```

### Limpieza de Archivos Temporales

```powershell
# Limpiar señales antiguas
Remove-Item C:\ProgramData\USBMonitor\browser_signal.json -ErrorAction SilentlyContinue

# Limpiar registros de desbloqueo expirados (hacer en backend)
# Se hace automáticamente, expiran en 10 minutos
```

## 🆘 Soporte

### Logs de Diagnóstico

Para reportar problemas, incluir:

1. **Logs del servicio**:

   ```bash
   Get-Content D:\Monitor_USB\usb_monitor.log -Tail 200 > diagnostico_servicio.txt
   ```

2. **Logs del agente**:

   ```bash
   Get-Content ~\usb_browser_agent.log -Tail 200 > diagnostico_agente.txt
   ```

3. **Variables de entorno**:

   ```bash
   Get-ChildItem Env: | Where-Object {$_.Name -like "USB_*"} > diagnostico_env.txt
   ```

4. **Estado del servicio**:
   ```bash
   Get-Service | Where-Object {$_.Name -like "*USB*"} > diagnostico_servicios.txt
   ```

## 📚 Referencias

- [Documentación del sistema de desbloqueo](README_UNLOCK_SYSTEM.md)
- [Guía paso a paso original](GUIA_PASO_A_PASO.md)
- [Scripts de gestión de usuarios](scripts/README_USB_MONITOR_SERVICE.md)

---

**Última actualización:** 1 de octubre de 2025
