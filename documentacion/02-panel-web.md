# USB Monitor — El panel web: instalación y uso

Documentación del proyecto · 2 de 5
Versión del sistema: noviembre de 2026 (panel 1.0.4)

## Instalación

### Con el instalador .msi (recomendada)

1. Descarga `USBMonitor-Panel-<versión>.msi` de la pestaña Releases del repositorio.
2. Ejecútalo en la PC que hará de servidor. El asistente está en español.
3. En la página «Configuración del servidor» indica:
   - Puerto del panel web (por defecto 3000).
   - Puerto de la base de datos interna (por defecto 5433).
   - Usuario y contraseña del primer administrador (obligatorios en instalación nueva).
   - Si quieres abrir el cortafuegos solo a la subred local.
4. El instalador monta: el motor de PostgreSQL como servicio propio (clúster privado en `C:\ProgramData\USBMonitor`), Node.js portable, el panel como servicio de Windows (con WinSW, dependiente de la base de datos) y una tarea de copia semanal de la base de datos (domingos 03:00, conserva las 8 últimas).
5. En una actualización, los valores se recuperan del registro y no se vuelven a preguntar.

### A mano

Requisitos: Node.js 20+ (mejor 22) y un PostgreSQL accesible. Redis es opcional para producción (`REDIS_URL`).

```bash
npm install
# crea un .env con DATABASE_URL y SESSION_SECRET
npx prisma migrate deploy
npm run db:seed
npm run build     # producción: compilar ANTES de arrancar
npm run start     # sirve en el puerto 3000 con el server.ts del repo
```

El primer administrador se crea con `npm run user:create`. Si tras un `git pull` cambia el esquema, aplica `npm run db:push` cuando las notas de la versión lo indiquen.

## Cuentas y roles

- **Administrador**: lo gestiona todo (equipos, usuarios, lista blanca, ajustes, tokens).
- **Usuario**: ve su equipo y sus dispositivos e historial. Cada usuario se asigna a **un equipo** desde la pestaña Usuarios, eligiendo el equipo por su nombre (nunca por IP). Esa asignación define quién es el dueño de la PC para los desbloqueos.
- No hay registro abierto: las cuentas las crea un administrador. La primera sale del seed o del instalador.

## Las vistas

- **Resumen**: equipos bajo control, eventos recientes, tendencia de autorizaciones y bloqueos, salud de los agentes.
- **Equipos**: un equipo aparece solo, al primer contacto de su agente, al provisionarle un token o por instalación remota. Su estado («En ejecución / Sin señal») sale de la última señal recibida, no de sondeos: si el agente cae, el equipo se marca sin señal pasado el umbral ajustado. Desde la ficha se genera el **token del agente** (se muestra una sola vez; generar otro invalida el anterior).
- **Eventos**: historial con filtros. Llegan en tiempo real.
- **Desbloqueos**: qué está bloqueado ahora, qué está en uso tras desbloquear, historial de intentos y equipos sin señal.
- **Lista blanca**: alta y baja de seriales con descripción y notas. El agente solo la consulta; nadie la edita desde una PC cliente.
- **Red**: escáner para descubrir equipos y comprobar si tienen el agente.
- **Usuarios**: cuentas, roles y asignación de equipo.
- **Ajustes**: ver la lista de abajo. Incluye reactivar la guía y las preguntas frecuentes.

En todas las listas, cada dispositivo lleva su tipo: memoria/disco, teléfono, óptica USB, red USB o impresora, también si no tiene letra de unidad (se muestra «Sin letra»).

## Ajustes que afectan a los agentes

- Interruptor general del desbloqueo por contraseña.
- Emergencia sin red (página local del agente con la contraseña del dueño cifrada).
- Modo «solo administradores» para desbloquear.
- Apagado ante dispositivos no listados (desactivado por defecto): cuenta atrás de 60 segundos, cancelable al extraer o desbloquear.
- Bloqueo de la sesión de Windows al conectar un dispositivo (opcional).
- Minutos de silencio para considerar caído un equipo (mínimo 2; el agente da señales cada 30 segundos).

Los cambios se empujan a los agentes conectados y, además, cada agente los pide al arrancar y periódicamente: un equipo apagado en el momento del cambio se pone al día al encender.

## Instalación remota del agente

Desde el escáner de red o desde Equipos se crean **tareas de instalación** contra uno o varios equipos, con el progreso en vivo en la vista Tareas. Para cada destino el panel elige el método: si el equipo ya tiene un agente que da señales, se actualiza por su propio canal — descarga el paquete del panel y verifica su SHA-256 — sin credenciales; si no, va por **empuje SMB**: el ayudante `USBMonitorEmpujador.exe` copia el ejecutable a `C:\USBMonitor` del destino por el recurso `C$` y un servicio temporal lo instala en su modo sin ventanas, con la dirección de este panel y un token recién provisionado para ese equipo. La contraseña de administrador de los destinos se da una sola vez al crear la tarea y vive solo en la memoria del servidor.

Antes de empujar, el panel comprueba en vivo los requisitos de cada destino: puerto 445 alcanzable, sesión SMB con las credenciales, derecho a crear servicios y si el agente ya está presente. El destino se prepara una sola vez: red en perfil Privado, «Compartir archivos e impresoras» activo, cuenta administradora local con contraseña y el valor `LocalAccountTokenFilterPolicy = 1`, para que ese administrador entre por red con su token completo. La receta completa, también para máquinas virtuales, está en la documentación de despliegue (04) y, dentro del propio panel, en Ajustes → Preguntas frecuentes, donde la misma lista se marca sola con el resultado de la comprobación.

El ejecutable que se empuja es el que el panel guarda en su carpeta `paquete-agente` (con el empujador en su carpeta `empujador`): ambos salen del zip de la Release del agente, y durante la instalación no se descarga nada de internet. Un equipo solo se da por instalado cuando su agente da la primera señal al panel: que la copia termine no basta.

## Guía y preguntas frecuentes

El panel incluye una guía interactiva que recorre las ocho vistas paso a paso (navega sola, resalta cada zona y explica qué se hace ahí) y una sección de preguntas frecuentes que crece con el sistema. La guía se puede volver a lanzar desde Ajustes.
