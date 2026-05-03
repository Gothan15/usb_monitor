---
description: "Planifica e implementa la instalación remota del servicio USBMonitor vía SSH en computadoras de la red. Incluye frontend (dialog multi-paso con credenciales, progress bar, estado) y backend (copia de archivos + instalación del servicio). Usa cuando: instalar servicio remoto, deploy USB monitor, instalación SSH, remote install service."
agent: "agent"
argument-hint: "IP o nombre de la computadora destino (opcional)"
---

# Implementación de Instalación Remota del Servicio USBMonitor vía SSH

## Contexto del Proyecto

Este es un proyecto **Next.js (App Router)** con Prisma, shadcn/ui y Tailwind CSS que gestiona el monitoreo de dispositivos USB en una red corporativa. Ya existe:

- **Tab de Network**: [src/components/dashboard/NetworkScannerTab.tsx] — muestra equipos detectados en la red con escaneo CIDR.
- **Servicio USBMonitor**: [USBMonitor/usb_monitor_service.py] — servicio Windows que detecta USBs y reporta al servidor.
- **WinRM Service**: [src/lib/winrmService.ts] — funciones existentes de instalación/gestión remota vía PowerShell/WinRM con credenciales de variables de entorno.
- **API remote-install**: [src/app/api/remote-install/route.ts] — endpoint existente que usa WinRM para instalar remotamente (usa credenciales fijas de env vars).
- **Install-Service.ps1**: [USBMonitor/Install-Service.ps1] — script PowerShell con parámetros `-Action install|start|stop|remove|restart|status`, `-ServerHost`, `-ServerPort`.

### Modelo de datos relevante (Prisma)

```prisma
model Computer {
  id               String    @id @default(cuid())
  name             String    @unique
  ipAddress        String
  serviceInstalled Boolean   @default(false)
  serviceRunning   Boolean   @default(false)
  // ...más campos
}
```

### Patrones de API existentes

- Autenticación: `requireAuth(req, { role: "admin" })`
- Rate limiting: `hit("key", { windowMs, max }, { userId, ip })`
- CSRF: `x-csrf-token` header obligatorio en mutaciones
- Responses: `NextResponse.json(data, { status })` con `Cache-Control: "no-store"`

### Componentes UI disponibles (shadcn/ui)

Dialog, Button, Input, Label, Progress, Badge, Alert, Card, Spinner, ScrollArea, Tabs, y los demás componentes registrados en el proyecto.

---

## Objetivo

Implementar un **flujo completo de instalación remota del servicio USBMonitor** usando **SSH** (cambiando de WinRM a SSH) que incluye:

### Frontend — Dialog Multi-paso en el Tab de Network

1. **Botón "Instalar Servicio"** en cada fila de computadora del tab Network (o un botón general que abre el dialog).
2. **Paso 1 — Credenciales**: Dialog modal pidiendo:
   - Usuario de la computadora destino
   - Contraseña de la computadora destino
   - IP/hostname pre-llenado del equipo seleccionado
   - Botón "Siguiente" (habilitado solo con campos válidos)
3. **Paso 2 — Copia de archivos**:
   - Mensaje de progreso con **progress bar animada**
   - Texto descriptivo del paso actual ("Copiando archivos del servicio...", "Verificando conexión SSH...", etc.)
   - Al concluir exitosamente: mensaje de confirmación verde "Archivos copiados exitosamente ✓"
4. **Paso 3 — Instalación del servicio**:
   - Botón "Instalar Servicio" disponible tras la copia exitosa
   - Progress bar durante la instalación
   - Al concluir: mensaje de éxito "Servicio USBMonitor instalado y ejecutándose ✓"
   - Opción de cerrar el dialog
5. **Manejo de errores**: Mensajes claros en rojo si falla cualquier paso, con opción de reintentar.

### Backend — API SSH

1. **Nuevo endpoint o modificación del existente** para aceptar credenciales SSH dinámicas (usuario/contraseña del dialog, NO de variables de entorno).
2. **Fase de copia**: Usar SSH/SCP para copiar el ejecutable del servicio a la máquina remota.
3. **Fase de instalación**: Ejecutar los comandos de instalación del servicio vía SSH en la máquina remota, usando los comandos propios del ejecutable (`sc.exe create`, `sc.exe start`, o el script `Install-Service.ps1`).
4. **Streaming de progreso** (opcional pero deseable): Reportar progreso en tiempo real al frontend (via SSE, WebSocket, o polling).
5. **Seguridad**: Las credenciales NO deben persistirse en disco ni en logs. Deben usarse solo en memoria durante la operación.

---

## Preguntas Obligatorias — Fase de Clarificación Exhaustiva

