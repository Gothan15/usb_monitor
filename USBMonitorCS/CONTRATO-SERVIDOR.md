# Contrato del servidor para el agente (fuente de verdad)

Inventario verificado contra el código del panel y del agente Python v2
el 2026-11-01. El agente en C# debe cubrir TODO esto: nada de quedar
por detrás del agente actual ni del panel.

## Autenticación

- Cabecera en cada llamada: `Authorization: AgentToken <token del equipo>`.
- El token lo genera un administrador en el panel (Equipos → «Token del
  agente»); en la base solo queda su hash SHA-256. Sin token válido, las
  rutas del agente responden 401.
- El token vive en `server.json`, cifrado (ver `Agente.Core`:
  Fernet `ENC:` legible por compatibilidad; escritura nueva con DPAPI
  `DPAPI:` en ámbito máquina).

## Rutas que el agente consume

| Método y ruta | Uso | Notas |
|---|---|---|
| POST `/api/usb-event` | Eventos (CONNECTED, BLOCKED, DISCONNECTED, UNLOCKED, BLOCK_REAPPLIED, UNLOCK_RELEASE_FAILED, EMERGENCY_UNLOCK, SERVICE_START, SERVICE_STOP) | Cola persistente con reintentos: solo sale de la cola con 2xx. Cuerpo snake_case: `pc_name, pc_ip, pc_user, event, drive_letter, serial_number, readonly_status, whitelisted`. La IP debe ser IPv4 válida. |
| POST `/api/usb-event/pending-unlock` | Registrar un bloqueo | `{pcName, driveLetter?, serialNumber?, deviceLabel?, whitelisted}` → `{id}`. |
| POST `/api/usb-event/pending-close` | Cerrar el bloqueo al extraer | `{pcName, driveLetter?, serialNumber?}`. |
| POST `/api/usb-event/connected-status` | Latido de estado (qué hay conectado) | `{pcName, connectedDrives:[{driveLetter, serialNumber, ...}]}`; alimenta «última señal» (método 3). |
| GET `/api/usb-unlock/status?pcName&check=true` | Sondeo de desbloqueos autorizados | Devuelve `{unlocked, pendings:[{id, driveLetter, serialNumber}]}` ya reclamados: ejecutar y reportar UNLOCKED o UNLOCK_RELEASE_FAILED. |
| POST `/api/usb-auth` | La contraseña la valida el SERVIDOR | Lo llama el compañero: `{username, password, pcName, driveLetter?, serialNumber?}` → 200 autorizado / 401 genérico / 403 con mensaje (fuera de whitelist o desbloqueo desactivado). |
| GET `/api/whitelist/check?serial` | ¿Dispositivo conocido? | `{allowed, entry}`; con caché local de 60 s y caché persistente para sin conexión (marca, no autoriza). |
| GET `/api/agent/config` | Ajustes al arrancar y cada 10 min | `{startupNetworkDelay, lockSessionOnInsert}` en camelCase. |
| GET `/api/agent/owner-hash?pcName` | Hash Argon2 del dueño para la emergencia sin red | Solo si `offlineEmergencyEnabled` está activo en el panel; si no, no hay emergencia. Se renueva cada 10 min. |
| GET `/api/agent/owner?pcName` | Identidad pública del equipo: dueño asignado y modo | `{ownerUsername (null si no hay dueño asignado), unlockMode, passwordUnlockEnabled}`. SIN ninguna credencial: lo muestran la toolbox y el compañero para decir de quién es la contraseña que vale en la PC. |
| POST `/api/agent/offline-attempts` | Subir la auditoría de intentos sin red al volver la conexión | `{pcName, attempts:[{usernameTried, result, driveLetter, serialNumber, createdAt}]}`. |
| GET `/api/agent/ping?pcName` | Prueba de conexión y señal de vida | `{ok, serverTime, pc}`; renueva `lastSeen` del equipo. Lo usa el botón «Probar conexión». |

## Ajustes del panel que el agente obedece

De `config/app_settings.json` (defaults entre paréntesis):

- `startup_network_delay` (15 s): espera de red al arrancar el servicio.
- `lockSessionOnInsert` (false): bloquear la sesión de Windows al
  insertar un USB bloqueado.
- `passwordUnlockEnabled` (true): si está apagado, usb-auth corta y el
  compañero muestra el mensaje del servidor.
- `offlineEmergencyEnabled` (true): gobierna owner-hash y la página de
  emergencia local.
- `requireAgentToken` (false): si está activo, la ingesta sin token
  devuelve 401; el agente siempre envía su token igualmente.
- `silenceThresholdMinutes` (5): solo panel (marca equipos caídos);
  el agente contribuye manteniendo vivo el connected-status.

## Empuje de ajustes al agente (:5001)

Al guardar ajustes, el panel hace POST a `http://<ip-del-equipo>:5001/config`
con la credencial del agente y un cuerpo **snake_case** con las claves
que cambiaron: `startup_network_delay`, `lock_session_on_insert`.
El servidor local del agente debe:

- Exigir la misma credencial (`Authorization` igual a la propia).
- Aceptar snake_case (empuje) y aplicar al momento, sin reiniciar.
- Servir además `GET /estado` (salud para el escáner del panel) y la
  página de emergencia `GET/POST /desbloquear` (solo dueño, con el
  hash local, límites de intentos y auditoría diferida).

## Instalación remota desde el panel

El panel copia a `C:\USBMonitor` el ejecutable y `Install-Service.ps1`
y lo ejecuta con `-Action install -ServerHost <h> -ServerPort <p>
[-AgentToken <t>]`. El paquete C# mantiene ese contrato:
`USBMonitorCS/dist/USBMonitorService.exe` + `USBMonitorCS/Install-Service.ps1`
con la misma interfaz (al adoptar el agente C# en producción basta
apuntar el panel a estas rutas o copiar el dist sobre `USBMonitor/dist`).

## Reglas de negocio que no cambian

- La whitelist solo identifica conocidos; la contraseña se pide
  SIEMPRE en dispositivos de la lista, hasta extraer el dispositivo.
- Fuera de la whitelist no hay contraseña para nadie: solo el aviso.
- El administrador no aprueba nada: su contraseña es una credencial más.
- Sin red: fail-closed. El bloqueo se mantiene, la emergencia usa el
  hash local con límite de intentos y todo intento se audita al volver.
- Sin huella: cada cambio (nodo PnP deshabilitado, volumen retenido,
  solo lectura) se anota en el diario con su valor original y se
  revierte al extraer, al parar el servicio, al desinstalar y al
  arrancar tras un cierre sucio.
- Capas de bloqueo en orden: PnP verificado → candado de volumen con
  sonda de inaccesibilidad → solo lectura (degradado, avisado).
- Detección amplia: USBSTOR directo; carcasas UAS solo si un ancestro
  PnP (hasta 3 niveles) es USB; móviles WPD sin letra (bloqueo por
  serial); la red USB presente al arrancar es línea base y no se bloquea.
