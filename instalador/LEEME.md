# Instalador del panel (.exe, Inno Setup)

Convierte el panel de USB Monitor en **una aplicación que se instala como cualquier programa de Windows**: doble clic, asistente clásico (el de los instaladores de siempre, en español), y al terminar el servidor queda corriendo como servicio, con su base de datos propia debajo. Sin montar piezas a mano.

> **Desde la 1.5.0 el instalador lo hace Inno Setup** (`Panel.iss`), en vez del `.msi` de WiX de las versiones 1.0–1.4.1. Motivos: el MSI copiaba miles de archivos con su contabilidad de reversión y la instalación se hacía muy lenta, y cuando un paso falló en la primera instalación real, la reversión borró todo lo instalado — registros incluidos — sin dejar el porqué. Inno copia rápido, exige administrador de forma nativa, no usa VBScript (el aviso WIX1163 muere con el cambio) y, si un paso falla, **no deshace lo copiado**: el asistente anuncia el paso fallido y todo queda en su sitio para mirar los registros. La lógica de instalación no cambió: la siguen haciendo los mismos scripts de PowerShell.

## Qué instala

| Pieza | Cómo queda |
|---|---|
| Panel web (Next.js compilado) | Carpeta `app\` en la ruta elegida (def. `C:\Program Files\USB Monitor Panel`) |
| Node.js | Integrado (`node\node.exe`, versión fijada): el equipo NO necesita tener Node |
| Base de datos | **PostgreSQL integrado y privado**: clúster propio creado con `initdb`, servicio `USBMonitorPostgreSQL`, puerto propio (def. 5433), solo escucha en localhost |
| Redis | **Redis integrado y privado**: binarios de Redis 7.2 para Windows (proyecto redis-windows, licencia BSD-3), servicio `USBMonitorRedis`, puerto fijo 6381, solo escucha en 127.0.0.1 y con contraseña interna. El panel lo usa para la presencia de los agentes y los límites de intentos: así sobreviven a un reinicio del panel y no viven en su memoria |
| Servicio del panel | `USBMonitorPanel` (WinSW), automático, se reinicia si cae, depende de los servicios de la BD y de Redis |
| Accesos directos | Escritorio y menú Inicio: «Abrir el panel» (lee el puerto real del registro) |
| Cortafuegos | Regla de entrada para el puerto del panel, limitada a la **subred local** y a los perfiles de red **Privado** y **Dominio** (se crea siempre) |
| Copia de seguridad | Tarea programada semanal (domingos 03:00): `pg_dump` completo en `Datos\Copias\`, conserva las 8 últimas |
| Ficha del programa | Icono propio (el favicon del panel) y datos en «Aplicaciones instaladas» |

**Sobre pgAdmin:** no se instala porque no hace falta. pgAdmin es solo un cliente gráfico de administración; el panel habla directo con el motor PostgreSQL, que es lo que va empaquetado. Si el equipo ya tuviera otro PostgreSQL (y su pgAdmin), quedan intactos: este clúster es aparte, con su puerto y su carpeta.

## El asistente, página a página

1. Bienvenida y licencia.
2. Carpeta de instalación.
3. **Configuración del panel** (página propia de este instalador, solo en instalaciones nuevas):
   - Usuario (def. `admin`) y **contraseña del administrador inicial**, dos veces. Puede dejarse vacía: el instalador generará una y la dejará en `PRIMER-ACCESO.txt`.
   - Puerto del panel web (def. 3000).
   - Puerto de la base de datos (def. 5433, solo local).
   - Al pulsar «Siguiente», el asistente **comprueba los dos puertos**: si alguno ya está en uso por otro programa, avisa ahí mismo para poder volver y elegir otro (en actualizaciones la página ni aparece: los puertos los usan los propios servicios de la versión anterior).
4. Accesos (casilla del acceso directo en el escritorio), confirmación, progreso y fin. La regla del cortafuegos para el puerto del panel se crea siempre (perfiles Privado y Dominio, subred local).

En una **actualización** los puertos y el usuario se recuperan solos del registro (`HKLM\Software\USBMonitor\Panel`): la cuenta ya existe y nadie la toca.

## Dónde vive cada cosa

- **Programas:** la ruta elegida (`app\`, `node\`, `pgsql\`, `servicio\`, `scripts\`).
- **Datos:** `C:\ProgramData\USBMonitor\`
  - `Datos\` — el clúster de PostgreSQL (la base de datos entera).
  - `Copias\` — las copias semanales (`usbmonitor-AAAAMMDD-HHMM.sql`). Para restaurar una: detén el servicio del panel y vuelca el archivo con el `psql` integrado usando la contraseña de superusuario de `secretos.json` (la receta exacta está en la cabecera de `scripts\Copia-BaseDatos.ps1`).
  - `Redis\` — los datos de Redis (su `dump.rdb`).
  - `secretos.json` — contraseñas internas (superusuario de la BD, usuario de la aplicación y clave de Redis), generadas al instalar, con ACL cerrada a SYSTEM + Administradores.
  - `Registros\` — `instalacion.log` (lo que hicieron los scripts del instalador), `redis.log` y los registros de los servicios.
  - `PRIMER-ACCESO.txt` — solo aparece en instalación silenciosa (sin asistente): la contraseña de administrador generada. Se borra a mano tras cambiarla.
- **El `.env` del panel** se genera dentro de `app\` con `DATABASE_URL`, `SESSION_SECRET` aleatorio, `APP_PUBLIC_HOST` = nombre del equipo, `ALLOWED_ORIGINS` con localhost, el nombre y la IP local detectada al instalar, y `REDIS_URL` apuntando al Redis integrado (127.0.0.1:6381, con su clave). También con ACL cerrada.
- **Sobre el puerto de Redis (6381, fijo):** no es el 6379 habitual a propósito — así nunca choca con un Redis que el equipo ya tenga — y por eso el asistente no lo pregunta: no hay nada que elegir. Si hiciera falta cambiarlo, se toca en `redis\redis.conf` y en el `REDIS_URL` del `.env`, y se reinician los servicios `USBMonitorRedis` y `USBMonitorPanel`.

## Si la instalación falla: los registros

El instalador **exige administrador desde el arranque** (pide la elevación UAC al abrirlo; sin ella ni siquiera empieza). Si un paso falla, el asistente lo anuncia con su nombre y **nada se borra**: lo instalado queda en su sitio y los registros están en dos archivos:

| Registro | Qué cuenta |
|---|---|
| `C:\ProgramData\USBMonitor-instalacion.log` | Lo que hicieron los scripts del instalador, paso a paso y con las salidas de los comandos: `[BD]` (initdb, registro del servicio, creación del rol), `[Redis]` (configuración, servicio, PING) y `[Panel]` (Prisma con su salida entera, WinSW, cortafuegos, arranque). Es el espejo del `Registros\instalacion.log` de la carpeta de datos, fuera de su árbol. |
| `%TEMP%\Setup Log *.txt` (el más reciente) | El registro del propio Inno Setup: archivos copiados, valores escritos y los códigos de salida de cada script que lanzó. Lo genera solo en cada intento. |

Para diagnosticar un fallo hacen falta **esos dos archivos**: el primero dice en qué paso y con qué salida; el segundo, cómo fue la parte del instalador.

## La contraseña del asistente, sin dejar huella

Los scripts de configuración corren ya terminada la copia y no leen la interfaz. Por eso el paso es: el propio instalador deja usuario+contraseña en `acceso-inicial.ini` dentro de la carpeta de datos, con ACL mínima por SID; el script de configuración lo lee para crear la cuenta, lo **sobrescribe con bytes aleatorios y lo borra**. La contraseña no va al registro, ni al `.env`, ni queda en ningún archivo permanente.

La cuenta se crea con `crear-admin-instalador.mjs`, que replica el formato exacto del panel (`argon2id$` + Argon2id con los mismos parámetros, apiKey `uk_…`) y es idempotente: si ya existe un administrador, no hace nada.

## Actualizar y desinstalar

- **Actualizar:** ejecutar el instalador nuevo encima (mismo `AppId`, se reconoce solo): sustituye los programas, conserva la carpeta de datos, el `.env` (solo refresca el puerto), los secretos y todas las cuentas. Tras actualizar, los servicios quedan arrancados. **Ojo al venir de una versión `.msi` (≤1.4.1):** desinstala primero la entrada vieja desde «Aplicaciones instaladas» (la carpeta de datos se conserva, como siempre) y luego ejecuta el `.exe`; no lo hagas al revés, porque desinstalar el MSI después retiraría los servicios que el `.exe` acaba de registrar.
- **Desinstalar:** quita programas, servicios y la regla de cortafuegos. **La carpeta `C:\ProgramData\USBMonitor` se conserva a propósito** (ahí está la base de datos): para una limpieza total, se borra a mano después.

## Construir el instalador

En el PC de desarrollo (Windows), desde esta carpeta:

```powershell
.\Construir-Instalador.ps1            # versión 1.0.0
.\Construir-Instalador.ps1 -Version 1.1.0
```

El script: localiza Inno Setup 6 (si falta, descarga su instalador oficial y lo instala en silencio — solo hace falta en el PC de construcción), descarga las versiones fijadas de `versiones.wxi` (Node portable, binarios de PostgreSQL, binarios de Redis, WinSW; la primera vez imprime sus SHA-256 para que puedas fijarlos en `$HashEsperado` — el de Redis ya va fijado y se verifica en cada construcción), compila el panel (`npm ci`, `prisma generate`, `npm run build`, poda de devDependencies), prepara el árbol en `salida-instalador\preparado\` — **excluyendo siempre el `.env` local** — y compila `Panel.iss` en español. Resultado: `salida-instalador\USBMonitor-Panel-<versión>.exe` con su SHA-256.

## Dos variantes: ligero y completo

Cada Release del panel lleva **dos** instaladores de la misma versión:

| Variante | Archivo | Qué lleva |
|---|---|---|
| Ligero | `USBMonitor-Panel-<versión>.exe` | El panel, como siempre. El paquete del agente se sube después desde Ajustes (sección «Paquete del agente») o se coloca a mano en `paquete-agente\` y `empujador\`. |
| Completo | `USBMonitor-Panel-<versión>-completo.exe` | Lo mismo **más el paquete del agente dentro**: `USBMonitorService.exe` y `manifiesto.json` en `paquete-agente\`, y `USBMonitorEmpujador.exe` en `empujador\`, dentro de la carpeta de instalación. El panel nace listo para actualizar agentes e instalar en remoto, sin subir nada. |

Son el mismo producto (mismo `AppId`): instalar uno sobre el otro es una actualización normal, y ambos comparten la carpeta de datos — cambiar de variante no toca la base de datos ni la configuración.

### De dónde sale el paquete que va dentro

El contenido de `-PaqueteDir` es el de la **Release vigente del agente**: su zip trae los dos ejecutables (`USBMonitorService.exe` y `USBMonitorEmpujador.exe`). Solo falta el manifiesto, que se genera con la versión de esa Release:

```powershell
Expand-Archive USBMonitorService-agente-v1.0.11.zip -DestinationPath paquete-1.0.11
'{ "version": "1.0.11" }' | Set-Content paquete-1.0.11\manifiesto.json -Encoding utf8
```

### Construir la variante completo a mano

```powershell
.\Construir-Instalador.ps1 -Version 1.3.0 -Completo -PaqueteDir D:\paquete-1.0.11
```

Sin `-Completo`, el comportamiento y el nombre de salida son los de siempre. Con `-Completo`, el script comprueba el paquete **antes** de descargar o compilar nada y se detiene con el motivo claro si falta `-PaqueteDir` o alguno de los tres archivos.

En GitHub no hay que preparar nada de esto: el workflow de la Release del panel descarga él solo la Release vigente del agente, genera el manifiesto, construye las dos variantes con este mismo script y publica **ambos instaladores en la misma Release**.

## También sale por GitHub Actions (Releases)

Igual que el agente: el workflow `.github/workflows/panel-instalador.yml` corre **el mismo** `Construir-Instalador.ps1` en una máquina Windows de GitHub.

- **Con etiqueta** `panel-vX.Y.Z` (las del agente son `agente-v*`: no se pisan): construye el instalador con esa versión y lo publica en la Release de la etiqueta, permanente.
- **A mano** (Actions → «Panel — instalador Inno Setup» → Run workflow): pides la versión en el formulario y el instalador queda como artefacto de la corrida durante 30 días.

La primera corrida de este workflow es, además, la primera compilación real del instalador: si `Panel.iss` o algún script tuvieran un problema, saltará ahí antes que en tu PC.

## Lista de prueba en el PC real (la primera vez)

1. Instalar en una máquina (o VM) **sin** PostgreSQL previo: asistente completo, y al final `http://localhost:3000` abre el panel y entra con el administrador creado.
2. Desde otro equipo de la red: `http://<nombre-o-IP>:3000` responde (cortafuegos) y un agente puede reportar.
3. Reiniciar el equipo: panel y BD arrancan solos; el panel responde sin tocar nada.
4. Servicios: `USBMonitorPostgreSQL`, `USBMonitorRedis` y `USBMonitorPanel` en «Ejecución» y «Automático». Detener el del panel → vuelve solo (reinicio por fallo) o al arrancar el equipo. En `Registros\instalacion.log` deben verse las tres piezas listas ([BD], [Redis] y [Panel]) y el panel ya no avisa de que le falta `REDIS_URL`.
5. Desinstalar y reinstalar: los datos (equipos, usuarios, lista blanca) siguen ahí.
6. Actualizar con un instalador de versión mayor: mismo resultado, sin página de configuración (puertos recuperados).

