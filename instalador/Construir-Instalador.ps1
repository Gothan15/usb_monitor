# ================================================================
# USB Monitor — Panel · construcción del instalador (Inno Setup)
# ----------------------------------------------------------------
# Se ejecuta en el PC de desarrollo (Windows). Deja el resultado en
#   <repo>\salida-instalador\USBMonitor-Panel-<versión>.exe
#
# Requisitos en este PC:
#   · Node.js + npm (para compilar el panel, como siempre).
#   · Inno Setup 6 (su compilador, ISCC.exe): si no está en las
#     rutas habituales, este script descarga el instalador oficial
#     y lo instala en silencio. Es requisito SOLO de construcción:
#     el instalador del panel sigue siendo full offline.
#   · Internet la primera vez (descarga Node portable, los binarios
#     de PostgreSQL, los de Redis y WinSW; luego quedan cacheados
#     en descargas\).
#
# Uso:
#   .\Construir-Instalador.ps1                → versión 1.0.0
#   .\Construir-Instalador.ps1 -Version 1.1.0
#   .\Construir-Instalador.ps1 -Version 1.1.0 -Completo -PaqueteDir D:\paquete-agente-1.0.11
#       → variante «completo»: el instalador lleva dentro el paquete
#         del agente (su ejecutable + manifiesto y el empujador) y
#         sale como USBMonitor-Panel-<versión>-completo.exe.
#         -PaqueteDir es la carpeta con USBMonitorService.exe,
#         USBMonitorEmpujador.exe y manifiesto.json (ver LEEME.md).
#
# Las versiones de PostgreSQL/Node/WinSW se leen de versiones.wxi
# (única fuente). Si en $HashEsperado fijas los SHA-256, cada
# descarga se verifica contra ellos; si no, el script imprime los
# que obtuvo para que puedas fijarlos.
# ================================================================
param(
    [string]$Version = '1.0.0',
    [switch]$Completo,
    [string]$PaqueteDir = ''
)
$ErrorActionPreference = 'Stop'
# Que un comando nativo fallido (npm, npx) detenga el script: sin esto, una
# compilación fallida del panel seguiría adelante y el instalador saldría «bien»
# con un panel roto dentro (visto en la corrida de panel-v1.0.1). En
# PowerShell 7.3+ lo hace esta variable; en 5.1 lo cubre Exigir, que se
# llama tras cada comando crítico.
$PSNativeCommandUseErrorActionPreference = $true
function Exigir([string]$Que) {
    if ($LASTEXITCODE -ne 0) { throw "Falló: $Que (código $LASTEXITCODE)" }
}

$inst = $PSScriptRoot
$raiz = Split-Path $inst -Parent
$salida = Join-Path $raiz 'salida-instalador'
$prep = Join-Path $salida 'preparado'
$descargas = Join-Path $salida 'descargas'

# Variante «completo»: el paquete del agente se comprueba ANTES de
# descargar nada y de compilar el panel. Si falta -PaqueteDir o
# alguno de sus tres archivos, la construcción muere aquí con el
# motivo claro, no a mitad del proceso con un error de WiX críptico
# por un archivo que no está en el árbol preparado.
$archivosPaquete = @('USBMonitorService.exe', 'USBMonitorEmpujador.exe', 'manifiesto.json')
if ($Completo) {
    if (-not $PaqueteDir) {
        throw 'La variante -Completo necesita -PaqueteDir: la carpeta con el paquete del agente (USBMonitorService.exe, USBMonitorEmpujador.exe y manifiesto.json).'
    }
    if (-not (Test-Path -LiteralPath $PaqueteDir -PathType Container)) {
        throw "No existe la carpeta del paquete del agente: $PaqueteDir"
    }
    foreach ($archivo in $archivosPaquete) {
        if (-not (Test-Path -LiteralPath (Join-Path $PaqueteDir $archivo) -PathType Leaf)) {
            throw "Falta $archivo en la carpeta del paquete del agente: $PaqueteDir"
        }
    }
    Write-Host 'Variante COMPLETO: el paquete del agente viajará dentro del instalador.'
}

# Versiones fijadas (desde versiones.wxi).
$wxi = Get-Content -LiteralPath (Join-Path $inst 'versiones.wxi') -Raw
function Version-De([string]$nombre) {
    if ($wxi -match ("{0}\s*=\s*""([0-9.]+)""" -f $nombre)) { return $Matches[1] }
    throw "No se encontró $nombre en versiones.wxi"
}
$PgVersion = Version-De 'PgVersion'
$NodeVersion = Version-De 'NodeVersion'
$WinSwVersion = Version-De 'WinSwVersion'
$RedisVersion = Version-De 'RedisVersion'

