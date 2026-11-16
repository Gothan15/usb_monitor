# ================================================================
#  USB Monitor — Panel · Actualización desde el repo (desarrollo)
# ================================================================
#  Compila el panel desde este clon del repositorio y actualiza
#  con él la instalación hecha con el instalador, sin descargar
#  ningún paquete. Es el camino del desarrollador: en los equipos
#  de otros se usa el paquete «-actualizacion» o el instalador
#  completo de cada Release.
#
#  Qué hace, en orden:
#    1. Trae el código (git pull) y lo compila en el clon.
#    2. Prepara una copia limpia de la aplicación en temporal,
#       con las dependencias podadas a producción — el
#       node_modules del clon NO se toca.
#    3. Para el servicio del panel (PostgreSQL y Redis siguen).
#    4. Copia la aplicación sobre la instalada respetando lo que
#       es de la instalación y no del código: el .env, la carpeta
#       config (los ajustes) y paquete-agente (el paquete subido).
#    5. Refresca los scripts del instalador en la instalación.
#    6. Aplica el esquema (prisma db push) contra la base de
#       datos instalada, usando su propio .env.
#    7. Arranca el servicio y comprueba que queda corriendo.
#
#  Uso (PowerShell ELEVADO, desde cualquier carpeta):
#    powershell -ExecutionPolicy Bypass -File instalador\Actualizar-Panel.ps1
#  Parámetros: -Repo <ruta del clon> (def.: el repo de este
#  script), -Instalacion <ruta> (def.: la del registro), -SinPull.
#
#  Reglas de la casa (aprendidas a golpes en la saga 1.5.x):
#   - Este archivo va en UTF-8 CON BOM: sin BOM, PowerShell 5.1
#     lo lee como ANSI y un guion largo rompe el análisis entero.
#   - Nada de $ErrorActionPreference = 'Stop': con él, la primera
#     línea que un programa nativo (npm, prisma) escribe por su
#     salida de error mata el script. Cada llamada nativa se juzga
#     por su $LASTEXITCODE.
#   - Solo APIs de .NET Framework (PowerShell 5.1), nada moderno.
# ================================================================

param(
    [string]$Repo = (Split-Path -Parent $PSScriptRoot),
    [string]$Instalacion = '',
    [switch]$SinPull
)

# Mensaje con hora, para seguir el proceso en la consola.
function Mensaje([string]$texto) {
    Write-Host ("[{0}] {1}" -f (Get-Date -Format 'HH:mm:ss'), $texto)
}

# Aborta con el motivo en pantalla.
function Fallo([string]$texto) {
    Write-Host ""
    Write-Host "ERROR: $texto" -ForegroundColor Red
    exit 1
}

# Ejecuta un programa nativo y aborta si su código no es de
# éxito. $codigosOk permite sumar códigos buenos propios
# (robocopy considera éxito del 0 al 7).
function Ejecutar([string]$programa, [string[]]$argumentos, [int[]]$codigosOk = @(0)) {
    & $programa @argumentos
    if ($codigosOk -notcontains $LASTEXITCODE) {
        Fallo ("{0} terminó con código {1}." -f $programa, $LASTEXITCODE)
    }
}

# --- 0. Requisitos: administrador e instalación localizada ---
$esAdmin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $esAdmin) { Fallo 'Hay que correrlo elevado (administrador): para y arranca servicios y escribe en la carpeta de instalación.' }

if (-not $Instalacion) {
    try {
        $Instalacion = (Get-ItemProperty 'HKLM:\SOFTWARE\USBMonitor\Panel' -ErrorAction Stop).InstallDir
    } catch { Fallo 'No se encontró la instalación (falta la clave del registro). Esto solo actualiza una instalación hecha con el instalador.' }
}
$app = Join-Path $Instalacion 'app'
if (-not (Test-Path (Join-Path $app 'server.ts'))) { Fallo "En $app no hay un panel instalado." }
if (-not (Get-Service 'USBMonitorPanel' -ErrorAction SilentlyContinue)) { Fallo 'El servicio USBMonitorPanel no existe: no hay instalación que actualizar.' }
if (-not (Test-Path (Join-Path $Repo 'package.json'))) { Fallo "En $Repo no hay un clon del repo del panel." }

Mensaje "Instalación: $Instalacion"
Mensaje "Repo:        $Repo"

