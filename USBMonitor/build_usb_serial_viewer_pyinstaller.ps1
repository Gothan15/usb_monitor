param(
    [string]$Python = "python",
    [switch]$Clean
)

$ErrorActionPreference = "Stop"

Set-Location -Path $PSScriptRoot

$distPath = Join-Path $PSScriptRoot "dist_usb_serial_viewer"
$buildPath = Join-Path $PSScriptRoot "build_usb_serial_viewer"
$specPath = Join-Path $PSScriptRoot "USBSerialViewer.spec"

if (!(Test-Path $specPath)) {
    Write-Error "No se encontró USBSerialViewer.spec en $PSScriptRoot"
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

$exePath = Join-Path $distPath "USBSerialViewer.exe"
if (Test-Path $exePath) {
    Write-Host "Ejecutable generado en $exePath"
} else {
    Write-Warning "PyInstaller finalizó pero no se encontró $exePath. Revise los mensajes anteriores."
}
