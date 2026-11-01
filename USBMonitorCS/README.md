# Agente USBMonitor en C# (.NET 8)

El mismo agente de siempre — un solo ejecutable, `USBMonitorService.exe` —
reescrito en C# sobre .NET 8. Convive en esta rama con el agente Python
(`USBMonitor/`), que no se toca: el panel no distingue cuál de los dos
tiene delante porque ambos cumplen el mismo contrato
(`CONTRATO-SERVIDOR.md`) y comparten el `server.json` (el agente C# lee
incluso el token cifrado `ENC:` del agente Python y lo guarda de nuevo
con DPAPI de Windows).

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

```powershell
.\compilacion\Build-All.ps1            # deja el exe en dist\
.\Install-Service.ps1 -ServerHost 192.168.1.10 -ServerPort 3000 -AgentToken <token>
```

`Install-Service.ps1` cumple la misma interfaz que el del agente
Python: es el archivo que la instalación remota del panel sabe copiar
y ejecutar. Para adoptar este agente en producción basta apuntar el
panel a `USBMonitorCS/dist/USBMonitorService.exe` y a este
`Install-Service.ps1` (o copiar el dist sobre `USBMonitor/dist`).

En Linux/macOS de desarrollo: `dotnet build USBMonitorCS.sln` compila
todo (las ventanas van con `EnableWindowsTargeting`) y
`dotnet test` corre la suite del núcleo; el ejecutable solo corre en
Windows, como el agente actual.

## Estado

Hito 1 de la rama `agente-csharp`: paridad de contrato con el agente
Python v2 + asistente de primera vez + interfaz clara. Pendiente:
probar en una PC Windows real (servicio, capas de bloqueo, compañero)
antes de pensar en sustituir al agente Python en producción.
