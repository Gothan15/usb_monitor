# Agente USBMonitor v2

Reescritura del agente de Windows (2026-11-01). La especificación
completa está en el documento de diseño del proyecto; este README
cubre el uso diario.

## Un solo ejecutable

Todo el agente es `USBMonitorService.exe`; el modo depende del
primer argumento:

| Modo | Qué hace |
|---|---|
| *(sin argumentos)* | El servicio, bajo el control de Windows. |
| `gui` | La caja de herramientas del administrador: estado y control del servicio (iniciar/detener/reiniciar), servidor, credencial, accesos al compañero y al visor, registro y **Restaurar todo**. |
| `prompt` | El compañero: la ventana de la contraseña cuando hay un dispositivo bloqueado. Lo arranca la tarea de inicio de sesión. |
| `visor` | Lista los dispositivos conectados con su serial, para llevarlo a la lista blanca. |
| `restaurar` | Revierte todo lo que el agente haya deshabilitado y sale (lo usa el desinstalador). |
| `debug` | El agente en consola, para depurar. |

La configuración vive solo en `server.json`: el agente no usa
variables de entorno del sistema ni del usuario. Si encuentra una
instalación de la v1 configurada por entorno, la vuelca a
`server.json` en el primer arranque y no vuelve a leerla.

## Compilar

```powershell
cd USBMonitor
.\compilacion\Build-All.ps1                  # los tres
.\compilacion\Build-All.ps1 -ElegirServidor  # eligiendo la IP del servidor
```

## Instalar / desinstalar

```powershell
.\Install-Service.ps1 -ServerHost 192.168.1.10 -ApiKey <clave del dueño>
.\Install-Service.ps1 -Uninstall   # restaura todo ANTES de quitarse
```

Credencial: el token por equipo lo provisiona la instalación desde
el panel; a mano, la clave API del dueño (o guárdala después en la
ventana de gestión, queda cifrada en `server.json`).

## Configuración

`server.json` junto al ejecutable (o en `C:\ProgramData\USBMonitor`)
manda sobre las variables de entorno: `serverHost`, `serverPort`,
`serverScheme`, `agentToken`, `apiKey` (estos dos aceptan el cifrado
`ENC:` de la v1).

## Sin huella

Todo dispositivo que el agente deshabilita queda anotado en
`C:\ProgramData\USBMonitor\diario.json` y se reactiva al extraerlo,
al parar el servicio, al desinstalar y al arrancar de nuevo (por si
hubo un cierre sucio). El botón **Restaurar todo** de la ventana de
gestión hace la misma limpieza a mano.

## Emergencia sin red

Con el servicio en marcha, `http://localhost:5001/desbloquear`
permite al **dueño de la PC** desbloquear con su contraseña de
siempre (verificada localmente contra el hash que el panel entrega
cuando hay red). Máximo 5 intentos y 15 minutos de espera; cada
intento se registra y sube al panel cuando vuelve la conexión.

## Pruebas

```powershell
python -m pytest USBMonitor/tests -q
```