## Problemas previstos

- **Un paso de la instalación falla:** el asistente nombra el paso (base de datos, Redis o configuración del panel) y nada se borra. La causa queda en los dos registros de la sección «Si la instalación falla»: `C:\ProgramData\USBMonitor-instalacion.log` y el `%TEMP%\Setup Log *.txt` más reciente. Corregida la causa, se vuelve a ejecutar el instalador: los pasos ya hechos se detectan y no se repiten.
- **SmartScreen / «editor desconocido»:** el instalador no va firmado (no hay certificado). Windows avisará al ejecutarlo; se continúa con «Más información → Ejecutar de todos modos». Firmarlo queda para cuando haya certificado.
- **`initdb` o Prisma fallan con errores de DLL:** falta el *Microsoft Visual C++ Redistributable* 2015-2022 (x64) en ese equipo; se instala una vez y se reintenta (la instalación del panel se puede reparar/repetir sin perder datos).
- **Puerto ocupado:** el asistente avisa al configurar si el puerto del panel o el de la BD ya están en uso. Si se continúa de todos modos, el servicio del panel no arrancará; queda en `Registros\instalacion.log` y en el registro del servicio. Solución: liberar el puerto o desinstalar y reinstalar eligiendo otro.
- **Redis no arranca:** queda como AVISO en `Registros\instalacion.log` (con el detalle en `Registros\redis.log`) y la instalación termina igual: el panel funciona sin Redis, como antes, con la presencia y los límites en memoria. Lo más probable es que algo ocupe el 6381; liberado el puerto, basta reiniciar el servicio `USBMonitorRedis`.
- **La IP del servidor cambia (DHCP):** los orígenes permitidos se fijaron al instalar. Acceder por el **nombre del equipo** (estable) evita el problema; si se cambia de IP de forma permanente, editar `ALLOWED_ORIGINS` en `app\.env` y reiniciar el servicio `USBMonitorPanel`.
- **El panel abre en el propio equipo pero no desde otro ordenador de la red:** el panel escucha en todas las interfaces por defecto, así que casi siempre es el cortafuegos de Windows. Dos cosas a revisar: (1) que la regla «USB Monitor — Panel» exista — se crea al instalar y al actualizar —; y (2) el **perfil de red** del servidor: la regla solo cubre los perfiles **Privado** y **Dominio**. Si Windows trata esa red como **Pública** (pasa a menudo con Ethernet recién conectada), el tráfico de la LAN no entra: se cambia en Configuración → Red e Internet → Propiedades de la red → «Privada».
- **La BD corre como LocalSystem** (igual que el agente y el panel): decisión deliberada de la v1 para que el servicio funcione igual en Windows en cualquier idioma (las cuentas con nombre, como «Servicio de red», cambian según el idioma). Endurecerlo a una cuenta de servicio dedicada es posible más adelante.

## Qué NO hace esta versión

- **No usa internet al instalar:** el instalador es *full offline* — todo lo que necesita (panel, Node, PostgreSQL, Redis, WinSW) viaja dentro del `.exe`, y ningún paso de la instalación llama a fuera (hasta la telemetría de Prisma va apagada). La descarga de binarios ocurre solo al CONSTRUIR el instalador, en el PC de desarrollo o en GitHub.
- No firma el paquete (ver arriba).
- No instala HTTPS: dentro de la LAN va por HTTP; para exponerlo con HTTPS, el camino del proyecto es poner Caddy delante (kit aparte).
- No migra datos desde una instalación «a mano» existente: instala su propio clúster vacío. (Si hiciera falta poblarlo desde el PostgreSQL actual, se hace con `pg_dump`/`pg_restore` a mano, una sola vez.)
