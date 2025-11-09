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
- Motor PostgreSQL 18 con Prisma ORM

### 🌐 Descubrimiento y Estado de Red (Nuevo)

- Escaneo de red (subred /24 local autodetectada o especificada) para encontrar hosts activos.
- Intento de detección de agente/servicio mediante petición HTTP a puerto 5001 (`/health`).
- Actualización de la tabla `computers` con flags `serviceInstalled`, `serviceRunning`, `lastServiceCheck`.
- Endpoint POST `/api/network-scan` para lanzar escaneo bajo demanda.

### �️ Whitelist Automática de Dispositivos (Nuevo)

- Registra seriales autorizados desde el dashboard con alias y notas.
- El agente de Windows consulta la whitelist antes de bloquear un USB.
- Las memorias aprobadas se habilitan de inmediato sin intervención manual.
- Eventos y estadísticas incluyen dispositivos whitelisted para auditoría rápida.

### �🛠️ Instalación Remota (Futuro)

- Endpoint POST `/api/remote-install` (placeholder) preparado para futura integración via WinRM/SSH o agente bootstrap.
- Devuelve 501 hasta que se implemente un canal seguro de despliegue.

## 🏗️ Arquitectura del Sistema

### Servidor Central (Next.js + PostgreSQL)

- **Framework**: Next.js 15 con TypeScript
- **Base de Datos**: PostgreSQL 18+ con Prisma ORM
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

# Crear bases de datos en PostgreSQL (principal y shadow para Prisma)
createdb monitor_usb
createdb monitor_usb_shadow

# Asegúrate de actualizar las credenciales en .env antes de migrar

# Aplicar migraciones (incluye whitelist)
npm run db:migrate

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

Todos los endpoints (excepto `/api/auth/login`, `/api/auth/logout`, `/api/auth/register`, `/api/health`) requieren sesión válida (cookie HttpOnly `session`) o cabecera `Authorization: ApiKey <API_KEY>`.

### Autenticación

- `POST /api/auth/login` (username, password) -> crea cookie de sesión
  - Rate limiting: 30 intentos por IP/5min, 5 por usuario/5min
  - Bloqueo automático tras 7 intentos fallidos (15 minutos)
  - Usuarios con rol "user" solo pueden acceder desde su computadora asignada
- `POST /api/auth/logout` -> invalida sesión
- `POST /api/auth/register` (username, password) -> crea nuevo usuario (⚠️ sin autenticación, considerar deshabilitar en producción)
- `POST /api/auth/apikey` -> rota API Key (sesión requerida)
- `GET /api/auth/session` -> obtiene información del usuario actual y renueva sesión
- `POST /api/auth/extend` -> extiende sesión con TTL personalizado (body opcional: `{ "ttlSeconds": 7200 }`)
- `HEAD|GET /api/auth/ping` -> verificación ligera de sesión (200 OK o 401)

## 🔐 Login Web

### Para Administradores

Accede a `/login`, ingresa credenciales de administrador. Serás redirigido al dashboard principal con acceso completo a todas las computadoras, eventos y configuración.

### Para Usuarios Normales

Los usuarios con rol "user" tienen restricciones adicionales:

- Solo pueden iniciar sesión desde su computadora asignada (verificado por hostname)
- Son redirigidos a `/unlocked` tras el login
- Ven únicamente los eventos y dispositivos USB de su computadora asignada
- Pueden autorizar el desbloqueo de sus propios dispositivos USB pendientes

La sesión se maneja con cookie HttpOnly rotativa con:

- TTL por defecto de 1 hora
- Renovación automática (sliding sessions)
- Soporte para rotación de claves (múltiples secrets)
- Rehashing progresivo de passwords antiguos a Argon2

## 👤 Gestión de Usuarios (CLI)

Creación de usuarios (con parámetros opcionales):

