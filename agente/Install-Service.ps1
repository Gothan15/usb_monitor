# Install-Service.ps1 — instala el agente en C# en esta PC.
#
# Misma interfaz que el del agente Python (la instalación remota del
# panel lo invoca así):
#   .\Install-Service.ps1 [-ServerHost 192.168.1.10] [-ServerPort 3000]
#                         [-CodigoEnrolamiento <código>] [-Action install]
#
# Escribe server.json junto al ejecutable (host/puerto/esquema),
# guarda el código de enrolamiento cifrado con el propio agente (modo fijar-codigo) y
# delega el registro del servicio en el ejecutable (modo instalar).
param(
    [string]$ServerHost = "localhost",
    [int]$ServerPort = 3000,
    [string]$CodigoEnrolamiento = "",
    [string]$Action = "install"
)

$ErrorActionPreference = "Stop"
$exe = Join-Path $PSScriptRoot "dist\USBMonitorService.exe"
if (-not (Test-Path $exe)) {
    $exe = Join-Path $PSScriptRoot "USBMonitorService.exe"
}
if (-not (Test-Path $exe)) {
    throw "No se encuentra USBMonitorService.exe: compila primero con compilacion\Build-All.ps1."
}

if ($Action -ne "install") {
    & $exe desinstalar
    return
}

$serverJson = @{
    serverHost   = $ServerHost
    serverPort   = $ServerPort
    serverScheme = "http"
} | ConvertTo-Json
$destino = Join-Path (Split-Path -Parent $exe) "server.json"
$serverJson | Set-Content -Path $destino -Encoding UTF8
Write-Host "server.json escrito en $destino"

if ($CodigoEnrolamiento) {
    & $exe fijar-codigo $CodigoEnrolamiento
}

& $exe instalar
