# Sistema de Desbloqueo USB con Autenticación

## 📋 Descripción General

Este sistema implementa un flujo completo de seguridad para dispositivos USB que incluye:

1. **Detección automática** de dispositivos USB
2. **Protección inmediata** en modo solo lectura
3. **Autenticación de usuario** para desbloquear
4. **Sistema de roles** (Admin/Usuario)

## 🔐 Flujo de Funcionamiento

### 1. Conexión de USB

Cuando se conecta un dispositivo USB:

```
┌─────────────────────────────────────────────────────────────┐
│ 1. Usuario conecta USB                                      │
│ 2. Servicio detecta el evento (Win32_VolumeChangeEvent)    │
│ 3. Aplica readonly con diskpart                            │
│ 4. Envía evento al backend                                 │
│ 5. Crea registro de "pending unlock"                       │
│ 6. Abre navegador en /login?pcName=NOMBRE_PC               │
└─────────────────────────────────────────────────────────────┘
```

### 2. Autenticación y Desbloqueo

El usuario ve la página de login con dos posibles resultados según su rol:

#### **Usuario Normal (role: "user")**

- Ingresa credenciales válidas
- El sistema desbloquea el USB automáticamente
- Muestra mensaje de éxito: "Tu memoria USB ha sido desbloqueada"
- Puede cerrar la ventana del navegador
- **NO** accede al dashboard

#### **Usuario Administrador (role: "admin")**

- Ingresa credenciales válidas
- El sistema desbloquea el USB automáticamente
- Es redirigido al dashboard completo
- Puede gestionar eventos, computadoras, etc.

### 3. Proceso de Desbloqueo en el Backend

```
┌─────────────────────────────────────────────────────────────┐
│ 1. Servicio hace polling cada 3 segundos                   │
│    GET /api/usb-unlock/status?pcName=XXX                   │
│                                                             │
│ 2. Usuario se autentica en login                           │
│    POST /api/auth/login { username, password }             │
│                                                             │
│ 3. Si hay pcName, se llama a desbloqueo                    │
│    POST /api/usb-unlock { pcName }                         │
│                                                             │
│ 4. Backend marca el unlock como autorizado                 │
│    UPDATE pending_unlocks SET unlocked = true              │
│                                                             │
│ 5. Servicio recibe confirmación en el polling              │
│    { unlocked: true, driveLetter: "E:" }                   │
│                                                             │
│ 6. Servicio ejecuta diskpart para quitar readonly          │
│    diskpart: attributes volume clear readonly              │
│                                                             │
│ 7. Envía evento de desbloqueo exitoso al backend           │
└─────────────────────────────────────────────────────────────┘
```

## 🗄️ Estructura de Base de Datos

### Tabla: `User`

```sql
- id: String (Primary Key)
- username: String (Unique)
- passwordHash: String
- apiKey: String (Unique)
- role: String (default: "user") -- "admin" o "user"
- createdAt: DateTime
- updatedAt: DateTime
- failedAttempts: Int
- lockedUntil: DateTime?
```

### Tabla: `PendingUnlock`

```sql
- id: String (Primary Key)
- pcName: String -- Nombre del PC que detectó el USB
- driveLetter: String -- Letra de unidad (E:, F:, etc.)
- createdAt: DateTime
- expiresAt: DateTime -- Expira en 10 minutos
- unlocked: Boolean (default: false)
```

## 🔧 Configuración

### Variables de Entorno del Servicio Python

```bash
USB_MONITOR_SERVER_HOST=172.20.10.12  # Host del backend
USB_MONITOR_SERVER_PORT=3000          # Puerto del backend
USB_MONITOR_API_KEY=uk_xxxxx          # API Key para autenticación
USB_MONITOR_LOG_PATH=D:/Monitor_USB/  # Ruta del log
```

### Crear Usuarios

#### Usuario Normal

```bash
npx tsx scripts/createUser.ts juan password123 "" user
```

#### Usuario Administrador

```bash
npx tsx scripts/createUser.ts admin admin123 "" admin
```

## 📡 Endpoints API

### POST /api/usb-event/pending-unlock

Crea un registro de desbloqueo pendiente cuando se detecta un USB.

**Request:**

```json
{
  "pcName": "DESKTOP-ABC123",
  "driveLetter": "E:"
}
```

**Response:**

```json
{
  "ok": true,
  "id": "clxxx",
  "message": "Desbloqueo pendiente creado"
}
```

### GET /api/usb-unlock/status?pcName=XXX

Verifica si hay un desbloqueo autorizado para una PC.

**Response:**

