# USB Monitor — App de escritorio del panel

Una ventana propia para el panel, sin abrir el navegador: un programa de
Windows en C# (WinForms + WebView2) que carga el mismo panel de siempre en
su **dirección única de red** — la IPv4 de la ruta por defecto del equipo y
el puerto que el instalador deja en el registro, el mismo criterio que ya
usa la bandeja (`bandeja/Program.cs`) desde el PR #164.

El panel no cambia: sigue siendo el mismo servidor (servicio de Windows +
PostgreSQL). Esto es solo otra ventana para mirarlo. Los agentes tampoco se
tocan.

## Qué hace la ventana

- **Espera activa.** Si el panel aún no responde (el equipo está arrancando
  o el servicio está detenido), enseña una pantalla de espera de la casa y
  reintenta sola cada 3 segundos con una sonda HTTP ligera, en vez del
  error del navegador. Si el panel se cae a mitad de sesión, vuelve a la
  espera.
- **Navegación confinada.** La ventana se queda en el origen del panel;
  cualquier enlace a otro sitio se abre en el navegador del sistema.
  Las ventanas nuevas del propio panel se abren en la misma ventana.
- **Sesión persistente.** El perfil de WebView2 vive en
  `%LOCALAPPDATA%\USBMonitor\Escritorio\WebView2`, así que el login del
  panel sobrevive al cierre, como en un navegador.
- **Memoria.** Recuerda tamaño, posición, estado maximizado y zoom en
  `%LOCALAPPDATA%\USBMonitor\Escritorio\configuracion.json`.
- **Instancia única.** Una segunda apertura avisa de que ya está abierta.
- **Atajos.** F5 / Ctrl+R recargar · Alt+←/→ atrás/adelante ·
  Ctrl+`+`/`-`/`0` zoom · F11 pantalla completa.
- **Barra propia.** Atrás, adelante, recargar, la dirección actual (solo
  lectura), abrir en el navegador, ajustes y pantalla completa.

## Ajustes

El botón **Ajustes** permite fijar una dirección a mano (por ejemplo, para
usar la app desde otro PC de la red apuntando al equipo que sirve el
panel). Vacío = automática. La dirección fijada se guarda en la
configuración del usuario.

## Construir

Requiere el SDK de .NET 10 en el equipo que compila:

```powershell
powershell -ExecutionPolicy Bypass -File .\Construir-Escritorio.ps1
```

Publica un único exe autocontenido en `dist\USBMonitorEscritorio.exe`
(no hace falta .NET instalado en el equipo destino, igual que la bandeja).

## Requisitos en el equipo destino

- Windows 10/11 de 64 bits.
- **WebView2 Runtime** (el componente de Edge/Chromium): Windows 11 lo
  trae de fábrica. Si falta, la app lo dice con un aviso claro al arrancar.

## Modo servidor dedicado

La misma app, con los scripts de `dedicado/`, convierte una PC en un
servidor del panel y nada más — el modo «totalitario»:

- Una **cuenta local dedicada** (`PanelUSB`, sin privilegios de
  administrador) con **inicio de sesión automático**.
- A esa cuenta se le **sustituye el shell**: en vez de Explorer arranca
  el **vigilante** de la app (`--vigia`), que abre la ventana en modo
  dedicado (`--dedicado`: pantalla completa sin bordes, sin barra, sin
  cierre por Alt+F4) y **la relanza si se cae** (deja constancia en
  `vigia.log`, en la carpeta de datos de la app).
- Los servicios (panel, PostgreSQL, Redis) siguen corriendo por debajo
  como siempre.
- **Tu cuenta de administrador no se toca**: conserva su Explorer
  normal. Para mantener la PC: Ctrl+Alt+Supr → Cambiar de usuario →
  tu cuenta de siempre. Esa es la salida del modo dedicado; la cuenta
  del panel no tiene puerta de escape, a propósito.
- Es **opcional por PC**: la app normal y el modo dedicado conviven;
  el modo dedicado es para la PC que haga de servidor, no para tu PC
  principal.

Activar (PowerShell como administrador, pide la contraseña de la
cuenta nueva dos veces; no queda escrita en ningún archivo):

```powershell
powershell -ExecutionPolicy Bypass -File .\dedicado\Activar-ModoDedicado.ps1
```

Desactivar (restaura el inicio de sesión normal y el Explorer de la
cuenta; `-EliminarCuenta` y `-QuitarPrograma` lo quitan todo):

```powershell
powershell -ExecutionPolicy Bypass -File .\dedicado\Desactivar-ModoDedicado.ps1
```

Aviso honesto: el inicio automático guarda la contraseña de la cuenta
en el registro de Windows de una forma que cualquier administrador
local puede leer — es el mecanismo normal del modo kiosko y se acepta
porque la cuenta no es administradora ni guarda datos. La alternativa
con cifrado es la herramienta Autologon de Sysinternals.

## Lo que NO es

- No sustituye a la bandeja: la bandeja gobierna el servicio; esta
  ventana enseña el panel.