```powershell
# Crear usuario básico (rol: user por defecto)
npm run user:create -- <username> <password>

# Crear con apiKey específica (opcional)
npm run user:create -- <username> <password> <apiKey>

# Crear con rol (user o admin)
npm run user:create -- <username> <password> <apiKey> <role>

# Crear y asignar computadora
npm run user:create -- <username> <password> <apiKey> <role> <computerName>
```

Asignar computadora a usuario:

```powershell
npm run user:assign-computer -- <username> <computerName>
```

Listar usuarios:

```powershell
npm run user:list
```

Eliminar usuario:

```powershell
npm run user:delete -- <username>
```

Rotar API Key:

```powershell
npm run user:rotate-key -- <username>
```

Listar computadoras registradas:

```powershell
npm run computer:list
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

- `POST /api/usb-event` - Recibir nuevos eventos (sin autenticación para agentes)
- `GET /api/usb-event` - Obtener lista de eventos (últimos 50)
- `GET /api/usb-event/user-devices` - Eventos y USBs de la computadora asignada al usuario
- `POST /api/usb-event/authorize` - Autorizar desbloqueo de USB específico (body: `{ "driveLetter": "E:" }`)
- `GET /api/usb-event/pending-unlock` - Obtener desbloqueos pendientes
- `POST /api/usb-event/connected-status` - Enviar estado de USBs conectados (desde agente)

### Computadoras

- `GET /api/computers` - Obtener lista de computadoras registradas

### Escaneo de Red

- `POST /api/network-scan` Body opcional `{ "cidr": "192.168.1.0/24" }`. Si se omite, autodetecta la primera interfaz IPv4 y asume `/24`.

### Whitelist de Dispositivos

- `GET /api/whitelist` (admin) - Lista seriales autorizados con metadatos.
- `POST /api/whitelist` (admin) - Agrega un serial con alias/notas.
- `PATCH /api/whitelist/:id` (admin) - Actualiza alias o notas.
- `DELETE /api/whitelist/:id` (admin) - Elimina un serial.
- `GET /api/whitelist/check?serial=XYZ` - Verificación rápida (sesión o API Key), usada por el agente.

### Instalación y Control Remoto de Servicios

- `POST /api/remote-install` - Instalar agente en computadora remota (body: `{ "ip": "A.B.C.D" }`)
- `POST /api/service/install` - Instalar servicio USB en host remoto
- `POST /api/service/uninstall` - Desinstalar servicio
- `POST /api/service/start` - Iniciar servicio
- `POST /api/service/stop` - Detener servicio
- `POST /api/service/status` - Consultar estado del servicio
- `POST /api/service/refresh-host` - Actualizar información de host específico

Todos los endpoints de `/api/service/` requieren body con `{ "ip": "A.B.C.D" }`.

## 🎨 Panel de Administración

### Estadísticas en Tiempo Real

- **Computadoras Activas**: Número de PCs monitoreadas
- **Eventos Totales**: Contador de eventos registrados
- **Eventos Recientes**: Eventos en la última hora
- **Última Actualización**: Hora del último refresco
- **Whitelist Activa**: Seriales permitidos cargados desde el panel

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

### Whitelist de Dispositivos

- Alta rápida de seriales con alias y notas descriptivas.
- Eliminación inmediata de dispositivos revocados.
- Vista tabular con creador, fecha de alta y observaciones.
- Integración directa con el agente: los seriales listados se desbloquean automáticamente.

## 🔒 Características de Seguridad

### En el Cliente (Agente Windows)

- **Bloqueo Automático**: La sesión se bloquea instantáneamente al detectar un USB no autorizado
- **Protección Preventiva**: Unidades USB se configuran en modo solo lectura antes de bloquear
- **Whitelist Dinámica**: El servicio consulta el backend antes de bloquear, permitiendo dispositivos autorizados sin intervención
- **Normalización de Seriales**: Limpieza y validación robusta de números de serie de dispositivos
- **Monitoreo Continuo**: Reporte periódico de dispositivos conectados y estado del servicio
- **Servidor HTTP Embebido**: Endpoint `/health` en puerto 5001 para verificaciones de estado

### En el Servidor (Backend)

- **Autenticación Multi-Factor**:
  - Sesiones basadas en cookies HttpOnly firmadas con HMAC
  - API Keys para integraciones headless
  - Rotación de secretos de sesión (soporte para múltiples claves)
- **Rate Limiting Avanzado**:
  - 30 intentos de login por IP cada 5 minutos
  - 5 intentos por usuario cada 5 minutos
  - Delays simulados para prevenir timing attacks
- **Protección de Cuentas**:
  - Bloqueo automático tras 7 intentos fallidos (15 minutos)
  - Rehashing progresivo de passwords antiguos a Argon2
  - Contador de intentos fallidos por usuario
- **Control de Acceso Basado en Roles**:
  - Administradores: acceso completo al sistema
  - Usuarios normales: restringidos a su computadora asignada
  - Validación de hostname en login para usuarios normales
- **Auditoría Completa**:
  - Registro de todos los eventos USB con timestamps
  - Historial de conexiones/desconexiones de dispositivos
  - Tracking de desbloqueos autorizados y pendientes
  - Logs de verificaciones de whitelist
- **Sesiones Seguras**:
  - TTL configurable (por defecto 1 hora, máximo 4 horas)
  - Renovación automática (sliding sessions)
  - Revocación inmediata en logout

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
- `name`: Nombre de la computadora (único)
- `ipAddress`: Dirección IP
- `lastSeen`: Última conexión detectada
- `isActive`: Estado de actividad
- `serviceInstalled`: (bool) si el escaneo detectó endpoint saludable
- `serviceRunning`: (bool) si responde en el momento del escaneo
- `lastServiceCheck`: Fecha/hora del último intento de verificación
- `agentVersion`: Versión del ejecutable/agente (opcional)
- `createdAt`: Fecha de registro
- `updatedAt`: Fecha de última actualización
- Relación: `users` (usuarios asignados a esta computadora)

### Tabla `usb_whitelist`

- `id`: Identificador único
- `serialNumber`: Serial normalizado del dispositivo (único)
- `label`: Alias descriptivo opcional
- `notes`: Comentarios o restricciones
- `createdAt` / `updatedAt`: Timestamps automáticos
- `createdById`: Usuario que autorizó el serial (nullable)

### Tabla `users`

- `id`: Identificador único
- `username`: Nombre de usuario (único)
- `passwordHash`: Hash Argon2 de la contraseña
- `apiKey`: Clave API para autenticación headless (única)
- `role`: Rol del usuario ("admin" o "user")
- `computerId`: ID de la computadora asignada (nullable)
- `failedAttempts`: Contador de intentos fallidos de login
- `lockedUntil`: Fecha hasta la cual la cuenta está bloqueada (nullable)
- `createdAt` / `updatedAt`: Timestamps automáticos
- Relación: `computer` (computadora asignada), `whitelistEntries` (seriales autorizados)

### Tabla `usb_connections`

- `id`: Identificador único
- `pcName`: Nombre de la computadora
- `driveLetter`: Letra de unidad asignada
- `volumeName`: Nombre del volumen
- `serialNumber`: Serial del dispositivo USB
- `model`: Modelo del dispositivo
- `size`: Tamaño en bytes (BigInt)
- `connectedAt`: Fecha/hora de conexión
- `disconnectedAt`: Fecha/hora de desconexión (nullable)
- `lastSeen`: Última vez detectado conectado
- `isConnected`: Estado actual de conexión (bool)

### Tabla `pending_unlocks`

- `id`: Identificador único
- `pcName`: Nombre de la computadora
- `driveLetter`: Letra de unidad a desbloquear
- `createdAt`: Fecha de creación de la solicitud
- `expiresAt`: Fecha de expiración
- `unlocked`: Si ya fue desbloqueado (bool)

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
