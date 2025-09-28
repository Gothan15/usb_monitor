# USBMonitor - Ejecutable portable

Este proyecto empaqueta `detector_usb_fixed.py` en un `.exe` para Windows con PyInstaller, evitando dependencias manuales en el equipo destino.

## Requisitos en la máquina de build

- Windows
- Python 3.9+ en PATH
- PowerShell (pwsh)

## Empaquetar el ejecutable

En PowerShell (Abrir en `d:\Monitor_USB`):

```pwsh
# Construcción por defecto (carpeta dist/USBMonitor con .exe y dependencias)
./build_exe.ps1

# O como un único archivo .exe (más lento al arrancar, pero 1 solo archivo)
./build_exe.ps1 -OneFile
```

El ejecutable quedará en:

- Carpeta: `dist/USBMonitor/USBMonitor.exe`
- Un fichero (si `-OneFile`): `dist/USBMonitor.exe`

## Primera ejecución y configuración

- Ejecuta `USBMonitor.exe --console` para ver logs y probar USB.
- Al ejecutarse, se generará (si no existe) un `config.json` junto al `.exe` con:
  - `server_url`: URL del endpoint
  - `service_name`: nombre lógico del servicio (no aplica en modo exe)

Puedes editar `config.json` para apuntar al servidor correcto.

## Uso (sin instalar nada)

```pwsh
# Monitor en consola
USBMonitor.exe --console

# Probar conexión HTTP (requiere API Key configurada en agente si la implementación lo añade)
USBMonitor.exe --test
```

Nota: El modo "servicio" clásico de Windows no aplica directamente a un exe PyInstaller sin registrar el servicio. Para reemplazarlo, usa una Tarea Programada que ejecute `USBMonitor.exe --console` al iniciar sesión del usuario.

## Crear Tarea Programada (opcional)

Para ejecutar el monitor automáticamente al iniciar sesión del usuario actual:

```pwsh
$exe = "C:\\ruta\\a\\USBMonitor.exe"
$taskName = "USBMonitor"
$trigger = New-ScheduledTaskTrigger -AtLogOn
$action = New-ScheduledTaskAction -Execute $exe -Argument "--console"
Register-ScheduledTask -TaskName $taskName -Trigger $trigger -Action $action -Description "Monitor USB" -RunLevel Highest -Force
```

Para desregistrar:

```pwsh
Unregister-ScheduledTask -TaskName "USBMonitor" -Confirm:$false
```

## Troubleshooting

- Si no ves logs en consola (porque el exe corre sin ventana), revisa `USBMonitor.log` junto al exe.
- Si el POST no llega, valida conectividad y el `server_url` en `config.json`.
- Si no se bloquea la sesión, recuerda que al correr como Tarea Programada en el contexto del usuario es cuando `LockWorkStation` tiene efecto.
