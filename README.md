# 🔒 Sistema de Monitoreo USB

Un sistema completo para monitorear eventos de inserción de dispositivos USB en múltiples computadoras con bloqueo automático de sesión y panel de administración centralizado.

## 🎯 Características Principales

### 🔍 Monitoreo en Tiempo Real

- Detección instantánea de dispositivos USB conectados
- Bloqueo automático de sesión de Windows
- Notificaciones inmediatas al servidor central

### 📊 Panel de Administración

- Dashboard web con estadísticas en tiempo real
- Lista detallada de eventos USB
- Monitoreo de computadoras activas
- Auto-refresco cada 30 segundos

### 🗄️ Base de Datos Centralizada

- Almacenamiento de todos los eventos USB
- Registro de computadoras monitoreadas
- Historial completo con fechas y horas

### 🌐 Descubrimiento y Estado de Red (Nuevo)

- Escaneo de red (subred /24 local autodetectada o especificada) para encontrar hosts activos.
- Intento de detección de agente/servicio mediante petición HTTP a puerto 5001 (`/health`).
- Actualización de la tabla `computers` con flags `serviceInstalled`, `serviceRunning`, `lastServiceCheck`.
- Endpoint POST `/api/network-scan` para lanzar escaneo bajo demanda.

### 🛠️ Instalación Remota (Futuro)

- Endpoint POST `/api/remote-install` (placeholder) preparado para futura integración via WinRM/SSH o agente bootstrap.
- Devuelve 501 hasta que se implemente un canal seguro de despliegue.

## 🏗️ Arquitectura del Sistema

### Servidor Central (Next.js + SQLite)

- **Framework**: Next.js 15 con TypeScript
- **Base de Datos**: SQLite con Prisma ORM
- **UI**: shadcn/ui con Tailwind CSS
- **API**: Endpoints REST para eventos y computadoras

### Cliente Windows (Python)

- **Detección**: Monitoreo de dispositivos USB en tiempo real
- **Seguridad**: Bloqueo automático de sesión
- **Comunicación**: Envío de eventos al servidor central
- **Servicio**: Instalación como servicio de Windows

## 🚀 Configuración Rápida

### 1. Servidor Central

```bash
# Instalar dependencias
npm install

# Configurar base de datos
npm run db:push

# Iniciar servidor de desarrollo
npm run dev
```

Accede al panel en: `http://localhost:3000`

### 2. Cliente Windows

#### Requisitos

- Python 3.x
- Bibliotecas necesarias:
  ```bash
  pip install pywin32 requests pyinstaller
  ```

#### Configuración

1. Modifica el archivo `detector_usb_fixed.py`:

   ```python
   SERVER_URL = "http://IP_DEL_SERVIDOR:3000/api/usb-event"
   ```

2. Instala el servicio:

   ```bash
   python detector_usb_fixed.py --install
   ```

3. Inicia el servicio:
   ```bash
   net start USBMonitor
   ```

## 📋 API Endpoints (Autenticados)

Todos los endpoints (excepto `/api/auth/login`, `/api/auth/logout`, `/api/health`) requieren sesión válida (cookie HttpOnly `session`) o cabecera `Authorization: ApiKey <API_KEY>`.

- Autenticación:
  - `POST /api/auth/login` (username, password) -> crea cookie de sesión
  - `POST /api/auth/logout` -> invalida sesión
  - `POST /api/auth/apikey` -> rota API Key (sesión requerida)

La creación de usuarios vía HTTP ha sido deshabilitada. Usa los scripts CLI.

## 🔐 Login Web

Accede a `/login`, ingresa credenciales existentes. No hay opción de registro en UI (principio de superficie mínima). La sesión se maneja con cookie HttpOnly rotativa.

## 👤 Gestión de Usuarios (CLI)

Creación (sólo script, obliga a flujo controlado):

```powershell
npm run user:create -- <username> <password>
```

Listar:

```powershell
npm run user:list
```

Eliminar:

```powershell
npm run user:delete -- <username>
```

Rotar API Key:

```powershell
npm run user:rotate-key -- <username>
```

Usar API Key directamente para integraciones headless:

```powershell
curl -H "Authorization: ApiKey uk_xxx" "http://HOST:3000/api/network-scan" -X POST -H "Content-Type: application/json" -d '{}'
```

Regenerar API Key:

```powershell
curl -X POST "http://HOST:3000/api/auth/apikey" -H "Authorization: ApiKey uk_xxx"
```

### Eventos USB

- `POST /api/usb-event` - Recibir nuevos eventos
- `GET /api/usb-event` - Obtener lista de eventos

### Computadoras

- `GET /api/computers` - Obtener lista de computadoras

### Escaneo de Red

- `POST /api/network-scan` Body opcional `{ "cidr": "192.168.1.0/24" }`. Si se omite, autodetecta la primera interfaz IPv4 y asume `/24`.

### Instalación Remota (placeholder)

