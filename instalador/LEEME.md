# Instalador del panel (.msi)

Convierte el panel de USB Monitor en **una aplicación que se instala como cualquier programa de Windows**: doble clic, asistente clásico (el de los instaladores de siempre, en español), y al terminar el servidor queda corriendo como servicio, con su base de datos propia debajo. Sin montar piezas a mano.

## Qué instala

| Pieza | Cómo queda |
|---|---|
| Panel web (Next.js compilado) | Carpeta `app\` en la ruta elegida (def. `C:\Program Files\USB Monitor Panel`) |
| Node.js | Integrado (`node\node.exe`, versión fijada): el equipo NO necesita tener Node |
| Base de datos | **PostgreSQL integrado y privado**: clúster propio creado con `initdb`, servicio `USBMonitorPostgreSQL`, puerto propio (def. 5433), solo escucha en localhost |
| Servicio del panel | `USBMonitorPanel` (WinSW), automático, se reinicia si cae, depende del servicio de la BD |
| Accesos directos | Escritorio y menú Inicio: «Abrir el panel» (lee el puerto real del registro) |
| Cortafuegos (opcional) | Regla de entrada para el puerto del panel, limitada a la **subred local** y a los perfiles de red **Privado** y **Dominio** |
| Copia de seguridad | Tarea programada semanal (domingos 03:00): `pg_dump` completo en `Datos\Copias\`, conserva las 8 últimas |
| Ficha del programa | Icono propio (el favicon del panel) y datos en «Aplicaciones instaladas» |

**Sobre pgAdmin:** no se instala porque no hace falta. pgAdmin es solo un cliente gráfico de administración; el panel habla directo con el motor PostgreSQL, que es lo que va empaquetado. Si el equipo ya tuviera otro PostgreSQL (y su pgAdmin), quedan intactos: este clúster es aparte, con su puerto y su carpeta.

## El asistente, página a página

1. Bienvenida y licencia (interfaz estándar de WixUI).
2. Carpeta de instalación.
3. **Configuración del servidor** (página propia de este instalador):
   - Puerto del panel web (def. 3000).
   - Puerto de la base de datos (def. 5433, solo local).
   - Usuario y **contraseña del administrador inicial** — sin contraseña no se puede avanzar en una instalación nueva.
   - Casilla del cortafuegos (marcada por defecto).
   - Al pulsar «Siguiente» en esta página, el asistente **comprueba los dos puertos**: si alguno ya está en uso por otro programa, avisa ahí mismo para poder volver y elegir otro (en actualizaciones no comprueba: los puertos los usan los propios servicios de la versión anterior).
4. Confirmación, progreso y fin.

En una **actualización** los puertos y el usuario se recuperan solos del registro (`HKLM\Software\USBMonitor\Panel`) y la contraseña puede dejarse vacía: la cuenta ya existe y nadie la toca.

## Dónde vive cada cosa

- **Programas:** la ruta elegida (`app\`, `node\`, `pgsql\`, `servicio\`, `scripts\`).
- **Datos:** `C:\ProgramData\USBMonitor\`
  - `Datos\` — el clúster de PostgreSQL (la base de datos entera).
  - `Copias\` — las copias semanales (`usbmonitor-AAAAMMDD-HHMM.sql`). Para restaurar una: detén el servicio del panel y vuelca el archivo con el `psql` integrado usando la contraseña de superusuario de `secretos.json` (la receta exacta está en la cabecera de `scripts\Copia-BaseDatos.ps1`).
  - `secretos.json` — contraseñas internas (superusuario de la BD y usuario de la aplicación), generadas al instalar, con ACL cerrada a SYSTEM + Administradores.
  - `Registros\` — `instalacion.log` (lo que hicieron los scripts del instalador) y los registros del servicio del panel.
  - `PRIMER-ACCESO.txt` — solo aparece en instalación silenciosa (sin asistente): la contraseña de administrador generada. Se borra a mano tras cambiarla.
- **El `.env` del panel** se genera dentro de `app\` con `DATABASE_URL`, `SESSION_SECRET` aleatorio, `APP_PUBLIC_HOST` = nombre del equipo y `ALLOWED_ORIGINS` con localhost, el nombre y la IP local detectada al instalar. También con ACL cerrada.
- **Redis no se instala a propósito:** sin `REDIS_URL` el panel limita los intentos en memoria (válido para una sola instancia, que es este caso; lo avisa en su registro).

## La contraseña del asistente, sin dejar huella

Las acciones diferidas de un MSI corren como SYSTEM y no pueden leer lo que se escribió en la interfaz. Por eso el paso es: una acción inmediata incrustada en el propio MSI (`GuardarAdmin.vbs`) deja usuario+contraseña en `acceso-inicial.ini` dentro de la carpeta de datos, con ACL mínima por SID; el script de configuración lo lee para crear la cuenta, lo **sobrescribe con bytes aleatorios y lo borra**. La contraseña no va al registro, ni al `.env`, ni queda en ningún archivo permanente.

La cuenta se crea con `crear-admin-instalador.mjs`, que replica el formato exacto del panel (`argon2id$` + Argon2id con los mismos parámetros, apiKey `uk_…`) y es idempotente: si ya existe un administrador, no hace nada.

## Actualizar y desinstalar

- **Actualizar:** ejecutar el `.msi` nuevo. Es un `MajorUpgrade`: sustituye los programas, conserva la carpeta de datos, el `.env` (solo refresca el puerto), los secretos y todas las cuentas. Tras actualizar, los servicios quedan arrancados.
- **Desinstalar:** quita programas, servicios y la regla de cortafuegos. **La carpeta `C:\ProgramData\USBMonitor` se conserva a propósito** (ahí está la base de datos): para una limpieza total, se borra a mano después.

## Construir el .msi

En el PC de desarrollo (Windows), desde esta carpeta:

```powershell
.\Construir-Instalador.ps1            # versión 1.0.0
.\Construir-Instalador.ps1 -Version 1.1.0
```

El script: instala WiX v5 si falta, descarga las versiones fijadas de `versiones.wxi` (Node portable, binarios de PostgreSQL, WinSW; la primera vez imprime sus SHA-256 para que puedas fijarlos en `$HashEsperado`), compila el panel (`npm ci`, `prisma generate`, `npm run build`, poda de devDependencies), prepara el árbol en `salida-instalador\preparado\` — **excluyendo siempre el `.env` local** — y compila `Panel.wxs` con la extensión de interfaz, en español. Resultado: `salida-instalador\USBMonitor-Panel-<versión>.msi` con su SHA-256.

## Dos variantes: ligero y completo

Cada Release del panel lleva **dos** instaladores de la misma versión:

| Variante | Archivo | Qué lleva |
|---|---|---|
| Ligero | `USBMonitor-Panel-<versión>.msi` | El panel, como siempre. El paquete del agente se sube después desde Ajustes (sección «Paquete del agente») o se coloca a mano en `paquete-agente\` y `empujador\`. |
| Completo | `USBMonitor-Panel-<versión>-completo.msi` | Lo mismo **más el paquete del agente dentro**: `USBMonitorService.exe` y `manifiesto.json` en `paquete-agente\`, y `USBMonitorEmpujador.exe` en `empujador\`, dentro de la carpeta de instalación. El panel nace listo para actualizar agentes e instalar en remoto, sin subir nada. |

Son el mismo producto (mismo `UpgradeCode`): instalar uno sobre el otro es una actualización normal, y ambos comparten la carpeta de datos — cambiar de variante no toca la base de datos ni la configuración.

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

En GitHub no hay que preparar nada de esto: el workflow de la Release del panel descarga él solo la Release vigente del agente, genera el manifiesto, construye las dos variantes con este mismo script y publica **ambos .msi en la misma Release**.

## También sale por GitHub Actions (Releases)

Igual que el agente: el workflow `.github/workflows/panel-instalador.yml` corre **el mismo** `Construir-Instalador.ps1` en una máquina Windows de GitHub.

- **Con etiqueta** `panel-vX.Y.Z` (las del agente son `agente-v*`: no se pisan): construye el `.msi` con esa versión y lo publica en la Release de la etiqueta, permanente.
- **A mano** (Actions → «Panel — instalador MSI» → Run workflow): pides la versión en el formulario y el `.msi` queda como artefacto de la corrida durante 30 días.

La primera corrida de este workflow es, además, la primera compilación real del instalador: si WiX o algún script tuvieran un problema, saltará ahí antes que en tu PC.

## Lista de prueba en el PC real (la primera vez)

1. Instalar en una máquina (o VM) **sin** PostgreSQL previo: asistente completo, y al final `http://localhost:3000` abre el panel y entra con el administrador creado.
2. Desde otro equipo de la red: `http://<nombre-o-IP>:3000` responde (cortafuegos) y un agente puede reportar.
3. Reiniciar el equipo: panel y BD arrancan solos; el panel responde sin tocar nada.
4. Servicios: `USBMonitorPostgreSQL` y `USBMonitorPanel` en «Ejecución» y «Automático». Detener el del panel → vuelve solo (reinicio por fallo) o al arrancar el equipo.
5. Desinstalar y reinstalar: los datos (equipos, usuarios, lista blanca) siguen ahí.
6. Actualizar con un `.msi` de versión mayor: mismo resultado, sin asistente de configuración efectivo (puertos recuperados).

