# Build-All.ps1 — compila el agente en C# a un solo ejecutable.
#
# Uso:
#   .\Build-All.ps1           - publica en dist\
#   .\Build-All.ps1 -Clean    - borra dist\ antes de publicar
#
# Requiere el SDK de .NET 8 en el PATH (dotnet). La PRIMERA vez
# descarga los paquetes de NuGet (hace falta internet o la carpeta
# paquetes\ con los .nupkg; ver nuget.config). Si la descarga o la
# publicación fallan, el script se detiene con error y NO anuncia
# un ejecutable que no existe.
param(
    [switch]$Clean
)

$ErrorActionPreference = "Stop"
$raiz = Split-Path -Parent $PSScriptRoot
$proyecto = Join-Path $raiz "src\Agente.Servicio\Agente.Servicio.csproj"
$dist = Join-Path $raiz "dist"
$exe = Join-Path $dist "USBMonitorService.exe"

if ($Clean -and (Test-Path $dist)) {
    Remove-Item $dist -Recurse -Force
}

dotnet publish $proyecto -c Release -r win-x64 --self-contained true `
    -p:PublishSingleFile=true -p:IncludeNativeLibrariesForSelfExtract=true `
    -o $dist

if ($LASTEXITCODE -ne 0) {
    Write-Host ""
    Write-Host "ERROR: la publicación falló (código $LASTEXITCODE). No hay ejecutable nuevo." -ForegroundColor Red
    Write-Host "Si el error es NU1301 (no se pudo cargar api.nuget.org), es la conexión:" -ForegroundColor Red
    Write-Host "la primera compilación descarga los paquetes de NuGet. Reintenta con" -ForegroundColor Red
    Write-Host "internet o usa la carpeta paquetes\ con los .nupkg (ver nuget.config)." -ForegroundColor Red
    exit 1
}

if (-not (Test-Path $exe)) {
    Write-Host "ERROR: la publicación terminó pero no apareció $exe" -ForegroundColor Red
    exit 1
}

$tam = [math]::Round((Get-Item $exe).Length / 1MB, 1)
Write-Host "Listo: $exe ($tam MB)"