**IMPORTANTE**: Antes de generar CUALQUIER plan de implementación, DEBES hacer TODAS las preguntas necesarias para entender completamente el alcance. No hay límite de preguntas. Pregunta sobre TODO lo que pueda afectar la implementación. A continuación hay categorías sugeridas, pero no te limites a ellas:

### Arquitectura y Transporte SSH

- ¿Se usará una librería SSH de Node.js (como `ssh2`, `node-ssh`) o se invocará `ssh`/`scp` como proceso externo?
- ¿Las máquinas destino ya tienen servidor SSH habilitado (OpenSSH Server en Windows)?
- ¿Se debe soportar autenticación por clave pública además de usuario/contraseña?
- ¿Qué puerto SSH se usa? ¿Siempre el 22 o es configurable?
- ¿Se necesita verificación de host key o se puede aceptar automáticamente?

### Archivos a Copiar

- ¿Solo se copia el ejecutable compilado (`USBMonitor.exe`) o también se deben copiar archivos adicionales (config, certificados, scripts)?
- ¿Dónde está el ejecutable compilado localmente? ¿En `dist/USBMonitor.exe`, `build/USBMonitorService/`, u otra ruta?
- ¿Cuál es la ruta destino en la máquina remota? ¿`C:\USBMonitor\` como está configurado actualmente?
- ¿Se debe verificar si ya existe una versión instalada antes de copiar?

### Instalación del Servicio

- ¿Se usa `sc.exe create` directamente o se copia y ejecuta `Install-Service.ps1` en la máquina remota?
- ¿Los parámetros `-ServerHost` y `-ServerPort` deben ser configurables en el dialog o se toman del servidor actual?
- ¿El servicio debe iniciarse automáticamente tras la instalación?
- ¿Se debe verificar que el servicio quedó corriendo después de instalarlo?

### Seguridad y Credenciales

- ¿Las credenciales SSH son las del usuario de Windows de la máquina destino?
- ¿Se requiere que el usuario tenga privilegios de administrador en la máquina destino?
- ¿Cómo se manejan credenciales inválidas? ¿Cuántos reintentos se permiten?
- ¿Se debe implementar timeout de la conexión SSH?
- ¿Alguna política de complejidad para las credenciales ingresadas?

### Frontend y UX

- ¿El botón de instalar va en cada fila de la tabla del Network tab o es un botón general?
- ¿Se debe poder instalar en múltiples equipos a la vez (batch) o uno por uno?
- ¿El dialog debe ser un componente reutilizable o específico del Network tab?
- ¿Qué nivel de detalle debe mostrar el progress? ¿Solo porcentaje o también logs en vivo?
- ¿Al cerrar el dialog durante una operación, se debe cancelar la operación o continuar en background?
- ¿Se debe actualizar automáticamente el estado `serviceInstalled`/`serviceRunning` del Computer en la DB después de instalar?

### Progreso y Comunicación

- ¿Cómo se reporta el progreso? ¿Server-Sent Events (SSE), WebSocket (ya existe `socket.ts`), o polling HTTP?
- ¿Se necesita un log detallado de la instalación accesible después?
- ¿Se debe poder cancelar una instalación en curso?

### Compatibilidad y Edge Cases

- ¿Qué versiones de Windows se deben soportar en las máquinas destino?
- ¿Qué pasa si el firewall bloquea SSH? ¿Se muestra un error descriptivo?
- ¿Se debe soportar la reinstalación/actualización si el servicio ya está instalado?
- ¿Y si la máquina destino no tiene suficiente espacio en disco?
- ¿Se debe gestionar la desinstalación del servicio anterior antes de instalar?

### Integración con el Sistema Existente

- ¿Se mantiene el endpoint WinRM existente como fallback o se reemplaza completamente por SSH?
- ¿Se actualizan los campos del modelo Computer después de la instalación exitosa?
- ¿Se genera alguna notificación o log de auditoría cuando se instala remotamente?
- ¿Se integra con el sistema de notificaciones existente (`serviceNotifier.ts`)?

### Testing y Rollback

- ¿Cómo se verificará que la instalación fue exitosa? ¿Health check al endpoint del servicio?
- ¿Se debe implementar rollback si la instalación falla a medio camino?
- ¿Se necesitan tests automatizados para el flujo?

---

## Instrucciones para el Agente Plan

1. **NO generes ningún plan hasta haber completado la fase de preguntas.**
2. Haz TODAS las preguntas que consideres necesarias. Las categorías anteriores son un mínimo, no un máximo.
3. Si el usuario responde de forma ambigua, pide aclaración.
4. Una vez tengas todas las respuestas, genera un plan detallado paso a paso con:
   - Archivos a crear/modificar
   - Dependencias NPM a instalar
   - Orden de implementación
   - Consideraciones de seguridad
   - Diagrama del flujo si es útil
5. Pide confirmación del plan antes de proceder a la implementación.
6. Responde siempre en español.