# --- 1. Código al día y compilado en el clon ---
if (-not $SinPull -and (Test-Path (Join-Path $Repo '.git'))) {
    Mensaje 'Trayendo el código (git pull)...'
    Ejecutar 'git' @('-C', $Repo, 'pull', '--ff-only')
}
Push-Location $Repo
try {
    Mensaje 'Instalando dependencias del clon (npm install)...'
    Ejecutar 'npm' @('install')
    Mensaje 'Generando el cliente Prisma...'
    Ejecutar 'npx' @('prisma', 'generate')
    Mensaje 'Compilando el panel (npm run build)...'
    Ejecutar 'npm' @('run', 'build')
} finally { Pop-Location }

# --- 2. Copia limpia en temporal, podada a producción ---
$temporal = Join-Path ([IO.Path]::GetTempPath()) 'usbmonitor-actualizacion'
if (Test-Path $temporal) { Remove-Item $temporal -Recurse -Force }
New-Item -ItemType Directory -Path $temporal | Out-Null
Mensaje 'Preparando la copia limpia de la aplicación...'
# Fuera lo que no es aplicación: el propio instalador, el agente,
# la bandeja (se compila aparte; su bin\obj no puede colarse en
# la app), la salida de los instaladores y los datos del clon.
$okRobocopy = 0..7
$argsCopia = @($Repo, $temporal, '/E', '/NFL', '/NDL', '/NJH', '/NJS', '/NP',
    '/XD', (Join-Path $Repo '.git'), (Join-Path $Repo 'instalador'), (Join-Path $Repo 'agente'),
    (Join-Path $Repo 'bandeja'),
    (Join-Path $Repo 'salida-instalador'), (Join-Path $Repo 'config'), (Join-Path $Repo 'paquete-agente'),
    '/XF', '.env', '*.log', '*.zip')
Ejecutar 'robocopy' $argsCopia $okRobocopy
Push-Location $temporal
try {
    Mensaje 'Podando las dependencias a producción (en la copia)...'
    Ejecutar 'npm' @('prune', '--omit=dev')
} finally { Pop-Location }

# --- 3. Parar el servicio del panel ---
$servicio = Get-Service 'USBMonitorPanel'
if ($servicio.Status -ne 'Stopped') {
    Mensaje 'Parando el servicio del panel...'
    Stop-Service 'USBMonitorPanel' -Force
    try { $servicio.WaitForStatus('Stopped', [TimeSpan]::FromSeconds(60)) }
    catch { Fallo 'El servicio del panel no terminó de parar en 60 s; no se copió nada.' }
}

try {
    # --- 4. Copiar la aplicación sobre la instalada ---
    Mensaje 'Copiando la aplicación sobre la instalada...'
    # /MIR deja la carpeta como la copia (fuera lo que el código
    # ya no trae), pero config, paquete-agente y el .env son DE
    # LA INSTALACIÓN: excluidos, ni se copian ni se borran.
    $argsEspejo = @($temporal, $app, '/MIR', '/NFL', '/NDL', '/NJH', '/NJS', '/NP',
        '/XD', (Join-Path $app 'config'), (Join-Path $app 'paquete-agente'),
        '/XF', '.env')
    Ejecutar 'robocopy' $argsEspejo $okRobocopy

    # --- 5. Scripts del instalador al día en la instalación ---
    Mensaje 'Refrescando los scripts del instalador...'
    Copy-Item (Join-Path $Repo 'instalador\scripts\*.ps1') (Join-Path $Instalacion 'scripts') -Force

    # --- 6. Esquema contra la base de datos instalada ---
    Mensaje 'Aplicando el esquema (prisma db push) a la BD instalada...'
    $env:CHECKPOINT_DISABLE = '1'
    $env:PRISMA_HIDE_UPDATE_MESSAGE = '1'
    $nodoInstalado = Join-Path $Instalacion 'node\node.exe'
    $cliPrisma = Join-Path $app 'node_modules\prisma\build\index.js'
    # Prisma 7 lee su configuración (y el .env) desde la carpeta
    # de trabajo: hay que lanzarlo DESDE la aplicación instalada.
    Push-Location $app
    try { Ejecutar $nodoInstalado @($cliPrisma, 'db', 'push') } finally { Pop-Location }
} finally {
    # --- 7. Rearrancar siempre, también si la copia falló ---
    Mensaje 'Arrancando el servicio del panel...'
    Start-Service 'USBMonitorPanel' -ErrorAction SilentlyContinue
}

try { (Get-Service 'USBMonitorPanel').WaitForStatus('Running', [TimeSpan]::FromSeconds(60)) }
catch { Fallo 'El servicio no quedó corriendo; el detalle está en Registros\USBMonitorPanel.err.log de la carpeta de datos.' }
Remove-Item $temporal -Recurse -Force -ErrorAction SilentlyContinue
Mensaje 'Panel actualizado y corriendo. Ábrelo con «Abrir el panel».'
