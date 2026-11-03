# USB Monitor

Sistema de monitoreo y control de dispositivos USB para una red local de PCs con Windows. Lo empecé en septiembre de 2025 para resolver un problema concreto: en una oficina nadie sabe qué se conecta a cada computadora, ni quién lo puso. Este sistema lo registra todo y, más importante, decide en el momento si ese dispositivo se puede usar o no.

Detecta memorias USB, discos duros y SSD externos (también los de carcasas modernas que Windows no presenta como «USB» a simple vista) y teléfonos móviles en modo de transferencia de archivos, que son las tres vías típicas de sacar datos de una PC. También ve unidades ópticas USB, adaptadores de red USB e impresoras, aunque esas no se bloquean: quedan registradas y nada más.

Son dos piezas:

- **Un panel web** (Next.js + PostgreSQL) donde se ven los equipos, los eventos, la lista blanca de dispositivos y los usuarios. Se puede instalar a mano o con un **instalador .msi** que lo deja todo montado (ver «Instalación»).
- **Un agente para Windows** en C# (.NET 8): un único ejecutable autocontenido, `USBMonitorService.exe`, que hace de servicio, de ventana de gestión y de ventana de contraseña según cómo se le llame. Vigila las conexiones USB de cada PC, aplica las reglas y reporta al panel. (El agente original era en Python; lo reescribí en C# a principios de noviembre de 2026 y el de Python ya no se usa.)

Las versiones del agente y del instalador del panel se compilan solas con GitHub Actions y se publican en la pestaña **Releases** de este repo: etiquetas `agente-v*` para el agente y `panel-v*` para el instalador.

## Tecnologías

### Panel web

