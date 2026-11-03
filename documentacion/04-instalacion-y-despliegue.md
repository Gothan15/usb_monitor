# USB Monitor — Instalación y despliegue completo

Documentación del proyecto · 4 de 5
Versión del sistema: noviembre de 2026 (panel 1.0.4)

## Orden de despliegue

1. **El servidor**: instala el panel (con el .msi o a mano, ver el documento 2).
2. **El primer administrador**: lo crea el instalador o `npm run user:create`.
3. **Los usuarios**: crea en el panel una cuenta por persona.
4. **Los equipos y sus tokens**: en Equipos, genera el token de cada PC (se muestra una vez).
5. **El agente en cada PC**: instalación local con su token, o instalación remota desde el panel.
6. **Asignación de dueños**: en Usuarios, asigna cada cuenta a su equipo y re-guarda la asignación una vez.
7. **La lista blanca**: da de alta los seriales conocidos (el visor del agente sirve para copiarlos).
8. **Prueba real**: conecta un dispositivo conocido (debe bloquearse y pedir contraseña) y uno desconocido (debe negarse sin pedir contraseña).

## El servidor con el instalador .msi

- Archivo: `USBMonitor-Panel-<versión>.msi`, en la pestaña Releases (última: 1.0.4, 230,8 MB).
- Instala en `C:\Program Files\USBMonitor` y datos en `C:\ProgramData\USBMonitor` (secretos con ACL cerrada).
- PostgreSQL 17.5 propio en un puerto propio (por defecto 5433), Node.js 22 portable y WinSW 2.12 como gestor del servicio del panel, que depende de la base de datos.
- Copia de seguridad semanal de la base (domingos 03:00 como SYSTEM, rotación de 8).
- Actualización: instalar el .msi nuevo encima; los valores se leen del registro y los datos no se tocan.

## Preparar un destino para instalación remota (WinRM)

En la PC destino, una sola vez, como administrador local (grupo de trabajo, sin dominio):

```powershell
Enable-PSRemoting -SkipNetworkProfileCheck -Force
winrm set winrm/config/service/Auth '@{Basic="true";Negotiate="true"}'
winrm set winrm/config/service '@{AllowUnencrypted="true"}'
```

- La cuenta administradora local debe tener contraseña.
- El perfil de red «Público» es el gran bloqueador en Windows cliente: o la red se pone como Privada, o se usa `-SkipNetworkProfileCheck`.
- Sin la política que permite a los administradores locales actuar por red con su token completo, la conexión entra recortada por UAC y da «Acceso denegado».
- La autenticación Basic por HTTP va en claro: es la vía de las cuentas locales sin dominio. La alternativa seria es WinRM por HTTPS (5986).
- Antes de instalar, usa el botón «Comprobar requisitos en el destino» del panel: verifica cada punto y dice el comando exacto que falta.

## Releases y versionado

- **Agente**: etiquetas `agente-v*` (o disparo manual). La acción ejecuta las pruebas del núcleo, compila con el mismo `Build-All.ps1` de siempre y publica el zip del ejecutable más `Install-Service.ps1` en la Release (y como artefacto de 30 días).
- **Panel**: etiquetas `panel-v*` (o disparo manual con versión). La acción ejecuta el mismo `Construir-Instalador.ps1` que en local y publica el .msi en la Release.
- Subir de versión = crear la etiqueta siguiente. Una etiqueta ya publicada no se reescribe: si el código cambia, toca número nuevo (así nacieron la 1.0.2, la 1.0.3 y la 1.0.4).

## Historia breve del instalador (por qué hay cuatro versiones)

- **1.0.0**: el .wxs estaba escrito para WiX v4 y la herramienta es la v5: errores de esquema.
- **1.0.1**: la compilación de Next caía en el runner por falta de `SESSION_SECRET` y el script no se detenía ante fallos.
- **1.0.2**: la preferencia estricta de PowerShell, añadida para detenerse ante fallos, mataba también las sondas inocentes (`wix extension list`, robocopy).
- **1.0.3**: un nombre de la época de WiX v3 (`WixUIBannerBmp`) en el diálogo propio; en v5 se llama `WixUI_Bmp_Banner`.
- **1.0.4**: primera versión que completa la cadena entera. Cada fallo dejó su arreglo en el repositorio (PR #54 a #57).

## Copias y recuperación

- La base de datos se copia semanalmente por la tarea del instalador; la restauración es un `pg_restore` sobre el clúster de `C:\ProgramData\USBMonitor`.
- Los agentes no guardan estado insustituible: su cola de eventos es en disco y se vacía al recuperar la conexión, y su configuración es un único `server.json`.
- Si un agente deja de dar señales, el panel lo marca sin señal: es la evidencia de que algo pasó en esa PC (servicio detenido, PC apagada o red caída), no un error del panel.
