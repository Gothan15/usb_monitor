# ================================================================
# USB Monitor — Panel · instalación de la base de datos integrada
# ----------------------------------------------------------------
# Acción diferida del MSI (se ejecuta como SYSTEM). Lee TODA su
# configuración de HKLM\SOFTWARE\USBMonitor\Panel (la escriben los
# componentes del MSI desde lo elegido en el asistente).
#
# Qué hace, de forma idempotente (vale igual para instalar y para
# actualizar):
#   1. Genera (una sola vez) las contraseñas internas y las guarda
#      en «secretos.json» dentro de la carpeta de datos, con la ACL
#      cerrada a SYSTEM + Administradores.
#   2. Si el clúster no existe, lo crea con initdb (UTF-8,
#      autenticación scram-sha-256) en Datos\, con SU puerto y
#      escuchando solo en localhost: no toca ningún PostgreSQL que
#      ya tenga el equipo y no necesita pgAdmin para nada.
#   3. Registra el servicio «USBMonitorPostgreSQL» (LocalSystem,
#      arranque automático) y lo arranca.
#   4. Crea el rol y la base de datos de la aplicación.
# Todo queda registrado en Registros\instalacion.log.
# ================================================================
$ErrorActionPreference = 'Stop'

function Escribir-Log([string]$Mensaje) {
    $linea = "[{0}] [BD] {1}" -f (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'), $Mensaje
    Write-Host $linea
    try { Add-Content -LiteralPath $script:RutaLog -Value $linea -Encoding UTF8 } catch { }
}

function Nueva-Clave([int]$Longitud = 32) {
    # Solo alfanumérica: segura de interpolar en SQL y en la URL.
    $bytes = New-Object byte[] 48
    [System.Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($bytes)
    $texto = [Convert]::ToBase64String($bytes) -replace '[^a-zA-Z0-9]', ''
    return $texto.Substring(0, $Longitud)
}

try {
    $reg = Get-ItemProperty -LiteralPath 'HKLM:\SOFTWARE\USBMonitor\Panel'
    $puertoBd = [int]$reg.PgPort
    $datos = [string]$reg.DataDir
    $instalacion = [string]$reg.InstallDir
    $pgBin = Join-Path $instalacion 'pgsql\bin'
    $pgDatos = Join-Path $datos 'Datos'
    $script:RutaLog = Join-Path $datos 'Registros\instalacion.log'

    Escribir-Log "Inicio. Puerto BD=$puertoBd, datos=$pgDatos"

    # --- 1. Contraseñas internas ---
    $rutaSecretos = Join-Path $datos 'secretos.json'
    if (Test-Path -LiteralPath $rutaSecretos) {
        $secretos = Get-Content -LiteralPath $rutaSecretos -Raw | ConvertFrom-Json
        Escribir-Log 'Secretos existentes reutilizados.'
    } else {
        $secretos = [pscustomobject]@{
            superClave = Nueva-Clave
            appClave   = Nueva-Clave
        }
        $secretos | ConvertTo-Json | Set-Content -LiteralPath $rutaSecretos -Encoding UTF8
        # ACL cerrada por SID (SYSTEM + Administradores), sin herencia.
        & icacls $rutaSecretos /inheritance:r /grant:r '*S-1-5-18:F' '*S-1-5-32-544:F' | Out-Null
        Escribir-Log 'Secretos generados y protegidos.'
    }

    $nombreServicio = 'USBMonitorPostgreSQL'
    $servicio = Get-Service -Name $nombreServicio -ErrorAction SilentlyContinue

    # --- 2/3. Clúster y servicio ---
    if (-not $servicio) {
        if (-not (Test-Path -LiteralPath (Join-Path $pgDatos 'PG_VERSION'))) {
            $pwfile = Join-Path $env:TEMP 'usbmonitor-pw.txt'
            Set-Content -LiteralPath $pwfile -Value $secretos.superClave -NoNewline -Encoding ASCII
            try {
                & (Join-Path $pgBin 'initdb.exe') -D $pgDatos -U postgres `
                    --auth=scram-sha-256 --pwfile=$pwfile -E UTF8
                if ($LASTEXITCODE -ne 0) { throw "initdb falló ($LASTEXITCODE)" }
            } finally {
                Remove-Item -LiteralPath $pwfile -Force -ErrorAction SilentlyContinue
            }
            Add-Content -LiteralPath (Join-Path $pgDatos 'postgresql.conf') -Encoding ASCII -Value @(
                ""
                "# --- USB Monitor (instalador) ---"
                "port = $puertoBd"
                "listen_addresses = 'localhost'"
            )
            Escribir-Log 'Clúster creado con initdb.'
        }
        & (Join-Path $pgBin 'pg_ctl.exe') register -N $nombreServicio -D $pgDatos -S auto
        if ($LASTEXITCODE -ne 0) { throw "pg_ctl register falló ($LASTEXITCODE)" }
        Escribir-Log "Servicio $nombreServicio registrado."
        $servicio = Get-Service -Name $nombreServicio
    }

    if ($servicio.Status -ne 'Running') {
        Start-Service -Name $nombreServicio
        Escribir-Log 'Servicio de BD arrancado.'
    }

    # Espera a que acepte conexiones (máx. 60 s).
    $listo = $false
    for ($i = 0; $i -lt 30; $i++) {
        & (Join-Path $pgBin 'pg_isready.exe') -h 127.0.0.1 -p $puertoBd -q
        if ($LASTEXITCODE -eq 0) { $listo = $true; break }
        Start-Sleep -Seconds 2
    }
    if (-not $listo) { throw 'La base de datos no respondió en 60 segundos.' }

    # --- 4. Rol y base de la aplicación (idempotente) ---
    $env:PGPASSWORD = [string]$secretos.superClave
    $psql = Join-Path $pgBin 'psql.exe'
    $baseArgs = @('-h', '127.0.0.1', '-p', "$puertoBd", '-U', 'postgres', '-v', 'ON_ERROR_STOP=1', '-tA')
    $existeRol = & $psql @baseArgs -c "SELECT 1 FROM pg_roles WHERE rolname='usbmonitor'"
    if ($existeRol -ne '1') {
        & $psql @baseArgs -c "CREATE USER usbmonitor WITH PASSWORD '$($secretos.appClave)'"
        if ($LASTEXITCODE -ne 0) { throw 'No se pudo crear el rol de la aplicación.' }
        Escribir-Log 'Rol de la aplicación creado.'
    }
    $existeBd = & $psql @baseArgs -c "SELECT 1 FROM pg_database WHERE datname='usbmonitor'"
    if ($existeBd -ne '1') {
        & $psql @baseArgs -c "CREATE DATABASE usbmonitor OWNER usbmonitor"
        if ($LASTEXITCODE -ne 0) { throw 'No se pudo crear la base de datos.' }
        Escribir-Log 'Base de datos creada.'
    }
    Remove-Item Env:PGPASSWORD -ErrorAction SilentlyContinue

    Escribir-Log 'Base de datos lista.'
    exit 0
} catch {
    try { Escribir-Log "ERROR: $($_.Exception.Message)" } catch { Write-Host "ERROR: $($_.Exception.Message)" }
    exit 1
}
