# Agente USBMonitor v2

Reescritura del agente de Windows (2026-11-01). La especificación
completa está en el documento de diseño del proyecto; este README
cubre el uso diario.

## Los programas

| Ejecutable | Qué hace |
|---|---|
| `USBMonitorService.exe` | El servicio. Sin argumentos corre como servicio; `gui` abre la ventana de gestión; `restaurar` revierte todo lo que el agente haya deshabilitado y sale; `debug` lo ejecuta en consola. |
| `USBMonitorPrompt.exe` | El compañero: muestra la ventana de la contraseña cuando hay un dispositivo bloqueado. Se registra al iniciar sesión. |
| `USBSerialViewer.exe` | Lista los dispositivos conectados con su serial, para llevarlo a la lista blanca. |

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