![Next.js](https://img.shields.io/badge/Next.js-black?style=for-the-badge&logo=next.js&logoColor=white) ![React](https://img.shields.io/badge/react-%2320232a.svg?style=for-the-badge&logo=react&logoColor=%2361DAFB) ![TypeScript](https://img.shields.io/badge/typescript-%23007ACC.svg?style=for-the-badge&logo=typescript&logoColor=white) ![Node.js](https://img.shields.io/badge/node.js-6DA55F?style=for-the-badge&logo=node.js&logoColor=white) ![Tailwind CSS](https://img.shields.io/badge/tailwindcss-%2338B2AC.svg?style=for-the-badge&logo=tailwind-css&logoColor=white) ![Radix UI](https://img.shields.io/badge/radix%20ui-161618.svg?style=for-the-badge&logo=radix-ui&logoColor=white)

![PostgreSQL](https://img.shields.io/badge/PostgreSQL-316192?style=for-the-badge&logo=postgresql&logoColor=white) ![Prisma](https://img.shields.io/badge/Prisma-3982CE?style=for-the-badge&logo=Prisma&logoColor=white) ![Socket.io](https://img.shields.io/badge/Socket.io-black?style=for-the-badge&logo=socket.io&logoColor=white) ![Redis](https://img.shields.io/badge/redis-%23DD0031.svg?style=for-the-badge&logo=redis&logoColor=white) ![Recharts](https://img.shields.io/badge/Recharts-22B5BF?style=for-the-badge) ![Zustand](https://img.shields.io/badge/Zustand-443E38?style=for-the-badge) ![Vitest](https://img.shields.io/badge/Vitest-6E9F18?style=for-the-badge&logo=vitest&logoColor=white)

### Agente para Windows

![C#](https://img.shields.io/badge/C%23-%23239120.svg?style=for-the-badge&logo=csharp&logoColor=white) ![.NET](https://img.shields.io/badge/.NET-5C2D91?style=for-the-badge&logo=.net&logoColor=white) ![WPF](https://img.shields.io/badge/WPF-0C54C2?style=for-the-badge) ![Windows](https://img.shields.io/badge/Windows-0078D6?style=for-the-badge&logo=windows&logoColor=white) ![GitHub Actions](https://img.shields.io/badge/GitHub%20Actions-2088FF?style=for-the-badge&logo=github-actions&logoColor=white)

## Capturas

Panel de resumen, con los equipos y eventos en vivo:

![Panel de resumen](docs/capturas/02-panel.png)

La pantalla de acceso:

![Acceso al panel](docs/capturas/01-login.png)

La página de desbloqueo, que es el respaldo cuando la ventana del agente no puede abrirse:

![Página de desbloqueo](docs/capturas/03-desbloquear.png)

## Cómo funciona un bloqueo, paso a paso

Esto es lo que pasa de verdad cuando alguien conecta un dispositivo a una PC con el agente instalado:

1. El agente detecta la inserción sondeando el hardware cada 1,5 segundos, y también revisa lo que ya esté conectado al arrancar. Un detalle importante: las carcasas de disco con puente moderno (UAS) se presentan como un disco SCSI genérico, igual que un disco interno SATA, así que el agente solo las trata como USB si comprueba que un dispositivo «padre» en el árbol de hardware (hasta tres niveles) es un puente USB. Los discos internos no se tocan nunca. Las impresoras USB se detectan y se registran, pero **nunca se bloquean ni piden contraseña**; los adaptadores de red USB que ya estén conectados al arrancar tampoco se bloquean, para no dejar a la PC sin su propia conexión.
2. El dispositivo queda **bloqueado al momento**, por capas, y cada capa se comprueba antes de darla por buena:
   - Primero se intenta desactivar el dispositivo (PnP) y se confirma que Windows lo dejó desactivado de verdad. En discos duros externos cuyo nodo se resiste, se pasa al nodo USB del propio dispositivo, nunca al concentrador raíz.
   - Si el PnP no cede, se bloquea y desmonta el volumen (todas las particiones, no solo la primera letra).
   - Como último respaldo, el disco se pone en solo lectura con `diskpart` (ese deja leer: es un bloqueo degradado y queda dicho en el registro).
   Un teléfono no tiene letra de unidad, así que su bloqueo es el de PnP.
3. Se consulta la lista blanca por número de serie (en un móvil, el serial que trae su identificador de dispositivo):
   - **Si el dispositivo NO está en la lista blanca**, ahí termina todo. No hay contraseña que valga, ni siquiera la del administrador. En la pantalla del usuario sale un cartel avisando que el dispositivo no está en la lista blanca, y el evento queda registrado en el panel. Como ajuste opcional (desactivado por defecto) se puede hacer que la PC inicie el apagado de Windows con 60 segundos de margen ante un dispositivo desconocido conectado después del arranque; extraerlo o desbloquearlo cancela la cuenta atrás.
   - **Si SÍ está en la lista blanca**, toca el segundo factor: una ventana pide la contraseña **del dueño de esa PC** (o la del administrador). Es decir, la lista blanca dice "este dispositivo es conocido" y la contraseña comprueba "y tú eres quien debería estar usando esta computadora". Que un dispositivo sea conocido no basta, porque cualquiera puede tomar prestado un pendrive autorizado. Hay un modo «solo administradores» que limita el desbloqueo a las cuentas administradoras.
4. Si la contraseña es correcta, el dispositivo se libera y se puede usar **hasta que se extraiga**. Al volver a conectarlo, se pide la contraseña de nuevo.
5. Todo queda registrado: conexiones, desconexiones, intentos de desbloqueo fallidos, intentos con la contraseña de otra persona (el sistema comprueba que la cuenta sea la dueña de esa PC, no vale la contraseña de un compañero) y desbloqueos correctos, con quién los hizo. El panel tiene una vista de auditoría solo de lectura con todo esto.

Detalles de implementación que me parecen importantes:

- Como el agente es un servicio de Windows (sesión 0), **no puede mostrar ventanas**. Por eso el mismo ejecutable tiene un modo compañero que corre en la sesión del usuario y es el que pinta la ventana de la contraseña. Ese proceso no decide nada: manda la contraseña directa al servidor y el servicio solo libera el dispositivo cuando el servidor se lo confirma. El compañero arranca oculto y solo aparece cuando hay un bloqueo; cerrar su ventana con la X solo lo oculta, y si alguien mata el proceso, el servicio lo vuelve a lanzar en la sesión activa. Si el panel no responde, el registro del bloqueo se reintenta hasta que quede hecho, para que el desbloqueo en línea sea posible en cuanto vuelva la conexión.
- **Sin huella**: cada cambio persistente que el agente hace en la PC (desactivar un dispositivo, solo lectura, etc.) queda anotado con su valor original, y se revierte al extraer el dispositivo, al parar el servicio, al desinstalar y tras un reinicio sucio. Lo que el agente tocó, el agente lo deja como estaba.
- El ejecutable es una aplicación de ventanas: no abre ninguna consola al ejecutarse, ni como servicio ni en sus ventanas.
- Las contraseñas se verifican en el servidor, con el mismo criterio que el login del panel: 5 intentos fallidos bloquean la cuenta 15 minutos.
- Cada equipo tiene su propio **token de agente** (el panel solo guarda su huella SHA-256; al generar uno nuevo, el anterior deja de valer). En la PC, el token se guarda cifrado en `server.json`. La clave API de usuario ya no sirve para que un agente se autentique.
- Cada usuario del panel tiene asignada su computadora (la asignación se hace por equipo, no por IP). Ese vínculo es el que define quién es "el dueño" para el desbloqueo.
- **Sin red no se pierde nada**: los eventos que no se pueden enviar se guardan en una cola en disco y se envían cuando vuelve la conexión, incluidos los arranques y paradas del servicio.
- **Emergencia sin red**: existe además una salida de emergencia cuando el servidor no responde: el agente guarda una copia cifrada de la contraseña del dueño y la página local del propio agente (`http://localhost:5001/desbloquear`) puede liberar la unidad con ella, con un máximo de 5 intentos locales cada 15 minutos. Los intentos hechos así se suben al panel cuando vuelve la red.

## El panel

- Resumen en vivo: equipos bajo control, eventos recientes, tendencia de autorizaciones y bloqueos, salud de los agentes. Casi todo llega **en tiempo real** por Socket.IO: eventos, bloqueos nuevos, intentos y cambios de lista blanca o de usuarios empujan la actualización a las pantallas abiertas sin esperar al siguiente sondeo.
- Lista de eventos con filtros, y lista blanca administrable (alta y baja de seriales con etiqueta y notas).
- Vista de auditoría de desbloqueos: qué está bloqueado ahora, qué está en uso tras desbloquear, el historial de intentos y los equipos que han dejado de dar señales. Un equipo se considera «conectado» solo si su última señal es reciente (el umbral se ajusta en el panel); el resto es evidencia por silencio.
- Los dispositivos se etiquetan por tipo en todas las listas: memoria/disco, teléfono, óptica USB, red USB o impresora, también cuando no tienen letra de unidad.
- Gestión de usuarios y de equipos, asignación de cada usuario a su PC, y generación del token de agente de cada equipo desde la propia ficha del equipo.
- Escáner de red para descubrir equipos y comprobar si tienen el agente instalado y corriendo.
- Instalación remota del agente por SSH o por WinRM, con el progreso en vivo en pantalla, botón de «Comprobar requisitos en el destino» y la receta de preparación del equipo destino (hay que activar WinRM una vez en ese equipo; el diálogo lo explica paso a paso).
- **Guía interactiva** que recorre las pantallas del panel paso a paso y sección de **preguntas frecuentes**; se puede reactivar desde Ajustes.
- Ajustes del desbloqueo por contraseña: interruptor general, emergencia sin red, modo solo administradores, apagado ante dispositivos desconocidos, bloqueo de la sesión al conectar y minutos de silencio para marcar un equipo como caído. Los cambios se empujan a los agentes conectados y, además, cada agente los pide él mismo al arrancar y periódicamente, para que un equipo apagado en el momento del cambio no se quede con los viejos.
- Soporte de **Redis** para despliegues en producción (variable `REDIS_URL`).
- La navegación se puede poner en la cabecera superior o en una barra lateral, a elegir en Ajustes.

## Instalación

### El panel, con el instalador (la vía corta)

Descarga `USBMonitor-Panel-<versión>.msi` de la pestaña **Releases** (la última es la 1.0.4) y ejecútalo en la PC que hará de servidor. El asistente, en español, te pide el puerto del panel, el puerto de la base de datos y el usuario y la contraseña del primer administrador, e instala todo: el motor de PostgreSQL como servicio propio, Node.js, el panel como servicio de Windows (con WinSW) y una copia semanal de la base de datos. Los datos quedan en `C:\ProgramData\USBMonitor`. No hace falta tener nada instalado antes.

### El panel, a mano

Necesitas Node.js 20+ (mejor 22) y un PostgreSQL accesible. En producción, además, Redis si defines `REDIS_URL`.

```bash
npm install
# crea un .env con DATABASE_URL y SESSION_SECRET
npx prisma migrate deploy   # crea las tablas (migración base)
# Si tu base de datos ya existía de antes de la migración base:
#   npx prisma migrate resolve --applied 20250101000000_baseline
npm run db:seed        # datos iniciales (revisa prisma/seed.ts antes)
npm run build          # producción: hay que compilar ANTES de arrancar
npm run start          # sirve el panel (server.ts del repo) en el puerto 3000
npm run dev            # desarrollo
```

El primer usuario administrador se crea con `npm run user:create`. Después del primer `git pull` tras cambios de esquema, corre `npm run db:push` si el propio panel te lo pide en sus notas de versión.

### El agente (en cada PC Windows)

Descarga el zip del agente de la pestaña **Releases** (etiquetas `agente-v*`), descomprime `USBMonitorService.exe` en una carpeta y ejecútalo como administrador con el modo de instalación:

```powershell
.\USBMonitorService.exe instalar
```

Eso registra el servicio (con recuperación automática: si se cae, Windows lo reinicia), deja programado el inicio del compañero al iniciar sesión **y lo arranca en el acto**, sin esperar al siguiente inicio de sesión. Si es la primera vez y aún no hay token configurado, se abre un asistente de configuración de cinco pasos: dirección del servidor y token del equipo (el token se genera antes en el panel, en Equipos → «Token del agente», y se muestra una sola vez). La misma ventana de gestión se abre cuando quieras con `USBMonitorService.exe gui`.

La configuración vive solo en `server.json`, junto al ejecutable o en `C:\ProgramData\USBMonitor`: claves `serverHost`, `serverPort`, `serverScheme` y `agentToken` (se guarda cifrada al guardarla desde la ventana). Para desinstalar restaurando todo: `USBMonitorService.exe desinstalar`.

Compilar desde el código: `USBMonitorCS/compilacion/Build-All.ps1` publica el ejecutable autocontenido en `USBMonitorCS/dist`. Los paquetes NuGet pueden ir en `USBMonitorCS/paquetes` como fuente local, para compilar sin internet.

## Estructura del repo

```
src/                 Panel (Next.js): páginas, API y lógica de servidor
prisma/              Esquema de la base de datos y migraciones
USBMonitorCS/        Agente Windows en C#/.NET 8 (servicio, compañero,
                     ventana de gestión, visor) y su compilación
USBMonitor/          El agente original en Python (histórico, ya no se usa)
instalador/          Instalador .msi del panel (WiX v5) y su constructor
.github/workflows/   Actions: compilan y publican el agente (agente-v*)
                     y el instalador del panel (panel-v*) en Releases
documentacion/       Documentación del proyecto (fuentes Markdown; los
                     PDF generados se entregan aparte)
docs/capturas/       Las capturas de este README
INSPIRACION.md       Referencias de diseño de la interfaz
```

## Limitaciones, dichas claramente

- Esto es software en el espacio de usuario, no un driver. Un usuario con permisos de administrador local en su PC puede detener el servicio si sabe cómo. Lo que sí hace el sistema es **detectarlo**: cada equipo reporta su actividad y el panel marca los que dejan de dar señales, con la hora de la última señal. Detecta y deja evidencia; no lo impide. La otra cara: como el agente revierte todo lo que toca, un apagado a la fuerza puede dejar un dispositivo desactivado hasta que el servicio vuelva a arrancar y haga su restauración de arranque (que la hace).
- Si el servidor no responde, el agente mantiene bloqueado lo que no pueda verificar. Los eventos no se pierden (cola persistente en disco), y la contraseña en línea se puede verificar en cuanto la conexión vuelve; mientras tanto queda la emergencia local descrita arriba.
- Si en un móvil la desactivación por PnP fallara en una PC concreta, no hay un segundo mecanismo: el evento llega al panel marcado como «sin bloqueo efectivo» en vez de fingir un bloqueo que no existe.
- Un móvil en modo «solo carga» no expone datos y Windows ni siquiera lo enumera como dispositivo de archivos: el agente lo caza en el momento en que alguien activa la transferencia.
- Un adaptador de red por USB que ya esté conectado al arrancar el servicio (típico: el dock que le da red al propio equipo) se registra pero no se bloquea, para no dejar a la PC sin su conexión; los que se conecten después sí se bloquean. Las impresoras, nunca.
- Solo Windows en el lado del agente. El panel corre donde corra Node (el escáner de red usa el `ping` del sistema: su sintaxis está ajustada a Windows).
- El instalador .msi está recién estrenado (1.0.4 es la primera versión que compila y se publica sola): la instalación en máquinas variadas está por probar, igual que el resto del banco de pruebas.

## Novedades de noviembre de 2026

- **El agente, reescrito en C#** (1 de noviembre): un solo ejecutable autocontenido con servicio, compañero, ventana de gestión y visor; bloqueo por capas comprobadas; regla de «sin huella» con restauración completa; tokens por equipo en lugar de la clave API.
- **Prueba en PC real y sus arreglos** (2 de noviembre): el panel rechazaba eventos con campos vacíos (teléfonos sin letra) y atascaba la cola de los agentes — arreglado; el compañero no arrancaba tras instalar — ahora arranca en el acto; un volumen interno se colaba como «memoria fantasma» — filtrado; el registro de bloqueos se reintenta si el panel tarda; el ejecutable ya no abre consola.
- **Tiempo real de verdad** (2 de noviembre): los eventos, bloqueos e intentos empujan por Socket.IO a las pantallas abiertas; la vista de Desbloqueos se refresca por empuje.
- **Guía y preguntas frecuentes** (2 de noviembre): recorrido interactivo por las ocho vistas y 17 preguntas frecuentes.
- **Discos, impresoras y red** (2 de noviembre): bloqueo de discos duros reforzado (cadena de nodos y todas las particiones), impresoras detectadas que nunca se bloquean y tipos de dispositivo visibles en todo el panel.
- **Instalación remota WinRM corregida** (2 de noviembre): copia el agente de C# actual, en trozos grandes, con comprobación de requisitos en el destino y la receta completa en español.
- **Apagado ante desconocidos** (2 de noviembre): ajuste opcional, desactivado por defecto, con cuenta atrás de 60 segundos cancelable.
- **Instalador del panel** (2–3 de noviembre): .msi con WiX v5 que instala PostgreSQL, Node y el panel como servicios; compilado y publicado automáticamente por GitHub Actions. La versión **1.0.4** es la primera que sale entera de la cadena automática.

## Estado del proyecto

Lo uso como proyecto personal y de aprendizaje, y está en desarrollo activo. Todo lo descrito aquí está fusionado en `main`. Lo que queda por hacer de verdad es de banco de pruebas, no de código: correr el sistema contra hardware variado (más carcasas de disco, más teléfonos), probar la instalación con el .msi en máquinas limpias y ajustar lo que la práctica enseñe.

Si algo de este README no coincide con lo que hace el código, el código manda y el README está mal: avísame en un issue.