## Problemas previstos

- **SmartScreen / «editor desconocido»:** el `.msi` no va firmado (no hay certificado). Windows avisará al ejecutarlo; se continúa con «Más información → Ejecutar de todos modos». Firmarlo queda para cuando haya certificado.
- **VBScript en retirada (aviso WIX1163 al compilar, suprimido a propósito con `-sw1163` en el script de construcción):** dos acciones inmediatas del asistente (guardar la contraseña inicial y comprobar puertos) están en VBScript, un componente que Microsoft está retirando de Windows. Hoy funcionan; si en un Windows futuro falta VBScript, ambas llevan `Return="ignore"` y el instalador sigue: sin la primera, la cuenta inicial se genera sola y queda en `PRIMER-ACCESO.txt`; sin la segunda, solo se pierde el aviso de puertos ocupados. Migración prevista: pasarlas a PowerShell.
- **`initdb` o Prisma fallan con errores de DLL:** falta el *Microsoft Visual C++ Redistributable* 2015-2022 (x64) en ese equipo; se instala una vez y se reintenta (la instalación del panel se puede reparar/repetir sin perder datos).
- **Puerto ocupado:** el asistente avisa al configurar si el puerto del panel o el de la BD ya están en uso. Si se continúa de todos modos, el servicio del panel no arrancará; queda en `Registros\instalacion.log` y en el registro del servicio. Solución: liberar el puerto o desinstalar y reinstalar eligiendo otro.
- **La IP del servidor cambia (DHCP):** los orígenes permitidos se fijaron al instalar. Acceder por el **nombre del equipo** (estable) evita el problema; si se cambia de IP de forma permanente, editar `ALLOWED_ORIGINS` en `app\.env` y reiniciar el servicio `USBMonitorPanel`.
- **El panel abre en el propio equipo pero no desde otro ordenador de la red:** el panel escucha en todas las interfaces por defecto, así que casi siempre es el cortafuegos de Windows. Dos cosas a revisar: (1) que la casilla del cortafuegos quedara marcada al instalar — la regla «USB Monitor — Panel» se crea al instalar y al actualizar; y (2) el **perfil de red** del servidor: la regla solo cubre los perfiles **Privado** y **Dominio**. Si Windows trata esa red como **Pública** (pasa a menudo con Ethernet recién conectada), el tráfico de la LAN no entra: se cambia en Configuración → Red e Internet → Propiedades de la red → «Privada».
- **La BD corre como LocalSystem** (igual que el agente y el panel): decisión deliberada de la v1 para que el servicio funcione igual en Windows en cualquier idioma (las cuentas con nombre, como «Servicio de red», cambian según el idioma). Endurecerlo a una cuenta de servicio dedicada es posible más adelante.

## Qué NO hace esta versión

- No firma el paquete (ver arriba).
- No instala HTTPS: dentro de la LAN va por HTTP; para exponerlo con HTTPS, el camino del proyecto es poner Caddy delante (kit aparte).
- No migra datos desde una instalación «a mano» existente: instala su propio clúster vacío. (Si hiciera falta poblarlo desde el PostgreSQL actual, se hace con `pg_dump`/`pg_restore` a mano, una sola vez.)
