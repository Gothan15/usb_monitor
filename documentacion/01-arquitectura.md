# USB Monitor — Arquitectura y visión general

Documentación del proyecto · 1 de 5
Versión del sistema: noviembre de 2026 (panel 1.0.4, agente en C#)

## Qué es

USB Monitor es un sistema de monitoreo y control de dispositivos USB para una red local de PCs con Windows. Registra todo lo que se conecta a cada computadora y decide en el momento si ese dispositivo se puede usar o no, según una lista blanca y la contraseña del dueño del equipo.

## Las dos piezas

### El panel web

- Aplicación Next.js 15 con TypeScript, servida por un servidor propio (`server.ts`) que además aloja el canal de tiempo real (Socket.IO).
- Base de datos PostgreSQL, accedida con Prisma. Redis es opcional y se usa en despliegues de producción cuando se define `REDIS_URL`.
- Se instala a mano (Node.js + PostgreSQL) o con el instalador .msi, que monta el motor de PostgreSQL, Node.js y el panel como servicios de Windows.

### El agente para Windows

- Un único ejecutable autocontenido en C#/.NET 8 + WPF: `USBMonitorService.exe`. Según el modo con que se le llame, actúa como:
  - **Servicio** de Windows (sesión 0): vigila el hardware, bloquea y reporta. Es el modo normal.
  - **Compañero** (`prompt`): ventana de contraseña en la sesión del usuario.
  - **Ventana de gestión** (`gui`): caja de herramientas para configurar y diagnosticar.
  - **Visor** (`visor`): lista los dispositivos USB con sus seriales, para copiar el que haya que dar de alta en la lista blanca.
  - **Instalar / desinstalar** (`instalar`, `desinstalar`): se registra o se retira a sí mismo, restaurando todo.
  - **Restaurar** (`restaurar`): deshace a mano cualquier cambio que haya quedado.
- Su configuración vive solo en `server.json`. Es una aplicación de ventanas: no abre consola en ningún modo.

## Cómo fluye un bloqueo

1. El agente sondea el hardware cada 1,5 segundos y detecta la inserción (también inventaría lo conectado al arrancar).
2. Clasifica el dispositivo: disco/memoria, teléfono, óptica USB, red USB o impresora. Las carcasas UAS que se presentan como disco SCSI solo cuentan como USB si un ancestro en el árbol PnP (hasta 3 niveles) es un puente USB; un disco interno jamás se bloquea.
3. Bloquea por capas, verificando cada una: desactivación PnP confirmada; si no cede, bloqueo y desmonte de volumen (todas las particiones); como último respaldo, solo lectura con `diskpart` (bloqueo degradado, declarado en el registro). Las impresoras nunca se bloquean; la red USB presente al arrancar tampoco.
4. Consulta la lista blanca por número de serie en el panel.
   - No está: no hay contraseña posible para nadie. El compañero muestra solo el aviso de «no está en la lista blanca».
   - Está: el compañero pide la contraseña del dueño del equipo (o de un administrador; en modo «solo administradores», solo administradores).
5. El panel verifica la contraseña. Si es correcta, el agente libera el dispositivo hasta que se extraiga.
6. Todo queda registrado como evento: conexión, bloqueo, intentos fallidos, desbloqueo y extracción.

## Reglas que no se negocian

- **El administrador nunca «aprueba» nada.** Su contraseña es solo otra credencial válida; no existe un paso de aprobación humana.
- **La lista blanca no desbloquea nada por sí sola.** Marca conocidos frente a desconocidos; el desbloqueo siempre exige contraseña.
- **Sin huella.** Cada cambio persistente (desactivar un nodo, poner solo lectura…) se anota con su valor original y se revierte al extraer, al parar el servicio, al desinstalar y tras un arranque sucio.
- **Sin red, fail-closed y sin pérdidas.** Lo que no se puede verificar queda bloqueado; los eventos se guardan en una cola en disco y se envían al volver la conexión; existe una emergencia local con la contraseña del dueño cifrada (máximo 5 intentos cada 15 minutos).
- **Evidencia por silencio.** Cada equipo reporta su señal periódicamente (latido cada 30 segundos); el panel marca en rojo los que dejan de dar señales, con la hora de la última señal y un umbral ajustable.

## Tiempo real

El agente reporta al momento y el panel emite por Socket.IO: la campana y el feed de eventos son instantáneos, y los bloqueos nuevos, intentos y cierres empujan un aviso que refresca la vista de Desbloqueos. Los cambios de lista blanca y de usuarios también se empujan a las pantallas abiertas. El interruptor «Tiempo real» de la interfaz pausa estos refrescos; no corta la conexión.

## Datos principales

- **Equipos** (Computer): nombre, IP, última señal, huella SHA-256 del token del agente.
- **Usuarios** (User): cuenta del panel, rol (administrador o usuario) y equipo asignado — ese vínculo define al «dueño» para los desbloqueos.
- **Lista blanca** (Whitelist): serial, descripción y notas.
- **Bloqueos** (PendingUnlock): dispositivo bloqueado esperando contraseña o extracción, con su estado y registro en el panel.
- **Eventos y conexiones**: historial completo de conexiones, con el tipo de dispositivo.

## Publicación automática

GitHub Actions compila y publica ambas piezas: las etiquetas `agente-v*` producen el zip del agente y las `panel-v*` el .msi del panel, adjuntos a su Release. La compilación del instalador se detiene ante cualquier fallo intermedio: un .msi «verde» con el panel roto dentro no puede salir.
