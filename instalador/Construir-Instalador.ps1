# ================================================================
# USB Monitor — Panel · construcción del instalador .msi
# ----------------------------------------------------------------
# Se ejecuta en el PC de desarrollo (Windows). Deja el resultado en
#   <repo>\salida-instalador\USBMonitor-Panel-<versión>.msi
#
# Requisitos en este PC:
#   · Node.js + npm (para compilar el panel, como siempre).
#   · SDK de .NET (para la herramienta «wix» de WiX v5; si falta,
#     este script la instala como herramienta global de dotnet).
#   · Internet la primera vez (descarga Node portable, los binarios
#     de PostgreSQL y WinSW; luego quedan cacheados en descargas\).
#
# Uso:
#   .\Construir-Instalador.ps1                → versión 1.0.0
#   .\Construir-Instalador.ps1 -Version 1.1.0
#
# Las versiones de PostgreSQL/Node/WinSW se leen de versiones.wxi
# (única fuente). Si en $HashEsperado fijas los SHA-256, cada
# descarga se verifica contra ellos; si no, el script imprime los
# que obtuvo para que puedas fijarlos.
# ================================================================
param(
    [string]$Version = '1.0.0'
)
$ErrorActionPreference = 'Stop'
# Que un comando nativo fallido (npm, npx) detenga el script: sin esto, una
# compilación fallida del panel seguiría adelante y el .msi saldría «bien»
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

# Versiones fijadas (desde versiones.wxi).
$wxi = Get-Content -LiteralPath (Join-Path $inst 'versiones.wxi') -Raw
function Version-De([string]$nombre) {
    if ($wxi -match ("{0}\s*=\s*""([0-9.]+)""" -f $nombre)) { return $Matches[1] }
    throw "No se encontró $nombre en versiones.wxi"
}
$PgVersion = Version-De 'PgVersion'
$NodeVersion = Version-De 'NodeVersion'
$WinSwVersion = Version-De 'WinSwVersion'

# SHA-256 esperados (vacío = solo avisar con el calculado).
$HashEsperado = @{
    pg    = ''
    node  = ''
    winsw = ''
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
$env:Path = "$env:USERPROFILE\.dotnet\tools;$env:Path"
if (-not (Get-Command wix -ErrorAction SilentlyContinue)) {
    Write-Host 'Instalando WiX v5 como herramienta de dotnet…'
    dotnet tool install --global wix --version 5.0.2
    Exigir 'dotnet tool install wix'
}
# «wix extension list» es una SONDA, no un paso: sin extensiones
# instaladas sale con código 2 sin que pase nada malo. Con la
# preferencia estricta que se activa arriba, ese código lanzaba
# NativeCommandExitException y tumbaba la construcción entera
# (corrida de panel-v1.0.2). La sonda va con la preferencia en pausa.
$PSNativeCommandUseErrorActionPreference = $false
& wix extension list 2>$null | Out-Null
$extensiones = (& wix extension list) -join ' '
$PSNativeCommandUseErrorActionPreference = $true
if ($extensiones -notmatch 'UI') {
    Write-Host 'Añadiendo la extensión de interfaz de WiX…'
    wix extension add -g WixToolset.UI.wixext/5.0.2
    Exigir 'wix extension add'
}

Write-Host '== 2/5 Descargas fijadas =='
New-Item -ItemType Directory -Force -Path $descargas, $prep | Out-Null
$zipPg = Join-Path $descargas "postgresql-$PgVersion-binarios.zip"
$zipNode = Join-Path $descargas "node-v$NodeVersion-win-x64.zip"
$exeWinSw = Join-Path $descargas "WinSW-x64-$WinSwVersion.exe"
Descargar "https://get.enterprisedb.com/postgresql/postgresql-$PgVersion-1-windows-x64-binaries.zip" $zipPg 'pg'
Descargar "https://nodejs.org/dist/v$NodeVersion/node-v$NodeVersion-win-x64.zip" $zipNode 'node'
Descargar "https://github.com/winsw/winsw/releases/download/v$WinSwVersion/WinSW-x64.exe" $exeWinSw 'winsw'

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
foreach ($carpeta in @('app', 'node', 'pgsql', 'servicio', 'scripts', 'raiz')) {
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
    /XD .git instalador USBMonitorCS USBMonitor salida-instalador `
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
# Servicio (WinSW renombrado + su plantilla) y scripts.
Copy-Item $exeWinSw (Join-Path $prep 'servicio\USBMonitorPanel.exe')
Copy-Item (Join-Path $inst 'servicio\USBMonitorPanel.xml') (Join-Path $prep 'servicio\')
Copy-Item (Join-Path $inst 'scripts\*') (Join-Path $prep 'scripts\')
Copy-Item (Join-Path $inst 'AbrirPanel.cmd') (Join-Path $prep 'raiz\')

Write-Host '== 5/5 Construir el .msi =='
$msi = Join-Path $salida "USBMonitor-Panel-$Version.msi"
Push-Location $inst
try {
    # -sw1163: el aviso de que VBScript está en retirada se acepta a
    # propósito: las dos acciones en VBScript llevan Return="ignore" y su
    # fallo degrada sin romper la instalación (ver «Problemas previstos»
    # del LEEME). Cualquier otro aviso sí debe verse.
    wix build Panel.wxs -ext WixToolset.UI.wixext -culture es-es -arch x64 `
        -d "Preparado=$prep" -d "PanelVersion=$Version" -sw1163 -o $msi
    if ($LASTEXITCODE -ne 0) { throw 'wix build falló' }
} finally { Pop-Location }

$info = Get-Item $msi
$hashMsi = (Get-FileHash -LiteralPath $msi -Algorithm SHA256).Hash
Write-Host ''
Write-Host "MSI listo: $msi"
Write-Host ("Tamaño: {0:N1} MB" -f ($info.Length / 1MB))
Write-Host "SHA-256: $hashMsi"
