# Agente USBMonitor en C# (.NET 10)

El mismo agente de siempre — un solo ejecutable, `USBMonitorService.exe` —
reescrito en C# sobre .NET 10. Es el único agente del proyecto: el
original en Python se retiró del repo en la reorganización de
noviembre de 2026 (su código sigue en el historial de git). Ambos
cumplían el mismo contrato (`CONTRATO-SERVIDOR.md`) y comparten el
`server.json` (este agente lee incluso el token cifrado `ENC:` del
agente Python y lo guarda de nuevo con DPAPI de Windows).

## Qué trae de nuevo frente al Python

- **Servicio de Windows nativo** (.NET Worker + SCM), sin pywin32 ni
  empaquetado PyInstaller: un único exe autocontenido.
- **Asistente de configuración de primera vez**: al abrir el agente en
  una PC sin token guardado, una guía de 5 pasos (servidor con prueba
  de conexión, credencial, instalación del servicio y resumen) deja el
  equipo dado de alta. Se reabre cuando se quiera con el modo
  `configurar`.
- **Interfaz renovada en el tema claro del panel** (`DISENO-UI.md`):
  compañero, caja de herramientas y visor en WPF, papel frío y azul
  marino como la web.
- **Cifrado con DPAPI** (ámbito máquina) para el token en `server.json`.
- **Los iconos del proyecto**: el ejecutable y las ventanas usan los
  `.ico` de siempre (`usb_monitor_service.ico` y `usb_prompt.ico`
  para el compañero), que viven en `src/Agente.Servicio/iconos/`
  (antes se enlazaban desde la carpeta del agente en Python).
- La depuración de la otra rama viene de serie: latido cada segundo en
  `latido.log`, salud de la conexión registrada y botón «Probar
  conexión» (en el asistente y en la caja de herramientas).

## Modos del ejecutable

| Modo | Qué hace |
|---|---|
| *(sin argumentos)* | El servicio, bajo el SCM de Windows; con doble clic abre el asistente (primera vez) o la caja de herramientas. |
| `gui` | La caja de herramientas (o el asistente, si es la primera vez). |
| `configurar` | El asistente de configuración, siempre. |
| `prompt` | El compañero: la ventana de la contraseña. |
| `visor` | El visor de seriales. |
| `instalar` / `desinstalar` | Registra o quita el servicio y la tarea del compañero (administrador). |
| `restaurar` | Revierte todo lo del diario y sale. |
| `debug` | El agente en consola, para depurar. |
| `fijar-token <valor>` | Guarda el token del equipo cifrado (lo usa Install-Service.ps1). |

## Estructura

- `src/Agente.Core` — núcleo multiplataforma: configuración y cifrado
  (Fernet compatible + DPAPI), cliente del panel con cola persistente
  y salud, diario sin huella, emergencia sin red (Argon2) y registro
  con latido. Con tests en `tests/Agente.Core.Tests`.
- `src/Agente.Servicio` — el ejecutable: servicio, detección amplia,
  bloqueo en capas (PnP verificado → volumen → solo lectura), servidor
  local :5001 con la página de emergencia, instalador y las ventanas
  WPF (`Ventanas/`, definidas en código, sin XAML).

## Compilar e instalar

La primera compilación descarga los paquetes de NuGet: hace falta
internet **o** la carpeta `paquetes/` con los `.nupkg` del proyecto
(fuente local declarada en `nuget.config`, pensada para compilar sin
conexión). Después los paquetes quedan en la caché del usuario y
recompilar ya no pide red.

```powershell
.\compilacion\Build-All.ps1            # deja el exe en dist\
.\Install-Service.ps1 -ServerHost 192.168.1.10 -ServerPort 3000 -AgentToken <token>
```

`Install-Service.ps1` cumple la misma interfaz que el del agente
Python y sirve para la instalación local en una PC. La instalación
remota no lo usa: la hace el empujador ejecutando el propio exe en
su modo `instalar-remoto`, y el paquete vigente es el que el panel
guarda en su carpeta `paquete-agente/` (el de la última Release).

En Linux/macOS de desarrollo: `dotnet build Agente.sln` compila
todo (las ventanas van con `EnableWindowsTargeting`) y
`dotnet test` corre la suite del núcleo; el ejecutable solo corre en
Windows, como el agente actual.

## Estado

Es el agente en producción: se publica en las Releases `agente-v*`
del repo y sustituyó por completo al agente en Python, retirado del
repo en la reorganización de noviembre de 2026.
