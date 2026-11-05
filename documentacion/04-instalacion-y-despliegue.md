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

## Preparar un destino para la instalación remota (empuje SMB)

La primera instalación en un equipo sin agente va por empuje SMB (el modelo de Kaspersky): el ayudante del panel, `USBMonitorEmpujador.exe`, entra al recurso `C$` del destino con la cuenta administradora de ese equipo, copia el ejecutable del agente a `C:\USBMonitor` y crea un servicio temporal por RPC que lo instala en su modo sin ventanas. En el destino no hace falta activar WinRM ni SSH: ese sistema se retiró.

En la PC destino, una sola vez, como administrador local (grupo de trabajo, sin dominio):

1. **Red en perfil Privado y compartición activa.** Con perfil Público, las reglas de cortafuegos de compartición no aplican en Windows cliente y el puerto 445 no responde; la compartición es además lo que mantiene vivo el recurso `C$`:

   ```powershell
   Set-NetConnectionProfile -NetworkCategory Private
   Enable-NetFirewallRule -DisplayGroup 'Compartir archivos e impresoras'
   Enable-NetFirewallRule -DisplayGroup 'Administración remota de servicios'
   ```

2. **Cuenta administradora local con contraseña.** Es la que se escribe al crear la tarea de instalación; en grupo de trabajo, una cuenta sin contraseña no puede abrir sesión remota. No sirven el PIN de Windows Hello ni una cuenta Microsoft.
3. **El administrador, con su token completo en remoto.** Sin este valor, el administrador local entra recortado por UAC al acceder por red y el gestor de servicios remoto responde «acceso denegado» aunque la contraseña sea la correcta:

   ```powershell
   New-ItemProperty -Path 'HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Policies\System' -Name LocalAccountTokenFilterPolicy -Value 1 -PropertyType DWord -Force
   ```

Si el destino es una máquina virtual (VMware o VirtualBox), el adaptador de red va en modo puente: la máquina queda en la misma red que el panel, con su propia IP; con NAT no se llega. Para Windows 11 hacen falta firmware UEFI y TPM virtual. Con la máquina preparada y aún sin agente, una instantánea permite repetir la prueba siempre desde la máquina virgen.

En el equipo del panel tienen que estar colocados los dos ejecutables, que salen del zip de la Release del agente: el vigente en `paquete-agente\USBMonitorService.exe` (con su `manifiesto.json`) y el empujador en `empujador\USBMonitorEmpujador.exe`. El agente ya instalado debe además poder volver al puerto del panel (3000): si la tarea instala pero el equipo nunca se confirma como instalado, lo que falla suele ser el cortafuegos del equipo del panel.

Al crear la tarea, el propio panel comprueba en vivo cada requisito contra cada destino (puerto 445, sesión SMB, derecho a crear servicios, agente ya presente), y la lista de verificación de Ajustes → Preguntas frecuentes muestra el resultado paso a paso.

## Releases y versionado

- **Agente**: etiquetas `agente-v*` (o disparo manual). La acción ejecuta las pruebas del núcleo, compila con el mismo `Build-All.ps1` de siempre, compila también el empujador del panel y publica el zip con el ejecutable, `Install-Service.ps1` y `USBMonitorEmpujador.exe` en la Release (y como artefacto de 30 días).
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
