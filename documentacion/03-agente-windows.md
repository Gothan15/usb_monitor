# USB Monitor — El agente para Windows

Documentación del proyecto · 3 de 5
Versión del sistema: noviembre de 2026 (agente en C#/.NET 8)

## Un solo ejecutable

`USBMonitorService.exe` es autocontenido (no necesita .NET instalado) y es una aplicación de ventanas: **no abre consola** en ningún modo. Según el argumento, funciona como:

| Modo | Qué hace |
| --- | --- |
| (servicio) | El servicio de Windows `USBMonitorService`: vigila, bloquea y reporta. |
| `gui` | Ventana de gestión («caja de herramientas»): estado, configuración, registro. |
| `prompt` | El compañero: ventana de contraseña en la sesión del usuario. |
| `visor` | Lista los dispositivos USB presentes con sus seriales. |
| `instalar` | Se instala a sí mismo: servicio + tarea del compañero, y arranca ambos. |
| `desinstalar` | Restaura todo, quita el servicio y la tarea. |
| `restaurar` | Deshace a mano los cambios que hayan podido quedar. |
| `configurar` | Abre el asistente de configuración. |
| `fijar-token` | Guarda el token del equipo en `server.json`. |

## Instalación

1. Genera el token del equipo en el panel (Equipos → «Token del agente»). Se muestra una sola vez.
2. Copia el ejecutable a una carpeta de la PC (por ejemplo `C:\USBMonitor`).
3. Ejecuta `USBMonitorService.exe instalar` como administrador.
4. Si no hay configuración, se abre el **asistente de primera configuración** (cinco pasos): servidor (host, puerto, esquema), token y comprobación de conexión.
5. El servicio queda con arranque automático y recuperación ante fallos (Windows lo reinicia si se cae). El compañero queda programado al iniciar sesión **y se lanza en el acto** al instalar, sin esperar al siguiente inicio de sesión.

## Configuración: server.json

Toda la configuración vive en `server.json`, junto al ejecutable o en `C:\ProgramData\USBMonitor`:

```json
{
  "serverHost": "192.168.1.10",
  "serverPort": 3000,
  "serverScheme": "http",
  "agentToken": "ENC:…",
  "sslVerify": true
}
```

- El **token** se guarda cifrado (formato `ENC:`) cuando se guarda desde la ventana de gestión. Si está en claro, funciona igual, pero conviene re-guardarlo una vez para que quede cifrado.
- El cliente registra en su log la **huella** del token que presenta (primeros 12 caracteres de su SHA-256) y su longitud, nunca el token: así se puede comprobar si el token de la PC y el del panel coinciden sin exponerlo.
- Los agentes se autentican solo con su token de equipo (cabecera `Authorization: AgentToken <token>`). La clave API de usuario ya no autentica agentes.

## Detección

- Sondeo cada 1,5 segundos; vigía de bloqueos y del compañero cada 5 segundos.
- Discos y memorias USBSTOR; discos SCSI solo si un ancestro PnP (hasta 3 niveles, con caché) es USB — un SATA interno jamás se bloquea.
- Teléfonos por WPD, solo si su instancia empieza por `USB\` (un volumen interno con identificador GUID no debe colarse como «memoria fantasma»).
- Unidades ópticas USB y adaptadores de red USB. Impresoras USB (clase Printer sobre USBPRINT/USB): se detectan y registran, **nunca se bloquean**.

## Bloqueo por capas

1. **PnP verificado**: desactivar el nodo y confirmar el código de problema 22. En discos duros cuyo nodo se queda «a la espera de reinicio», se desciende al nodo USB del dispositivo (jamás al concentrador raíz ni al controlador), y el nodo efectivamente bloqueado es el que se anota y se restaura.
2. **Volumen**: bloqueo y desmonte de **todas** las particiones del disco.
3. **Solo lectura** con `diskpart`: último respaldo, degradado y declarado.

Cada capa se verifica antes de dar el bloqueo por bueno. Si ninguna funciona, el evento llega al panel como «sin bloqueo efectivo»: nunca se finge un bloqueo que no existe.

## El compañero

- Arranca **oculto** y solo aparece cuando el servicio anota un bloqueo en su archivo local de bloqueos (lo revisa cada 2 segundos). Oculto no significa ausente.
- Tiene mutex de instancia única: una segunda copia sale al instante.
- Cerrar la ventana con la X **solo la oculta**. Si el proceso muere, el servicio lo relanza en la sesión de consola activa (si falta en dos chequeos seguidos, con reintentos cada 30 segundos).
- Muestra también el dueño del equipo y el modo de desbloqueo vigente (normal o solo administradores), que el servicio obtiene del panel.

## Sin huella

El agente anota cada cambio persistente con su valor original y lo revierte: al extraer el dispositivo, al parar el servicio, al desinstalar y al arrancar tras un apagado sucio. El modo `restaurar` permite forzar esa restauración a mano.

## Emergencia sin red

Si el panel no responde, el dispositivo queda bloqueado. Para los bloqueos con dueño conocido, el agente guarda la huella de la contraseña del dueño cifrada y sirve una página local, `http://localhost:5001/desbloquear`, que puede liberar el dispositivo con esa contraseña (máximo 5 intentos cada 15 minutos). Los intentos sin conexión se reportan al panel cuando vuelve la red.

## Registros

El servicio, el compañero y el instalador escriben sus propios registros (`agente.log`, `companero.log`) junto al ejecutable o en la carpeta de datos. Ante cualquier problema, esos dos archivos cuentan la historia completa: detección, capa de bloqueo aplicada, huella del token presentado y respuestas del panel.