# SHA-256 esperados (vacío = solo avisar con el calculado).
# El de Redis SÍ va fijado: es el que publica el proyecto
# redis-windows en la página de la versión, y coincide con el de
# la descarga comprobada al fijarlo (2026-11-15).
$HashEsperado = @{
    pg    = ''
    node  = ''
    winsw = ''
    inno  = ''
    redis = 'BCBFDA1DDA027BEAEA4D616F8992F9B6353613C1B1F4D0E4A6776940BB036347'
}

function Descargar([string]$url, [string]$destino, [string]$clave) {
    if (-not (Test-Path -LiteralPath $destino)) {
        Write-Host "Descargando $url"
        Invoke-WebRequest -Uri $url -OutFile $destino
    }
    $hash = (Get-FileHash -LiteralPath $destino -Algorithm SHA256).Hash
    if ($HashEsperado[$clave]) {
        if ($hash -ne $HashEsperado[$clave]) { throw "SHA-256 no coincide en $destino" }
        Write-Host "SHA-256 verificado: $clave"
    } else {
        Write-Host "SHA-256 de $clave (sin fijar): $hash"
    }
}

Write-Host '== 1/5 Herramientas =='
# Inno Setup 6: se busca su compilador (ISCC.exe) en el PATH y en
# las rutas habituales; si no está, se descarga el instalador
# oficial (jrsoftware/innosetup en GitHub) y se instala en
# silencio. Solo hace falta en este PC de construcción.
New-Item -ItemType Directory -Force -Path $descargas | Out-Null
$rutasIscc = @(
    "$env:ProgramFiles\Inno Setup 6\ISCC.exe",
    "${env:ProgramFiles(x86)}\Inno Setup 6\ISCC.exe",
    "$env:LOCALAPPDATA\Programs\Inno Setup 6\ISCC.exe"
)
$iscc = $rutasIscc | Where-Object { Test-Path -LiteralPath $_ } | Select-Object -First 1
if (-not $iscc -and (Get-Command ISCC.exe -ErrorAction SilentlyContinue)) {
    $iscc = (Get-Command ISCC.exe).Source
}
if (-not $iscc) {
    $instInno = Join-Path $descargas 'innosetup-6.5.3.exe'
    Descargar 'https://github.com/jrsoftware/innosetup/releases/download/is-6_5_3/innosetup-6.5.3.exe' $instInno 'inno'
    Write-Host 'Instalando Inno Setup 6 en silencio…'
    & $instInno /VERYSILENT /SUPPRESSMSGBOXES /NORESTART /SP- | Out-Null
    Exigir 'instalar Inno Setup'
    $iscc = $rutasIscc | Where-Object { Test-Path -LiteralPath $_ } | Select-Object -First 1
    if (-not $iscc) { throw 'Inno Setup quedó instalado pero no aparece ISCC.exe en las rutas habituales.' }
}
Write-Host "ISCC: $iscc"

Write-Host '== 2/5 Descargas fijadas =='
New-Item -ItemType Directory -Force -Path $descargas, $prep | Out-Null
$zipPg = Join-Path $descargas "postgresql-$PgVersion-binarios.zip"
$zipNode = Join-Path $descargas "node-v$NodeVersion-win-x64.zip"
$exeWinSw = Join-Path $descargas "WinSW-x64-$WinSwVersion.exe"
$zipRedis = Join-Path $descargas "Redis-$RedisVersion-Windows-x64-msys2.zip"
Descargar "https://get.enterprisedb.com/postgresql/postgresql-$PgVersion-1-windows-x64-binaries.zip" $zipPg 'pg'
Descargar "https://nodejs.org/dist/v$NodeVersion/node-v$NodeVersion-win-x64.zip" $zipNode 'node'
Descargar "https://github.com/winsw/winsw/releases/download/v$WinSwVersion/WinSW-x64.exe" $exeWinSw 'winsw'
Descargar "https://github.com/redis-windows/redis-windows/releases/download/$RedisVersion/Redis-$RedisVersion-Windows-x64-msys2.zip" $zipRedis 'redis'

