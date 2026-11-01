# Build-All.ps1 — compila el agente en C# a un solo ejecutable.
#
# Uso:
#   .\Build-All.ps1           - publica en dist\
#   .\Build-All.ps1 -Clean    - borra dist\ antes de publicar
#
# Requiere el SDK de .NET 8 en el PATH (dotnet).
param(
    [switch]$Clean
)

$ErrorActionPreference = "Stop"
$raiz = Split-Path -Parent $PSScriptRoot
$proyecto = Join-Path $raiz "src\Agente.Servicio\Agente.Servicio.csproj"
$dist = Join-Path $raiz "dist"

if ($Clean -and (Test-Path $dist)) {
    Remove-Item $dist -Recurse -Force
}

dotnet publish $proyecto -c Release -r win-x64 --self-contained true `
    -p:PublishSingleFile=true -p:IncludeNativeLibrariesForSelfExtract=true `
    -o $dist

Write-Host "Listo: $dist\USBMonitorService.exe"
