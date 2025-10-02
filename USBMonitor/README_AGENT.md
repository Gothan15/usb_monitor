# USB Monitor Agent - Aplicación de Usuario

Aplicación Windows con interfaz gráfica para autenticación de usuarios en el sistema USB Monitor.

## 📋 Descripción

El **USB Monitor Agent** es una aplicación que se ejecuta en segundo plano en Windows y muestra un formulario de login cuando se detecta la conexión de una unidad USB. Permite al usuario autenticarse para desbloquear la unidad USB que ha sido protegida en modo solo lectura por el servicio.

### Características

- ✅ **Ejecución en segundo plano**: Se ejecuta en la bandeja del sistema (system tray)
- ✅ **Inicio automático**: Se puede configurar para iniciar con Windows
- ✅ **Interfaz gráfica amigable**: Formulario de login moderno y fácil de usar
- ✅ **Comunicación con el servicio**: Se comunica mediante archivos de señal
- ✅ **Validación con el servidor**: Verifica las credenciales con el backend
- ✅ **Manejo de errores**: Muestra mensajes claros de error al usuario
- ✅ **Logging completo**: Registra todas las acciones en un archivo de log

## 🔧 Requisitos

### Dependencias Python

```bash
pip install pillow pystray requests
```

- **pillow**: Para crear el icono de la bandeja del sistema
- **pystray**: Para mostrar el icono en la bandeja del sistema
- **requests**: Para comunicarse con el backend

### Sistema Operativo

- Windows 7 o superior
- Python 3.7 o superior

## 📦 Instalación

### 1. Instalar dependencias

```powershell
pip install pillow pystray requests
```

### 2. Instalar el agente en el inicio de Windows

#### Método 1: Registro de Windows (recomendado)

```powershell
python install_agent.py install
```

Este método añade una entrada en el registro de Windows para que el agente se inicie automáticamente al iniciar sesión.

#### Método 2: Carpeta de inicio (alternativo)

```powershell
python install_agent.py install-alt
```

Este método crea un archivo `.bat` en la carpeta de inicio del usuario.

### 3. Verificar la instalación

```powershell
python install_agent.py status
```

### 4. Iniciar el agente manualmente (sin reiniciar)

```powershell
python usb_monitor_agent.py
```

## 🚀 Uso

### Inicio Automático

Una vez instalado, el agente se iniciará automáticamente cuando inicies sesión en Windows. Verás un pequeño icono en la bandeja del sistema (junto al reloj).

### Flujo de Trabajo

1. **Conexión USB**: El usuario conecta una unidad USB
2. **Protección automática**: El servicio `USBMonitorService` establece la unidad en modo solo lectura
3. **Señal al agente**: El servicio crea una señal para que el agente muestre el formulario de login
4. **Autenticación**: El agente muestra la ventana de login en primer plano
5. **Validación**: El usuario introduce sus credenciales y el agente las valida con el servidor
6. **Desbloqueo**: Si las credenciales son válidas, el servidor autoriza el desbloqueo y el servicio remueve la protección de solo lectura
7. **Acceso completo**: El usuario puede usar la unidad USB con permisos de escritura

### Ventana de Login

Cuando el agente detecta una señal del servicio, muestra una ventana de login con:

- **Información del PC**: Nombre del equipo y letra de unidad USB
- **Campo de usuario**: Para introducir el nombre de usuario
- **Campo de contraseña**: Para introducir la contraseña (oculta)
- **Botón "Desbloquear"**: Envía las credenciales para validación
- **Botón "Cancelar"**: Cierra la ventana sin desbloquear

### Mensajes de Estado

La ventana muestra diferentes mensajes según el resultado:

- ✅ **"USB X: desbloqueado correctamente"**: Autenticación exitosa
- ❌ **"Usuario o contraseña incorrectos"**: Credenciales inválidas
- ❌ **"Error: No se puede conectar al servidor"**: El backend no está disponible
- ❌ **"Timeout: El servidor no responde"**: El servidor tardó demasiado en responder

## ⚙️ Configuración

### Variables de Entorno

El agente utiliza las mismas variables de entorno que el servicio:

