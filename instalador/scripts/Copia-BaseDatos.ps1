# ================================================================
# USB Monitor — Panel · copia de seguridad de la base de datos
# ----------------------------------------------------------------
# Lo ejecuta la tarea programada «USB Monitor — Copia de la BD»
# (semanal, domingos 03:00, como SYSTEM; la registra
# Configurar-Panel.ps1 al instalar y la quita la desinstalación).
# Hace un pg_dump completo a Datos\Copias\ y conserva las 8
# últimas copias. Queda registrado en Registros\copias.log.
#
# Restaurar una copia (con el servicio del panel detenido):
#   $env:PGPASSWORD = <superClave de secretos.json>
#   pgsql\bin\psql.exe -h 127.0.0.1 -p <puerto> -U postgres `
#       -d usbmonitor -f Datos\Copias\<archivo>.sql
# ================================================================
$ErrorActionPreference = 'Stop'

try {
    $reg = Get-ItemProperty -LiteralPath 'HKLM:\SOFTWARE\USBMonitor\Panel'
    $puertoBd = [int]$reg.PgPort
    $datos = [string]$reg.DataDir
    $pgBin = Join-Path ([string]$reg.InstallDir) 'pgsql\bin'
    $carpetaCopias = Join-Path $datos 'Copias'
    $rutaLog = Join-Path $datos 'Registros\copias.log'
    New-Item -ItemType Directory -Force -Path $carpetaCopias | Out-Null

    $secretos = Get-Content -LiteralPath (Join-Path $datos 'secretos.json') -Raw | ConvertFrom-Json
    $env:PGPASSWORD = [string]$secretos.superClave
    $archivo = Join-Path $carpetaCopias ("usbmonitor-{0}.sql" -f (Get-Date -Format 'yyyyMMdd-HHmm'))
    & (Join-Path $pgBin 'pg_dump.exe') -h 127.0.0.1 -p $puertoBd -U postgres -d usbmonitor -f $archivo
    if ($LASTEXITCODE -ne 0) { throw "pg_dump falló ($LASTEXITCODE)" }
    Remove-Item Env:PGPASSWORD -ErrorAction SilentlyContinue

    # Rotación: solo las 8 más recientes.
    Get-ChildItem -LiteralPath $carpetaCopias -Filter 'usbmonitor-*.sql' |
        Sort-Object LastWriteTime -Descending | Select-Object -Skip 8 |
        Remove-Item -Force

    Add-Content -LiteralPath $rutaLog -Encoding UTF8 -Value `
        "[{0}] Copia creada: {1}" -f (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'), $archivo
    exit 0
} catch {
    try {
        Add-Content -LiteralPath $rutaLog -Encoding UTF8 -Value `
            "[{0}] ERROR: {1}" -f (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'), $_.Exception.Message
    } catch { }
    exit 1
}
