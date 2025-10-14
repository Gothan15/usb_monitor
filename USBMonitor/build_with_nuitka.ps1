param(
    [string]$Python = "python",
    [switch]$Clean
)

$ErrorActionPreference = "Stop"

Set-Location -Path $PSScriptRoot

$distPath = Join-Path $PSScriptRoot "dist_nuitka"

if ($Clean -and (Test-Path $distPath)) {
    Remove-Item $distPath -Recurse -Force
}

$iconPath = Join-Path $PSScriptRoot "usb_monitor_service.ico"
if (!(Test-Path $iconPath)) {
    Write-Error "No se encontró el icono en $iconPath"
}

$scriptPath = Join-Path $PSScriptRoot "usb_monitor_service.py"
if (!(Test-Path $scriptPath)) {
    Write-Error "No se encontró usb_monitor_service.py en $PSScriptRoot"
}

$arguments = @(
    "-m", "nuitka",
    $scriptPath,
    "--onefile",
    "--standalone",
    "--windows-console-mode=disable",
    "--include-module=win32timezone",
    "--include-module=servicemanager",
    "--include-module=pythoncom",
    "--windows-icon-from-ico=$iconPath",
    "--output-dir=$distPath"
)

& $Python $arguments
if ($LASTEXITCODE -ne 0) {
    throw "Nuitka devolvió código $LASTEXITCODE"
}