```powershell
# Host del servidor (por defecto: 172.20.10.12)
$env:USB_MONITOR_SERVER_HOST = "192.168.1.100"

# Puerto del servidor (por defecto: 3000)
$env:USB_MONITOR_SERVER_PORT = "8080"

# API Key para autenticación (opcional)
$env:USB_MONITOR_API_KEY = "tu-api-key-aqui"
```

### Archivos de Configuración

- **Archivo de señal**: `C:\ProgramData\USBMonitor\browser_signal.json`

  - Usado por el servicio para comunicarse con el agente
  - Contiene información sobre el PC y la unidad USB detectada

- **Archivo de log**: `C:\ProgramData\USBMonitor\agent.log`
  - Registra todas las acciones del agente
  - Útil para diagnóstico y debugging

## 🔍 Solución de Problemas

### El agente no se inicia automáticamente

1. Verifica la instalación:

   ```powershell
   python install_agent.py status
   ```

2. Reinstala el agente:

   ```powershell
   python install_agent.py uninstall
   python install_agent.py install
   ```

3. Verifica que el script existe en la ruta correcta

### La ventana de login no aparece

1. Verifica que el agente está en ejecución (debe haber un icono en la bandeja del sistema)

2. Revisa el archivo de log:

   ```powershell
   notepad C:\ProgramData\USBMonitor\agent.log
   ```

3. Verifica que el archivo de señal se está creando:
   ```powershell
   dir C:\ProgramData\USBMonitor\browser_signal.json
   ```

### Error "No se puede conectar al servidor"

1. Verifica que el backend está en ejecución

2. Verifica la configuración del host y puerto:

   ```powershell
   echo $env:USB_MONITOR_SERVER_HOST
   echo $env:USB_MONITOR_SERVER_PORT
   ```

3. Prueba la conexión manualmente:
   ```powershell
   curl http://172.20.10.12:3000/api/auth/login
   ```

### Las credenciales no se validan correctamente

1. Verifica que el backend está configurado correctamente

2. Revisa el archivo de log del agente para ver el error específico

3. Prueba las credenciales directamente en el backend

## 🗑️ Desinstalación

Para desinstalar el agente del inicio de Windows:

```powershell
python install_agent.py uninstall
```

Para detener el agente en ejecución:

1. Haz clic derecho en el icono de la bandeja del sistema
2. Selecciona "Salir"

## 📝 Arquitectura

### Componentes

1. **USBMonitorAgent**: Clase principal que gestiona el agente

   - Monitorea archivos de señal
   - Controla el icono de la bandeja del sistema
   - Lanza la ventana de login cuando es necesario

2. **LoginWindow**: Clase que gestiona la ventana de login

   - Interfaz gráfica con tkinter
   - Validación de credenciales
   - Comunicación con el backend

3. **Monitor de señales**: Thread que monitorea el archivo de señal
   - Polling cada 2 segundos
   - Detecta nuevas señales del servicio
   - Evita procesar señales duplicadas

### Comunicación

```
[Servicio USB Monitor]
    ↓ (crea señal)
[Archivo de señal: browser_signal.json]
    ↓ (detecta señal)
[USB Monitor Agent]
    ↓ (muestra ventana)
[Usuario introduce credenciales]
    ↓ (envía POST)
[Backend API /api/auth/login]
    ↓ (responde con token)
[Agent autoriza: /api/usb-unlock/authorize]
    ↓ (consulta estado)
[Servicio USB Monitor]
    ↓ (remueve readonly)
[Unidad USB desbloqueada]
```

## 🔐 Seguridad

- Las contraseñas se envían de forma segura al backend (considera usar HTTPS en producción)
- El agente no almacena credenciales en disco
- Los logs no contienen contraseñas
- La ventana de login se muestra siempre en primer plano para evitar phishing

## 📄 Licencia

Este software es parte del sistema USB Monitor y está sujeto a los mismos términos de licencia.

## 🤝 Soporte

Para reportar problemas o solicitar ayuda:

1. Revisa el archivo de log: `C:\ProgramData\USBMonitor\agent.log`
2. Contacta al administrador del sistema
3. Consulta la documentación del backend

---

**Nota**: Este agente debe usarse en conjunto con el servicio `USBMonitorService` y el backend correspondiente para funcionar correctamente.
