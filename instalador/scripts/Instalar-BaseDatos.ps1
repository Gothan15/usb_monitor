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
#   5. Si el asistente dejó ajustes de rendimiento en el
#      registro (página «Instalación avanzada»), los aplica con
#      ALTER SYSTEM y reinicia el servicio una vez.
# Todo queda registrado en Registros\instalacion.log y en su
# espejo C:\ProgramData\USBMonitor-instalacion.log, que sobrevive
# a la reversión de una instalación fallida.
# ================================================================
$ErrorActionPreference = 'Stop'

function Escribir-Log([string]$Mensaje) {
    $linea = "[{0}] [BD] {1}" -f (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'), $Mensaje
    Write-Host $linea
    try { Add-Content -LiteralPath $script:RutaLog -Value $linea -Encoding UTF8 } catch { }
    # Espejo FUERA del árbol de datos: si la instalación falla, la
    # reversión se lleva las carpetas que el MSI creó (Registros\
    # entre ellas) y con ellas el registro de arriba. Este archivo
    # vive suelto en C:\ProgramData, que el instalador no gestiona,
    # y es el que hay que mirar (o enviar) cuando algo sale mal.
    try { Add-Content -LiteralPath $script:RutaLogEspejo -Value $linea -Encoding UTF8 } catch { }
}

function Nueva-Clave([int]$Longitud = 32) {
    # Solo alfanumérica: segura de interpolar en SQL y en la URL.
    $bytes = New-Object byte[] 48
    [System.Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($bytes)
    $texto = [Convert]::ToBase64String($bytes) -replace '[^a-zA-Z0-9]', ''
    return $texto.Substring(0, $Longitud)
}

try {
    # El registro se apunta PRIMERO a la ruta estándar, antes de
    # leer nada más: si la lectura del registro (o cualquier paso
    # previo) falla, el error tiene que poder escribirse en algún
    # sitio. Con la ruta dependiendo de esa misma lectura, un
    # fallo ahí dejaba la instalación muda y sin registro.
    $programData = [Environment]::GetFolderPath('CommonApplicationData')
    $datosEstandar = Join-Path $programData 'USBMonitor'
    New-Item -ItemType Directory -Force -Path (Join-Path $datosEstandar 'Registros') | Out-Null
    $script:RutaLog = Join-Path $datosEstandar 'Registros\instalacion.log'
    $script:RutaLogEspejo = Join-Path $programData 'USBMonitor-instalacion.log'
    Escribir-Log 'Arranque del script de la base de datos.'

    $reg = Get-ItemProperty -LiteralPath 'HKLM:\SOFTWARE\USBMonitor\Panel'
    $puertoBd = [int]$reg.PgPort
    $datos = [string]$reg.DataDir
    $instalacion = [string]$reg.InstallDir
    $pgBin = Join-Path $instalacion 'pgsql\bin'
    $pgDatos = Join-Path $datos 'Datos'
    New-Item -ItemType Directory -Force -Path (Join-Path $datos 'Registros') | Out-Null
    $script:RutaLog = Join-Path $datos 'Registros\instalacion.log'
    $script:RutaLogEspejo = Join-Path (Split-Path $datos -Parent) 'USBMonitor-instalacion.log'

    Escribir-Log "Inicio. Puerto BD=$puertoBd, datos=$pgDatos"
    Escribir-Log "Ejecutando como $([System.Security.Principal.WindowsIdentity]::GetCurrent().Name); instalacion=$instalacion"

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
                # La salida de initdb va al registro: si el clúster
                # no nace, su propio texto es la causa raíz.
                $salidaInitdb = & (Join-Path $pgBin 'initdb.exe') -D $pgDatos -U postgres `
                    --auth=scram-sha-256 --pwfile=$pwfile -E UTF8 2>&1 | Out-String
                foreach ($lineaInitdb in ($salidaInitdb -split "`r?`n")) {
                    if ($lineaInitdb.Trim()) { Escribir-Log "initdb: $lineaInitdb" }
                }
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
        $salidaRegistro = & (Join-Path $pgBin 'pg_ctl.exe') register -N $nombreServicio -D $pgDatos -S auto 2>&1 | Out-String
        if ($salidaRegistro.Trim()) { Escribir-Log "pg_ctl register: $($salidaRegistro.Trim())" }
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
        $salidaRol = & $psql @baseArgs -c "CREATE USER usbmonitor WITH PASSWORD '$($secretos.appClave)'" 2>&1 | Out-String
        if ($salidaRol.Trim()) { Escribir-Log "psql (rol): $($salidaRol.Trim())" }
        if ($LASTEXITCODE -ne 0) { throw 'No se pudo crear el rol de la aplicación.' }
        Escribir-Log 'Rol de la aplicación creado.'
    }
    $existeBd = & $psql @baseArgs -c "SELECT 1 FROM pg_database WHERE datname='usbmonitor'"
    if ($existeBd -ne '1') {
        $salidaBd = & $psql @baseArgs -c "CREATE DATABASE usbmonitor OWNER usbmonitor" 2>&1 | Out-String
        if ($salidaBd.Trim()) { Escribir-Log "psql (base): $($salidaBd.Trim())" }
        if ($LASTEXITCODE -ne 0) { throw 'No se pudo crear la base de datos.' }
        Escribir-Log 'Base de datos creada.'
    }

    # --- 5. Ajustes de rendimiento (página avanzada) ---
    # Los valores llegan del asistente por el registro; sin
    # ellos (instalación anterior a esta opción) no se toca la
    # configuración. Se aplican con ALTER SYSTEM (quedan en
    # postgresql.auto.conf, en la carpeta de datos) y un
    # reinicio del servicio. Un fallo aquí NO tumba la
    # instalación: la base funciona igual con los valores de
    # fábrica, así que se anota como aviso y se sigue.
    if ($null -ne $reg.PgSharedBuffers) {
        try {
            $sharedMb = [int]$reg.PgSharedBuffers
            $workMb = [int]$reg.PgWorkMem
            $maintMb = [int]$reg.PgMaintenanceWorkMem
            $maxConn = [int]$reg.PgMaxConnections
            $esSsd = ([string]$reg.PgDiscoSsd) -eq '1'
            # La caché efectiva se deriva de la compartida (el
            # triple, con tope): es lo que el planificador supone
            # que el sistema puede tener en caché.
            $cacheMb = [Math]::Min($sharedMb * 3, 24576)
            if ($esSsd) { $costePagina = '1.1'; $ioConcurrencia = 200 }
            else { $costePagina = '4'; $ioConcurrencia = 2 }
            # El trabajo en paralelo sigue a los núcleos que el
            # asistente leyó del equipo (4 si no llegaron).
            $nucleos = 4
            if ($null -ne $reg.PgNucleos) { $nucleos = [Math]::Max(1, [int]$reg.PgNucleos) }
            $trabajadores = [Math]::Max(2, $nucleos)
            $porConsulta = [Math]::Max(1, [int]($nucleos / 2))
            $ajustes = @(
                "shared_buffers = '${sharedMb}MB'"
                "effective_cache_size = '${cacheMb}MB'"
                "work_mem = '${workMb}MB'"
                "maintenance_work_mem = '${maintMb}MB'"
                "max_connections = $maxConn"
                "random_page_cost = $costePagina"
                "effective_io_concurrency = $ioConcurrencia"
                "wal_buffers = '16MB'"
                "checkpoint_completion_target = 0.9"
                "max_worker_processes = $trabajadores"
                "max_parallel_workers = $trabajadores"
                "max_parallel_workers_per_gather = $porConsulta"
            )
            foreach ($ajuste in $ajustes) {
                & $psql @baseArgs -c "ALTER SYSTEM SET $ajuste" | Out-Null
                if ($LASTEXITCODE -ne 0) { throw "ALTER SYSTEM SET $ajuste falló" }
            }
            Escribir-Log "Ajustes de rendimiento: shared_buffers=${sharedMb}MB, effective_cache_size=${cacheMb}MB, work_mem=${workMb}MB, maintenance_work_mem=${maintMb}MB, max_connections=$maxConn, ssd=$esSsd."
            Restart-Service -Name $nombreServicio -Force
            $listoAjuste = $false
            for ($i = 0; $i -lt 30; $i++) {
                & (Join-Path $pgBin 'pg_isready.exe') -h 127.0.0.1 -p $puertoBd -q
                if ($LASTEXITCODE -eq 0) { $listoAjuste = $true; break }
                Start-Sleep -Seconds 2
            }
            if (-not $listoAjuste) { throw 'La base de datos no respondió tras el reinicio de los ajustes.' }
            Escribir-Log 'Base de datos reiniciada con los ajustes de rendimiento.'
        } catch {
            Escribir-Log "AVISO: los ajustes de rendimiento no se pudieron aplicar: $($_.Exception.Message)"
        }
    } else {
        Escribir-Log 'Sin ajustes de rendimiento guardados: la configuración de PostgreSQL queda como está.'
    }
    Remove-Item Env:PGPASSWORD -ErrorAction SilentlyContinue

    Escribir-Log 'Base de datos lista.'
    exit 0
} catch {
    try { Escribir-Log "ERROR: $($_.Exception.Message)" } catch { Write-Host "ERROR: $($_.Exception.Message)" }
    exit 1
}
