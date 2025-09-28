# Sistema de Monitoreo USB

Este sistema permite monitorear eventos de inserción de dispositivos USB en múltiples computadoras y centralizar las notificaciones en un panel de administración.

## Arquitectura del Sistema

### Componentes

1. **Servidor Central (Next.js + SQLite)**
   - Dashboard web para el administrador
   - API REST para recibir eventos
   - Base de datos SQLite para almacenar eventos y computadoras

2. **Cliente Windows (Script Python)**
   - Servicio de Windows que detecta inserción de USB
   - Bloquea la sesión automáticamente
   - Envía notificación al servidor central

## Configuración

### 1. Servidor Central

El servidor ya está configurado con:
- Next.js 15 con TypeScript
- Base de datos SQLite
- API endpoints:
  - `POST /api/usb-event` - Recibe eventos USB
  - `GET /api/usb-event` - Obtiene lista de eventos
  - `GET /api/computers` - Obtiene lista de computadoras

### 2. Configuración del Script Python

Modifica el archivo `detector_usb.py` para que apunte a tu servidor:

```python
# Cambia esta línea por la IP de tu servidor
SERVER_URL = "http://192.168.1.100:5000/evento_usb"
```

**Nota importante:** La URL en el script Python debe coincidir con el endpoint de tu API:
- Si tu servidor corre en `http://localhost:3000`, usa:
  ```python
  SERVER_URL = "http://localhost:3000/api/usb-event"
  ```

### 3. Instalación del Servicio Windows

Para instalar el servicio en una computadora Windows:

```bash
# Instalar el servicio
python detector_usb.py --install

# Desinstalar el servicio
python detector_usb.py --uninstall
```

## Uso

### Panel de Administración

Accede al dashboard en `http://localhost:3000` para ver:

1. **Estadísticas en tiempo real:**
   - Computadoras activas
   - Total de eventos
   - Eventos recientes (última hora)
   - Última actualización

2. **Eventos USB:**
   - Lista completa de eventos detectados
   - Información detallada por evento:
     - Computadora
     - Usuario
     - Dirección IP
     - Tipo de evento
     - Fecha y hora

3. **Computadoras Monitoreadas:**
   - Lista de computadoras con el servicio instalado
   - Estado (activo/inactivo)
   - Última conexión
   - Fecha de registro

### Funcionamiento del Sistema

1. **Detección de USB:**
   - El servicio Windows detecta cuando se inserta un dispositivo USB
   - Automáticamente bloquea la sesión de Windows
   - Envía un evento al servidor central

2. **Almacenamiento:**
   - El servidor guarda el evento en la base de datos
   - Actualiza el estado de la computadora como activa
   - Registra la fecha y hora del evento

3. **Visualización:**
   - El dashboard se actualiza automáticamente cada 30 segundos
   - Muestra los eventos más recientes primero
   - Permite filtrar y ver detalles

## Base de Datos

### Esquema

#### Tabla `usb_events`
- `id`: Identificador único
- `pcName`: Nombre de la computadora
- `pcIp`: Dirección IP
- `pcUser`: Usuario de la sesión
- `event`: Tipo de evento (ej: "USB insertado")
- `timestamp`: Fecha y hora del evento
- `createdAt`: Fecha de creación del registro

#### Tabla `computers`
- `id`: Identificador único
- `name`: Nombre de la computadora (único)
- `ipAddress`: Dirección IP
- `lastSeen`: Última conexión detectada
- `isActive`: Estado de actividad
- `createdAt`: Fecha de registro
- `updatedAt`: Fecha de última actualización

## Requisitos

### Servidor
- Node.js 18+
- Next.js 15
- SQLite
- Prisma

### Cliente Windows
- Python 3.x
- Bibliotecas Python:
  - pywin32
  - requests
  - pyinstaller (para crear ejecutable)

## Seguridad

- El sistema bloquea automáticamente la sesión cuando se detecta un USB
- Todas las conexiones se registran con dirección IP y usuario
- Los eventos se almacenan con marca de tiempo precisa

## Personalización

### Cambiar intervalo de actualización
En el archivo `src/app/page.tsx`, modifica la línea:
```javascript
const interval = setInterval(fetchData, 30000); // 30 segundos
```

### Modificar diseño
El dashboard utiliza componentes de shadcn/ui. Puedes personalizar:
- Colores en `tailwind.config.ts`
- Componentes en `src/components/ui/`
- Estilos globales en `src/app/globals.css`

## Solución de Problemas

### El servicio no se instala
- Ejecuta como administrador
- Verifica que pywin32 esté instalado correctamente

### Los eventos no llegan al servidor
- Verifica la URL del servidor en el script Python
- Comprueba que el servidor esté accesible desde la red
- Revisa los logs del servidor

### El dashboard no se actualiza
- Verifica la conexión a internet
- Revisa la consola del navegador por errores
- Intenta actualizar manualmente con el botón "Actualizar"