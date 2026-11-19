# ============================================================
#  USB Monitor - App de escritorio: construccion
# ============================================================
#  Publica la app de escritorio como un solo exe
#  autocontenido en escritorio\dist\USBMonitorEscritorio.exe.
#  No hace falta tener .NET instalado en el equipo destino:
#  el runtime viaja dentro del exe, igual que la bandeja.
#
#  Uso:  powershell -ExecutionPolicy Bypass -File .\Construir-Escritorio.ps1
#  Requiere el SDK de .NET 10 en el equipo que compila.

$ErrorActionPreference = 'Stop'

# La carpeta de este script (escritorio\) y la salida.
$raiz = Split-Path -Parent $MyInvocation.MyCommand.Path
$salida = Join-Path $raiz 'dist'

Write-Host "Publicando la app de escritorio en $salida ..."

# win-x64, un solo archivo, autocontenido: el mismo perfil
# de publicacion que usa la bandeja del panel.
dotnet publish (Join-Path $raiz 'Escritorio.csproj') `
    -c Release `
    -r win-x64 `
    --self-contained true `
    -p:PublishSingleFile=true `
    -o $salida

if ($LASTEXITCODE -ne 0) {
    throw "dotnet publish fallo con codigo $LASTEXITCODE"
}

Write-Host "Listo: $(Join-Path $salida 'USBMonitorEscritorio.exe')"