Write-Host '== 3/5 Compilar el panel =='
# Al recoger los datos de las páginas, la compilación de Next ejecuta los
# módulos de las rutas, y el de sesión EXIGE SESSION_SECRET aunque solo sea
# para compilar: sin .env en el runner, la compilación de panel-v1.0.1 cayó
# justo ahí. Se le dan valores de usar y tirar, solo para este proceso; el
# secreto de verdad se genera al instalar, en el .env del equipo destino, y
# Next no incrusta las variables de servidor en la salida compilada.
$env:SESSION_SECRET = 'solo-para-compilar-' + [guid]::NewGuid().ToString('N')
$env:DATABASE_URL = 'postgresql://compilacion:compilacion@localhost:5432/compilacion'
Push-Location $raiz
try {
    npm ci;               Exigir 'npm ci'
    npx prisma generate;  Exigir 'prisma generate'
    npm run build;        Exigir 'npm run build'
    npm prune --omit=dev; Exigir 'npm prune'   # node_modules solo de producción para el paquete
} finally { Pop-Location }

Write-Host '== 4/5 Preparar el árbol =='
foreach ($carpeta in @('app', 'node', 'pgsql', 'redis', 'servicio', 'scripts', 'raiz')) {
    $destino = Join-Path $prep $carpeta
    if (Test-Path $destino) { Remove-Item $destino -Recurse -Force }
    New-Item -ItemType Directory -Force -Path $destino | Out-Null
}
# La aplicación: el repo compilado, sin lo que no es el panel.
# OJO: /XF .env — jamás empaquetar el .env del PC de desarrollo.
# Robocopy devuelve 0–7 en los casos buenos (1 = «copió archivos»):
# su código se juzga a mano en la línea siguiente. Con la preferencia
# estricta lanzaría en cuanto copiara algo, así que también va en pausa.
$PSNativeCommandUseErrorActionPreference = $false
robocopy $raiz (Join-Path $prep 'app') /E `
    /XD .git instalador agente salida-instalador `
    /XF .env *.log *.zip | Out-Null
