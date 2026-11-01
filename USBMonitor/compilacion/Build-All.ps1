# USB Monitor - Compilar todos los programas de una vez
# Sustituye a los antiguos build_*_pyinstaller.ps1 (uno por programa,
# con la misma logica copiada cuatro veces): aqui la logica vive una
# sola vez y los programas son una tabla. No instala nada: solo
# compila y deja cada exe en su carpeta dist_*.
#
# Uso:
#   .\Build-All.ps1                     - los tres programas
#   .\Build-All.ps1 -Solo Servicio      - solo ese (o varios)
#   .\Build-All.ps1 -Clean              - borra dist/build antes

param(
    [ValidateSet("Servicio", "Companero", "Visor")]
    [string[]]$Solo = @(),
    [switch]$Clean,
    [string]$Python = "python"
)

$ErrorActionPreference = "Stop"

$buildRoot = $PSScriptRoot
$root = Split-Path -Parent $buildRoot
Set-Location -Path $root

# Programa -> spec, carpeta de salida, carpeta de trabajo y exe.
$Programs = @(
    @{ Key = "Servicio";  Spec = "USBMonitorService.spec"; Dist = "dist";                    Work = "build_usb_monitor_service"; Exe = "USBMonitorService.exe" },
    @{ Key = "Companero"; Spec = "USBMonitorPrompt.spec";  Dist = "dist_usb_prompt";         Work = "build_usb_prompt";          Exe = "USBMonitorPrompt.exe" },
    @{ Key = "Visor";     Spec = "USBSerialViewer.spec";   Dist = "dist_usb_serial_viewer";  Work = "build_usb_serial_viewer";   Exe = "USBSerialViewer.exe" },
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