- `POST /api/remote-install` Body `{ "ip": "A.B.C.D" }` devuelve estado 501 hasta implementación.

## 🎨 Panel de Administración

### Estadísticas en Tiempo Real

- **Computadoras Activas**: Número de PCs monitoreadas
- **Eventos Totales**: Contador de eventos registrados
- **Eventos Recientes**: Eventos en la última hora
- **Última Actualización**: Hora del último refresco

### Gestión de Eventos

- Lista completa con detalles:
  - Nombre de computadora
  - Usuario de la sesión
  - Dirección IP
  - Tipo de evento
  - Fecha y hora exacta

### Monitoreo de Computadoras

- Estado de cada computadora (Activo/Inactivo)
- Última conexión registrada
- Dirección IP asignada
- Fecha de registro en el sistema

## 🔒 Características de Seguridad

- **Bloqueo Automático**: La sesión se bloquea instantáneamente al detectar un USB
- **Registro Completo**: Todos los eventos se almacenan con información detallada
- **Monitoreo Continuo**: Las computadoras reportan su estado regularmente
- **Auditoría**: Historial completo de eventos para análisis

## 🛠️ Comandos del Cliente Windows

```bash
# Instalar servicio
python detector_usb_fixed.py --install

# Desinstalar servicio
python detector_usb_fixed.py --uninstall

# Probar conexión
python detector_usb_fixed.py --test

# Ejecutar en modo normal (para pruebas)
python detector_usb_fixed.py

# Ver ayuda
python detector_usb_fixed.py --help
```

## 📊 Estructura de la Base de Datos

### Tabla `usb_events`

- `id`: Identificador único del evento
- `pcName`: Nombre de la computadora
- `pcIp`: Dirección IP de la computadora
- `pcUser`: Usuario de la sesión
- `event`: Descripción del evento
- `timestamp`: Fecha y hora del evento
- `createdAt`: Fecha de creación del registro

### Tabla `computers`

- `id`: Identificador único
- `name`: Nombre de la computadora
- `ipAddress`: Dirección IP
- `lastSeen`: Última conexión detectada
- `isActive`: Estado de actividad
- `serviceInstalled`: (bool) si el escaneo detectó endpoint saludable
- `serviceRunning`: (bool) si responde en el momento del escaneo
- `lastServiceCheck`: Fecha/hora del último intento de verificación
- `createdAt`: Fecha de registro
- `updatedAt`: Fecha de última actualización

## 🔧 Personalización

### Cambiar Intervalo de Actualización

Modifica en `src/app/page.tsx`:

```javascript
const interval = setInterval(fetchData, 30000); // Cambiar 30000 por el tiempo deseado en ms
```

### Modificar URL del Servidor

En el script Python, cambia:

```python
SERVER_URL = "http://nueva-ip:3000/api/usb-event"
```

### Personalizar Interfaz

- Componentes en `src/components/ui/`
- Estilos en `src/app/globals.css`
- Configuración en `tailwind.config.ts`

## 🚨 Solución de Problemas

### Problemas Comunes

1. **El servicio no se instala**: Ejecutar como administrador
2. **Los eventos no llegan**: Verificar la URL del servidor y conectividad de red
3. **El dashboard no se actualiza**: Revisar la consola del navegador por errores

### Verificación de Conexión

```bash
# Probar conexión desde el cliente
python detector_usb_fixed.py --test

# Verificar estado del servicio
sc query USBMonitor
```

## 📋 Requisitos del Sistema

### Servidor

- Node.js 18+
- 512MB RAM mínimo
- 1GB espacio en disco

### Cliente Windows

- Windows 7/8/10/11
- Python 3.7+
- 256MB RAM
- Permisos de administrador

## 📄 Documentación Adicional

Para más detalles, consulta:

- [Guía Completa de Configuración](USB_MONITORING_GUIDE.md)
- [Script Python Corregido](detector_usb_fixed.py)

---

🔒 **Mantén tu infraestructura segura con monitoreo USB proactivo**

## ℹ️ Nota sobre URLs de Desarrollo

Se ha reemplazado la IP fija `172.20.10.12` por `http://localhost:3000` para el entorno de desarrollo en los siguientes archivos:

- `server.ts` (host de escucha)
- `config.json` (server_url)
- `detector_usb_fixed.py`
- `detector_usb_fixed copy.py`

Si ves referencias a la IP antigua en `dist/` (logs o `dist/config.json`), son artefactos previos. Regenera el build o actualiza esos archivos manualmente si es necesario.

Para desplegar en red ahora puedes usar variables de entorno sin tocar código:

```
SERVER_HOST=0.0.0.0
SERVER_PORT=3000
```

El archivo `server.ts` prioriza `PORT`, luego `SERVER_PORT` y como fallback 3000. Para el host usa `SERVER_HOST`, luego `HOST`, finalmente `localhost`.

Consulta `.env.example` para una plantilla rápida.