$PSNativeCommandUseErrorActionPreference = $true
if ($LASTEXITCODE -ge 8) { throw "robocopy del panel falló ($LASTEXITCODE)" }
Copy-Item (Join-Path $inst 'scripts\crear-admin.js') `
          (Join-Path $prep 'app\crear-admin-instalador.mjs')
# Node portable: basta el ejecutable (los scripts lo llaman directo).
Expand-Archive -LiteralPath $zipNode -DestinationPath (Join-Path $salida 'node-tmp') -Force
Copy-Item (Join-Path $salida "node-tmp\node-v$NodeVersion-win-x64\node.exe") (Join-Path $prep 'node\node.exe')
Copy-Item (Join-Path $salida "node-tmp\node-v$NodeVersion-win-x64\LICENSE") (Join-Path $prep 'node\LICENSE')
Remove-Item (Join-Path $salida 'node-tmp') -Recurse -Force
# PostgreSQL: solo el motor (si la descarga trajera pgAdmin o
# StackBuilder, se quedan fuera: el panel no los usa).
Expand-Archive -LiteralPath $zipPg -DestinationPath (Join-Path $salida 'pg-tmp') -Force
Copy-Item (Join-Path $salida 'pg-tmp\pgsql\*') (Join-Path $prep 'pgsql') -Recurse
foreach ($fuera in @('pgAdmin 4', 'StackBuilder', 'include', 'symbols')) {
    $ruta = Join-Path $prep "pgsql\$fuera"
    if (Test-Path $ruta) { Remove-Item $ruta -Recurse -Force }
}
Remove-Item (Join-Path $salida 'pg-tmp') -Recurse -Force
# Redis: el zip trae una carpeta raíz con los binarios y sus DLL de
# MSYS2; va entera a redis\ menos start.bat (arrancaría un Redis
# «de verdad» en el 6379 si alguien lo pulsara: aquí Redis solo
# existe como servicio, con su redis.conf generado al instalar).
Expand-Archive -LiteralPath $zipRedis -DestinationPath (Join-Path $salida 'redis-tmp') -Force
Copy-Item (Join-Path $salida "redis-tmp\Redis-$RedisVersion-Windows-x64-msys2\*") (Join-Path $prep 'redis') -Recurse
Remove-Item (Join-Path $prep 'redis\start.bat') -Force -ErrorAction SilentlyContinue
Remove-Item (Join-Path $salida 'redis-tmp') -Recurse -Force
# Servicio (WinSW renombrado + sus plantillas) y scripts. WinSW va
# dos veces: una para el panel y otra para Redis, porque cada
# servicio necesita su propio ejecutable con su propio XML.
Copy-Item $exeWinSw (Join-Path $prep 'servicio\USBMonitorPanel.exe')
Copy-Item (Join-Path $inst 'servicio\USBMonitorPanel.xml') (Join-Path $prep 'servicio\')
Copy-Item $exeWinSw (Join-Path $prep 'servicio\USBMonitorRedis.exe')
Copy-Item (Join-Path $inst 'servicio\USBMonitorRedis.xml') (Join-Path $prep 'servicio\')
Copy-Item (Join-Path $inst 'scripts\*') (Join-Path $prep 'scripts\')
# Los scripts del instalador corren con Windows PowerShell 5.1,
# que lee los .ps1 SIN BOM como ANSI: un guion largo («—») dentro
# de una cadena se convierte al leerlo en una comilla tipografica
# que cierra la cadena, y el script muere al analizarse, sin
# ejecutar ni su primera linea (le paso a Instalar-Redis con la
# 1.5.0: el registro quedo sin ni una linea suya). Se garantiza
# aqui que todo .ps1 del paquete sale en UTF-8 CON BOM, que 5.1
# si lee como UTF-8, haya venido como haya venido del repo.
foreach ($ps1 in Get-ChildItem (Join-Path $prep 'scripts') -Filter '*.ps1') {
    $bytes = [IO.File]::ReadAllBytes($ps1.FullName)
    if ($bytes.Length -lt 3 -or $bytes[0] -ne 0xEF -or $bytes[1] -ne 0xBB -or $bytes[2] -ne 0xBF) {
        [IO.File]::WriteAllBytes($ps1.FullName, [byte[]](0xEF, 0xBB, 0xBF) + $bytes)
        Write-Host "BOM UTF-8 anadido: $($ps1.Name)"
    }
}
Copy-Item (Join-Path $inst 'AbrirPanel.cmd') (Join-Path $prep 'raiz\')
# Variante «completo»: el paquete del agente, tal cual llegó en
# -PaqueteDir, a sus dos carpetas del árbol. Panel.iss lo recoge de
# ahí, solo cuando la construcción define IncluirPaquete.
if ($Completo) {
    foreach ($carpeta in @('paquete-agente', 'empujador')) {
        $destino = Join-Path $prep $carpeta
        if (Test-Path $destino) { Remove-Item $destino -Recurse -Force }
        New-Item -ItemType Directory -Force -Path $destino | Out-Null
    }
    Copy-Item (Join-Path $PaqueteDir 'USBMonitorService.exe') (Join-Path $prep 'paquete-agente\')
    Copy-Item (Join-Path $PaqueteDir 'manifiesto.json')       (Join-Path $prep 'paquete-agente\')
    Copy-Item (Join-Path $PaqueteDir 'USBMonitorEmpujador.exe') (Join-Path $prep 'empujador\')
}

Write-Host '== 5/5 Construir el instalador =='
# La variante completo se distingue en el nombre del archivo: en
# la Release conviven los dos instaladores de la misma versión
# del panel y nadie debe tener que abrirlos para saber cuál es
# cuál.
$nombreExe = if ($Completo) { "USBMonitor-Panel-$Version-completo" } else { "USBMonitor-Panel-$Version" }
$exe = Join-Path $salida "$nombreExe.exe"
Push-Location $inst
try {
    # /D…: las definiciones que Panel.iss consume (versión, árbol
    # preparado y, en la variante completo, el paquete del agente).
    # /O y /F: la carpeta y el nombre del instalador resultante.
    $argsIscc = @("/DPanelVersion=$Version", "/DPreparado=$prep",
                  "/O$salida", "/F$nombreExe")
    if ($Completo) { $argsIscc += '/DIncluirPaquete=1' }
    $argsIscc += 'Panel.iss'
    & $iscc @argsIscc
    Exigir 'ISCC'
    # El paquete de actualización ligero (solo el programa, para
    # aplicar sobre una instalación existente): se compila en las
    # dos pasadas, ligero y completo, con el mismo contenido; la
    # segunda lo sobrescribe idéntico.
    $nombreAct = "USBMonitor-Panel-$Version-actualizacion"
    & $iscc "/DPanelVersion=$Version" "/DPreparado=$prep" `
            "/O$salida" "/F$nombreAct" 'Actualizacion.iss'
    Exigir 'ISCC (paquete de actualización)'
} finally { Pop-Location }

$info = Get-Item $exe
$hashExe = (Get-FileHash -LiteralPath $exe -Algorithm SHA256).Hash
Write-Host ''
Write-Host "Instalador listo: $exe"
Write-Host ("Tamaño: {0:N1} MB" -f ($info.Length / 1MB))
Write-Host "SHA-256: $hashExe"
$exeAct = Join-Path $salida "USBMonitor-Panel-$Version-actualizacion.exe"
if (Test-Path -LiteralPath $exeAct) {
    Write-Host "Paquete de actualización listo: $exeAct"
    Write-Host ("Tamaño: {0:N1} MB" -f ((Get-Item $exeAct).Length / 1MB))
}