```json
{
  "ok": true,
  "unlocked": true,
  "driveLetter": "E:"
}
```

### POST /api/usb-unlock

Autoriza el desbloqueo de un USB después de autenticación exitosa.

**Request:**

```json
{
  "pcName": "DESKTOP-ABC123"
}
```

**Response:**

```json
{
  "ok": true,
  "role": "user",
  "driveLetter": "E:",
  "message": "USB desbloqueado correctamente"
}
```

## 🚀 Instalación del Servicio

1. **Instalar dependencias Python:**

```bash
cd scripts
pip install -r usb_monitor_requirements.txt
```

2. **Configurar variables de entorno:**

```bash
# En Windows, configurar variables de sistema:
setx USB_MONITOR_API_KEY "uk_xxxxx" /M
setx USB_MONITOR_SERVER_HOST "172.20.10.12" /M
```

3. **Instalar servicio:**

```bash
python usb_monitor_service.py install
```

4. **Iniciar servicio:**

```bash
python usb_monitor_service.py start
```

## 🧪 Pruebas

### Prueba Manual del Flujo Completo

1. Asegurarse de que el backend esté corriendo:

   ```bash
   npm run dev
   ```

2. Iniciar el servicio en modo debug:

   ```bash
   python usb_monitor_service.py debug
   ```

3. Conectar un dispositivo USB

4. Observar que:

   - El log muestra la detección
   - Se abre el navegador automáticamente
   - El USB está en modo readonly (no se puede escribir)

5. Iniciar sesión con un usuario normal:

   - Usar credenciales de usuario normal
   - Verificar que aparece el mensaje de desbloqueo
   - Intentar escribir en el USB (ahora debería permitirlo)

6. Probar con usuario admin:
   - Usar credenciales de admin
   - Verificar que redirige al dashboard

## 🔒 Seguridad

### Protecciones Implementadas

1. **Rate Limiting**: Límite de intentos de login
2. **Account Lockout**: Bloqueo temporal tras múltiples fallos
3. **API Key**: Autenticación del servicio al backend
4. **Timeout de Desbloqueo**: Los registros expiran en 10 minutos
5. **Validación de Sesión**: Solo usuarios autenticados pueden desbloquear

### Consideraciones

- El desbloqueo es **irreversible** hasta que se desconecte el USB
- Solo se puede desbloquear un USB que esté **actualmente pendiente**
- El servicio debe ejecutarse con **privilegios de administrador**

## 📊 Monitoreo

### Logs del Servicio

Ubicación: `D:/Monitor_USB/usb_monitor.log`

Eventos registrados:

- Detección de USB
- Aplicación de readonly
- Envío de eventos al backend
- Apertura de navegador
- Autorización de desbloqueo
- Remoción de readonly

### Dashboard

Los administradores pueden ver en el dashboard:

- Todos los eventos USB
- Estado de las computadoras
- Historial de desbloqueos

## 🆘 Troubleshooting

### El USB no se bloquea

- Verificar que el servicio tiene privilegios de administrador
- Revisar logs para errores de diskpart
- Confirmar que la letra de unidad se detectó correctamente

### El navegador no se abre

- Verificar configuración de HOST y PORT
- Revisar logs para excepciones de webbrowser
- Intentar abrir manualmente: `http://SERVER:3000/login?pcName=NOMBRE_PC`

### El desbloqueo no funciona

- Verificar que hay conectividad al backend
- Confirmar que el API Key es válido
- Revisar que el registro de pending_unlock existe y no expiró

### Error "No hay desbloqueos pendientes"

- El registro expiró (>10 minutos)
- Reconectar el USB para crear uno nuevo
- Verificar que pcName coincide exactamente

## 📝 Notas de Desarrollo

### Arquitectura

El sistema usa una arquitectura **cliente-servidor** con **polling**:

- **Servicio Windows (Python)**: Cliente que detecta eventos y ejecuta comandos
- **Backend Next.js**: Servidor que gestiona autenticación y estado
- **Base de Datos SQLite**: Almacena usuarios y registros de desbloqueo

### Alternativas Consideradas

1. **WebSockets**: Descartado por complejidad en servicios Windows
2. **Desbloqueo manual en dashboard**: Descartado por UX (requiere admin siempre)
3. **Sin autenticación**: Descartado por seguridad

## 🔄 Próximas Mejoras

- [ ] Notificaciones push en lugar de polling
- [ ] Dashboard en tiempo real con WebSockets
- [ ] Registro de auditoría detallado
- [ ] Políticas de desbloqueo por usuario/dispositivo
- [ ] Integración con Active Directory
