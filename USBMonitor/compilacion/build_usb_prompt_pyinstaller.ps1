param(
    [string]$Python = "python",
    [switch]$Clean
)

$ErrorActionPreference = "Stop"

# Este script vive en compilacion\; la raíz del agente es su carpeta
# madre, que es donde están las fuentes y donde quedan los dist_*.
$root = Split-Path -Parent $PSScriptRoot
Set-Location -Path $root

$distPath = Join-Path $root "dist_usb_prompt"
$buildPath = Join-Path $root "build_usb_prompt"
$specPath = Join-Path $PSScriptRoot "USBMonitorPrompt.spec"

if (!(Test-Path $specPath)) {
    Write-Error "No se encontró USBMonitorPrompt.spec en $PSScriptRoot"
}

if ($Clean) {
    if (Test-Path $distPath) {
        Remove-Item $distPath -Recurse -Force
    }
    if (Test-Path $buildPath) {
        Remove-Item $buildPath -Recurse -Force
    }
}

$arguments = @(
    "-m", "PyInstaller",
    "--noconfirm",
    "--distpath", $distPath,
    "--workpath", $buildPath,
    $specPath
)

& $Python $arguments
if ($LASTEXITCODE -ne 0) {
    throw "PyInstaller devolvió código $LASTEXITCODE"
}

$exePath = Join-Path $distPath "USBMonitorPrompt.exe"
if (Test-Path $exePath) {
    Write-Host "Ejecutable generado en $exePath"
} else {
    Write-Warning "PyInstaller finalizó pero no se encontró $exePath. Revise los mensajes anteriores."
}
