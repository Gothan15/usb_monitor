# USB Monitor v2 - Compilar todos los programas de una vez
#
# Uso:
#   .\Build-All.ps1                     - los tres programas
#   .\Build-All.ps1 -Solo Servicio      - solo ese (o varios)
#   .\Build-All.ps1 -Clean              - borra dist/build antes
#   .\Build-All.ps1 -ElegirServidor     - abre una ventana para elegir
#                                         la IP del servidor; queda en
#                                         server.json junto a los exe

param(
    [ValidateSet("Servicio", "Companero", "Visor")]
    [string[]]$Solo = @(),
    [switch]$Clean,
    [switch]$ElegirServidor,
    [string]$Python = "python"
)

$ErrorActionPreference = "Stop"

$buildRoot = $PSScriptRoot
$root = Split-Path -Parent $buildRoot
Set-Location -Path $root

# Elegir el servidor con una ventana: escribe server.json en la raiz
# de USBMonitor y abajo se copia junto a los exe del servicio y del
# companero. El agente lo lee antes que las variables de entorno.
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

# Programa -> spec, carpeta de salida, carpeta de trabajo y exe.
$Programs = @(
    @{ Key = "Servicio";  Spec = "USBMonitorService.spec"; Dist = "dist";                    Work = "build_usb_monitor_service"; Exe = "USBMonitorService.exe" },
    @{ Key = "Companero"; Spec = "USBMonitorPrompt.spec";  Dist = "dist_usb_prompt";         Work = "build_usb_prompt";          Exe = "USBMonitorPrompt.exe" },
    @{ Key = "Visor";     Spec = "USBSerialViewer.spec";   Dist = "dist_usb_serial_viewer";  Work = "build_usb_serial_viewer";   Exe = "USBSerialViewer.exe" }
)

$selected = $Programs | Where-Object { $Solo.Count -eq 0 -or $Solo -contains $_.Key }

$failed = @()
foreach ($p in $selected) {
    $specPath = Join-Path $buildRoot $p.Spec
    $distPath = Join-Path $root $p.Dist
    $workPath = Join-Path $root $p.Work
    if ($Clean) {
        if (Test-Path $distPath) { Remove-Item $distPath -Recurse -Force }
        if (Test-Path $workPath) { Remove-Item $workPath -Recurse -Force }
    }
    Write-Host "`n===== Compilando $($p.Key) =====" -ForegroundColor Cyan
    & $Python -m PyInstaller --noconfirm --distpath $distPath --workpath $workPath $specPath | Out-Host
    $exePath = Join-Path $distPath $p.Exe
    if ($LASTEXITCODE -eq 0 -and (Test-Path $exePath)) {
        Write-Host "[OK] $($p.Exe) -> $distPath" -ForegroundColor Green
        if (($p.Key -eq "Servicio" -or $p.Key -eq "Companero") -and (Test-Path $serverJson)) {
            Copy-Item $serverJson -Destination (Join-Path $distPath "server.json") -Force
            Write-Host "    server.json copiado junto al exe" -ForegroundColor DarkGray
        }
    } else {
        Write-Host "[X] La compilacion de $($p.Key) fallo" -ForegroundColor Red
        $failed += $p.Key
    }
}

Write-Host "`n========================================" -ForegroundColor Cyan
if ($failed.Count -eq 0) {
    Write-Host "Compilacion completa: $($selected.Count) programa(s), sin fallos." -ForegroundColor Green
} else {
    Write-Host "Fallaron: $($failed -join ', ')" -ForegroundColor Red
    exit 1
}
