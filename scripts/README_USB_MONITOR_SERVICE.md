# Servicio de monitoreo USB para Windows

este directorio contiene el script `usb_monitor_service.py`, encargado de registrar
la conexión de memorias USB en un equipo Windows, notificar al backend de Monitor_USB
mediante un `POST /api/usb-event` y bloquear la unidad en modo **solo lectura**
utilizando `diskpart`.

## Requisitos

Instala las dependencias en un Python 3.10+ (ejecuta como administrador si vas a instalar el servicio):

```
pip install -r usb_monitor_requirements.txt
```

## Variables de entorno opcionales

- `USB_MONITOR_SERVER_HOST`: host del backend (por defecto `172.20.10.12`).
- `USB_MONITOR_SERVER_PORT`: puerto del backend (por defecto `3000`).
- `USB_MONITOR_ENDPOINT`: ruta del endpoint para eventos (por defecto `/api/usb-event`).
- `USB_MONITOR_API_KEY`: **obligatorio** para la comunicación autenticada (agente ⇄ backend).
- `USB_MONITOR_LOG_PATH`: ruta del log. Si apunta a un directorio se usará `usb_monitor.log` dentro.

## Uso

Ejecuta los siguientes comandos desde PowerShell **como administrador**:

```
python usb_monitor_service.py install
python usb_monitor_service.py start
```

Modo depuración (sin instalar servicio):

```
python usb_monitor_service.py debug
```

Para detener y desinstalar el servicio:

```
python usb_monitor_service.py stop
python usb_monitor_service.py remove
```

Los eventos enviados incluyen el nombre del equipo, la IP, el usuario y la unidad detectada.
Antes de notificar, el servicio intenta dejar la unidad USB en modo solo lectura:
primero aplica el atributo al volumen y, si falla, intenta bloquear el disco asociado.
El resultado (éxito o motivo del fallo) se adjunta dentro del campo `event` y queda registrado en el log.

El servicio aplica atributos de solo lectura en la unidad detectada y registra el resultado
localmente además de notificar al servidor.
