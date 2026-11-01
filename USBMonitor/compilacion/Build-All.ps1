# USB Monitor v2 - Compilar el agente (un solo ejecutable)
#
# Desde la v2 todo el agente es UN programa, USBMonitorService.exe,
# con modos: servicio, gui (caja de herramientas), prompt (companero),
# visor y restaurar.
#
# Uso:
#   .\Build-All.ps1                     - compila el ejecutable
#   .\Build-All.ps1 -Clean              - borra dist/build antes
#   .\Build-All.ps1 -ElegirServidor     - abre una ventana para elegir
#                                         la IP del servidor; queda en
#                                         server.json junto al exe

param(
    [switch]$Clean,
    [switch]$ElegirServidor,
    [string]$Python = "python"
)

$ErrorActionPreference = "Stop"

$buildRoot = $PSScriptRoot
$root = Split-Path -Parent $buildRoot
Set-Location -Path $root

$serverJson = Join-Path $root "server.json"
if ($ElegirServidor) {
    $picker = Join-Path $buildRoot "elegir_servidor.py"
    Write-Host "`n===== Servidor del agente =====" -ForegroundColor Cyan
    & $Python $picker | Out-Host
    if ($LASTEXITCODE -ne 0) {
        Write-Host "[X] Seleccion cancelada: no se compila nada." -ForegroundColor Red
        exit 1
    }
}

$specPath = Join-Path $buildRoot "USBMonitorService.spec"
$distPath = Join-Path $root "dist"
$workPath = Join-Path $root "build_usb_monitor_service"
if ($Clean) {
    if (Test-Path $distPath) { Remove-Item $distPath -Recurse -Force }
    if (Test-Path $workPath) { Remove-Item $workPath -Recurse -Force }
}

Write-Host "`n===== Compilando el agente (un solo ejecutable) =====" -ForegroundColor Cyan
& $Python -m PyInstaller --noconfirm --distpath $distPath --workpath $workPath $specPath | Out-Host
$exePath = Join-Path $distPath "USBMonitorService.exe"
if ($LASTEXITCODE -eq 0 -and (Test-Path $exePath)) {
    Write-Host "[OK] USBMonitorService.exe -> $distPath" -ForegroundColor Green
    if (Test-Path $serverJson) {
        Copy-Item $serverJson -Destination (Join-Path $distPath "server.json") -Force
        Write-Host "    server.json copiado junto al exe" -ForegroundColor DarkGray
    }
} else {
    Write-Host "[X] La compilacion fallo" -ForegroundColor Red
    exit 1
}
