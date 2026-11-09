# Estructura del repositorio

Este documento es el mapa del proyecto. Si retomas USB Monitor tras
una temporada sin tocarlo, empieza por aquí: qué es cada carpeta,
quién la usa y dónde tocar según lo que busques.

## El sistema en 30 segundos

Dos piezas que hablan por HTTP:

- **El panel** (web, Next.js + Prisma/PostgreSQL): corre en el
  servidor, muestra los equipos y decide los desbloqueos. Su código
  vive en `src/` (y la raíz del repo es su casa: `package.json`,
  `server.ts`, `prisma/`).
- **El agente** (Windows, C#/.NET 10): corre en cada PC vigilada,
  detecta y bloquea los USB. Todo su código vive en `agente/`.

Entre ambos hay dos ayudantes: el **empujador** (instala el agente a
distancia por SMB, modelo Kaspersky) y el **instalador** del panel
(un `.msi` con WiX para montar el servidor en una máquina nueva).

## Mapa de la raíz

| Carpeta o archivo | Qué es | Quién lo usa |
|---|---|---|
| `src/` | El código del panel (páginas, API y lógica) | Next.js, al arrancar con `server.ts` |
| `prisma/` | Esquema de la base de datos, migraciones y seeds | Prisma (`npm run db:push`, `db:seed`) |
| `agente/` | El agente de Windows en C#, completo | Visual Studio / `dotnet` / el workflow de Releases |
| `instalador/` | El instalador `.msi` del panel (WiX) y sus scripts | `instalador/Construir-Instalador.ps1` y el workflow `panel-v*` |
| `documentacion/` | Las guías del proyecto (01–05), la guía de la migración a PostgreSQL, el secreto de sesión y las capturas del README | Quien lea el proyecto (tú, al retomarlo) |
| `scripts/` | Utilidades de administración por consola (crear usuarios, asignar equipos, llaves API…) | El administrador, con `npm run …` o `npx tsx scripts/<script>.ts` |
| `tests/` | Las pruebas del panel | Vitest (`npm test`) |
| `public/` | Archivos estáticos que sirve el panel (la brújula, el logo) | Next.js |
| `config/` | **Carpeta de ejecución**: `app_settings.json`, los ajustes del panel guardados en disco | El panel, vía `src/lib/appSettings.ts` (el archivo del repo es una plantilla vacía `{}`) |
| `empujador/` | **Carpeta de colocación**: aquí va `USBMonitorEmpujador.exe` compilado, el que el panel lanza para instalar agentes | El panel, vía `src/lib/empujador.ts` (ruta cambiable con `EMPUJADOR_PATH`) |
| `paquete-agente/` | **Carpeta de colocación**: aquí va el `USBMonitorService.exe` vigente y su `manifiesto.json`, para actualizar los equipos desde la LAN | El panel, vía `src/lib/paqueteAgente.ts` (ruta cambiable con `AGENT_PACKAGE_DIR`) |
| `.github/workflows/` | La CI: compila y publica el agente y el instalador | GitHub Actions (etiquetas `agente-v*` y `panel-v*`) |
| `.github/instructions/` | Instrucciones para Copilot (SonarQube MCP) | GitHub Copilot |
| `.vscode/` | Ajustes del editor | VS Code |
| `server.ts` | El servidor del panel (Next + Socket.IO) | `npm run start` |
| `README.md` | La presentación del proyecto | — |
| `INSPIRACION.md` | Las referencias de diseño de la interfaz | Quien toque la UI |
| `ESTRUCTURA.md` | Este mapa | — |
| `sonar-project.properties` | Configuración de SonarQube (la busca en la raíz) | El escáner de SonarQube |
| `.env.example` | Las variables de entorno del panel, explicadas | Quien instale el panel |

Las carpetas de **colocación/ejecución** (`empujador/`,
`paquete-agente/`, `config/`) no guardan código: guardan archivos
que el panel necesita junto a él en la máquina donde corre. Los
ejecutables que van dentro están en `.gitignore` (son de la
instalación, no del repo); cada una lleva su `LEEME.md`.

## Dentro de `agente/` (el agente en C#)

| Ruta | Qué es |
|---|---|
| `Agente.sln` | La solución de Visual Studio (núcleo, servicio, empujador y tests) |
| `src/Agente.Core/` | El núcleo sin ventanas: cliente del panel con cola persistente, credencial ECDSA del equipo, cifrado DPAPI, diario «sin huella», emergencia sin red y registro. Es lo que prueban los tests |
| `src/Agente.Servicio/` | El ejecutable `USBMonitorService.exe`: el servicio de Windows, el bloqueo en capas, el instalador y las ventanas WPF (carpeta `Ventanas/`: caja de herramientas, compañero, visor, asistente) |
| `src/Agente.Servicio/iconos/` | Los iconos y la brújula que usan el ejecutable y sus ventanas |
| `empujador/` | La **fuente** del empujador (`Empujador.csproj`): el ayudante SMB/RPC de la instalación remota. Su exe compilado viaja en el zip de la Release del agente y se coloca en la carpeta `empujador/` de la raíz, junto al panel |
| `compilacion/Build-All.ps1` | Compila el agente a un solo exe autocontenido en `agente/dist/` (carpeta ignorada por git) y le estampa la versión |
| `tests/Agente.Core.Tests/` | Las pruebas del núcleo (xUnit) |
| `paquetes/` | Fuente NuGet local para compilar sin internet (ver `nuget.config` y `paquetes/LEEME.txt`) |
| `Install-Service.ps1` | Instala o desinstala el servicio en una PC (instalación local; viaja en el zip de la Release) |
| `CONTRATO-SERVIDOR.md` | El contrato HTTP entre el agente y el panel |
| `DISENO-UI.md` | El diseño de las ventanas del agente |
| `README.md` | Cómo compilar y operar el agente |

## Dentro del panel (`src/`)

| Ruta | Qué es |
|---|---|
| `app/` | Las rutas: páginas (`admin/`, `user/`, `login/`, `desbloquear/`) y la API (`app/api/…`) |
| `components/dashboard/` | Las pestañas del panel de administración (Equipos, Eventos, Desbloqueos, Lista blanca, Escáner, Tareas, Ajustes…) |
| `components/shell/` | El marco de la app: navegación, campana de notificaciones y la paleta de comandos (la lupa, Ctrl+K) |
| `components/ui/` | Los componentes base (shadcn/ui). Ojo: `ui/spinner.tsx` no se toca — guarda las animaciones de entrar/salir |
| `components/shared/`, `components/system/`, `components/onboarding/`, `components/providers/` | Piezas compartidas, proveedores de contexto, el tour guiado |
| `lib/` | La lógica de servidor: `empujador.ts` (lanza el empujador), `installExecutor.ts` e `installTasks.ts` (las tareas de instalación), `paqueteAgente.ts` y `paqueteAdmin.ts` (el paquete del agente), `credenciales.ts` (las claves ECDSA), `identidadEquipo.ts` (la identidad única de cada equipo), `networkScanner.ts` (el escáner de red), `appSettings.ts` (los ajustes), `agentCommands.ts` (las órdenes al agente) |
| `hooks/`, `store/`, `types/` | Hooks de React, estado global (zustand) y tipos compartidos |
| `proxy.ts` | El proxy de Next (redirección HTTPS y CSP; en LAN no fuerza) |

## Dentro de `instalador/` (el `.msi` del panel)

| Ruta | Qué es |
|---|---|
| `Construir-Instalador.ps1` | Construye el `.msi` (ligero y «completo»); lo usa también el workflow `panel-v*` |
| `Panel.wxs`, `versiones.wxi` | La definición WiX del instalador y sus versiones |
| `scripts/` | Los scripts que el instalador ejecuta en la máquina destino (PostgreSQL, servicios, primer administrador) |
| `servicio/USBMonitorPanel.xml` | El panel como servicio de Windows (WinSW) |
| `AbrirPanel.cmd`, `Licencia.rtf`, `LEEME.md` | El acceso al panel instalado, la licencia y las notas del instalador |

## Carpetas generadas (no son código; no las busques en git)

- `node_modules/`, `.next/`, `src/generated/` — dependencias, la
  compilación del panel y el cliente Prisma generado.
- `agente/dist/`, `agente/**/bin/`, `agente/**/obj/` — la salida de
  compilar el agente.
- `salida-instalador/` — la salida de construir el `.msi`.
- `paquete-agente/*.exe`, `paquete-agente/manifiesto.json`,
  `empujador/*.exe` — los ejecutables colocados junto al panel.

## Si buscas…

- **Cambiar una pestaña del panel** → `src/components/dashboard/`
- **Una ruta de la API** → `src/app/api/`
- **Cómo se instala el agente en remoto** → la fuente del empujador
  en `agente/empujador/`, la orquestación en
  `src/lib/installExecutor.ts` y la guía en
  `documentacion/04-instalacion-y-despliegue.md`
- **El enrolamiento y las claves de los equipos** →
  `src/lib/credenciales.ts`, `agente/src/Agente.Core/IdentidadAgente.cs`
  y `documentacion/05-api-y-seguridad.md`
- **El bloqueo de USB** → `agente/src/Agente.Servicio/Servicio/`
  (`MotorBloqueo.cs`, `Pnp.cs`, `Volumen.cs`)
- **Publicar una versión del agente** → etiqueta `agente-v*` (la
  compila `.github/workflows/agente-release.yml` con
  `agente/compilacion/Build-All.ps1`)
- **Publicar el instalador del panel** → etiqueta `panel-v*`
  (`.github/workflows/panel-instalador.yml`)
- **El esquema de datos** → `prisma/schema.prisma`
- **Los ajustes del panel** → la pestaña Ajustes; por dentro,
  `src/lib/appSettings.ts` y el archivo `config/app_settings.json`
- **La `SESSION_SECRET`** → `documentacion/secreto-de-sesion.md`
- **La migración histórica a PostgreSQL** →
  `documentacion/guia-migracion-postgresql.md`

## Historia de los nombres

Para que nadie se extrañe al mirar el historial de git:

- `agente/` se llamó **`USBMonitorCS/`** hasta la reorganización de
  noviembre de 2026.
- El agente original en **Python** vivió en **`USBMonitor/`**; se
  retiró del repo en esa misma reorganización (el propio README ya
  lo marcaba «histórico, ya no se usa»). Su código sigue en el
  historial de git, p. ej. en el commit `e3aff371` (el último main
  antes de la reorganización).
- Las capturas del README y la guía de `SESSION_SECRET` vivían en
  **`docs/`**; ahora están en `documentacion/`.
- Los iconos del agente vivían en la carpeta del agente Python y el
  proyecto C# los enlazaba desde ahí; ahora viven en
  `agente/src/Agente.Servicio/iconos/`.
