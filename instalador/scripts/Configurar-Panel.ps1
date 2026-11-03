# ================================================================
# USB Monitor — Panel · configuración tras instalar los archivos
# ----------------------------------------------------------------
# Acción diferida del MSI (SYSTEM), después de Instalar-BaseDatos.
# Lee HKLM\SOFTWARE\USBMonitor\Panel y deja el panel funcionando:
#   1. Credenciales del administrador inicial: si el asistente las
#      trajo (acceso-inicial.ini, que GuardarAdmin.vbs dejó con ACL
#      cerrada), las usa y DESTRUYE el archivo. Si no las hay
#      (instalación silenciosa), genera una contraseña y la deja en
#      PRIMER-ACCESO.txt — solo cuando la cuenta se crea de verdad.
#   2. Escribe el .env del panel (o, si ya existe de una versión
#      anterior, solo refresca el puerto: los secretos se conservan).
#   3. Aplica el esquema con «prisma db push» (la misma orden que
#      en el PC de desarrollo; el panel no usa migraciones).
#   4. Crea el administrador con crear-admin-instalador.mjs
#      (idempotente: si ya hay un administrador, no toca nada).
#   5. Estampa la plantilla de WinSW con el puerto real, instala el
#      servicio «USBMonitorPanel» y lo arranca (su dependencia
#      arranca la BD si hiciera falta).
#   6. Regla de cortafuegos (si el asistente la dejó marcada):
#      puerto del panel abierto solo a la subred local.
#   7. Comprueba que el panel responde por HTTP (sin tumbar la
#      instalación si tarda: queda registrado en el log).
# ================================================================
$ErrorActionPreference = 'Stop'

function Escribir-Log([string]$Mensaje) {
    $linea = "[{0}] [Panel] {1}" -f (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'), $Mensaje
    Write-Host $linea
    try { Add-Content -LiteralPath $script:RutaLog -Value $linea -Encoding UTF8 } catch { }
}

function Nueva-Clave([int]$Longitud = 24) {
    $bytes = New-Object byte[] 48
    [System.Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($bytes)
    $texto = [Convert]::ToBase64String($bytes) -replace '[^a-zA-Z0-9]', ''
    return $texto.Substring(0, $Longitud)
}

try {
    $reg = Get-ItemProperty -LiteralPath 'HKLM:\SOFTWARE\USBMonitor\Panel'
    $puerto = [int]$reg.PanelPort
    $puertoBd = [int]$reg.PgPort
    $cortafuegos = [string]$reg.FirewallOk
    $instalacion = [string]$reg.InstallDir
    $datos = [string]$reg.DataDir
    $script:RutaLog = Join-Path $datos 'Registros\instalacion.log'

    $app = Join-Path $instalacion 'app'
    $nodo = Join-Path $instalacion 'node\node.exe'
    $secretos = Get-Content -LiteralPath (Join-Path $datos 'secretos.json') -Raw | ConvertFrom-Json
    $urlBd = "postgresql://usbmonitor:$($secretos.appClave)@127.0.0.1:$puertoBd/usbmonitor"

    Escribir-Log "Inicio. Puerto panel=$puerto, BD=$puertoBd"

    # --- 1. Credenciales del administrador inicial ---
    $adminUsuario = [string]$reg.AdminUser
    $adminClave = $null
    $rutaIni = Join-Path $datos 'acceso-inicial.ini'
    if (Test-Path -LiteralPath $rutaIni) {
        foreach ($linea in Get-Content -LiteralPath $rutaIni) {
            if ($linea -like 'usuario=*') { $adminUsuario = $linea.Substring(8) }
            if ($linea -like 'clave=*')   { $adminClave   = $linea.Substring(6) }
        }
        # Destrucción: sobrescribir y borrar.
        $relleno = New-Object byte[] 256
        [System.Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($relleno)
        [System.IO.File]::WriteAllBytes($rutaIni, $relleno)
        Remove-Item -LiteralPath $rutaIni -Force
        Escribir-Log 'Credenciales del asistente consumidas y destruidas.'
    }
    $claveGenerada = $false
    if ([string]::IsNullOrWhiteSpace($adminClave)) {
        $adminClave = Nueva-Clave 20
        $claveGenerada = $true
    }

    # --- 2. El .env del panel ---
    $rutaEnv = Join-Path $app '.env'
    if (Test-Path -LiteralPath $rutaEnv) {
        $contenido = Get-Content -LiteralPath $rutaEnv
        $contenido = $contenido -replace '^PORT=.*', "PORT=$puerto"
        if (-not ($contenido -match '^PORT=')) { $contenido += "PORT=$puerto" }
        Set-Content -LiteralPath $rutaEnv -Value $contenido -Encoding UTF8
        Escribir-Log '.env existente conservado (solo se refrescó el puerto).'
    } else {
        $nombrePc = $env:COMPUTERNAME
        $ipLan = Get-NetIPAddress -AddressFamily IPv4 -ErrorAction SilentlyContinue |
            Where-Object { $_.IPAddress -notlike '127.*' -and $_.IPAddress -notlike '169.254.*' } |
            Select-Object -First 1 -ExpandProperty IPAddress
        $origenes = @("http://localhost:$puerto", "http://127.0.0.1:$puerto", "http://${nombrePc}:$puerto")
        if ($ipLan) { $origenes += "http://${ipLan}:$puerto" }
        $secretoSesion = [Convert]::ToHexString(
            [System.Security.Cryptography.RandomNumberGenerator]::GetBytes(32)).ToLower()
        @(
            "# Generado por el instalador de USB Monitor — Panel ($(Get-Date -Format 'yyyy-MM-dd'))"
            "DATABASE_URL=$urlBd"
            "PORT=$puerto"
            "APP_PUBLIC_HOST=$nombrePc"
            "ALLOWED_ORIGINS=$($origenes -join ',')"
            "ENFORCE_HTTPS_REDIRECT=false"
            "SESSION_SECRET=$secretoSesion"
        ) | Set-Content -LiteralPath $rutaEnv -Encoding UTF8
        & icacls $rutaEnv /inheritance:r /grant:r '*S-1-5-18:F' '*S-1-5-32-544:F' | Out-Null
        Escribir-Log '.env creado y protegido.'
    }

    # --- 3. Esquema de la base de datos ---
    $env:DATABASE_URL = $urlBd
    & $nodo (Join-Path $app 'node_modules\prisma\build\index.js') db push `
        --schema (Join-Path $app 'prisma\schema.prisma')
    if ($LASTEXITCODE -ne 0) { throw "prisma db push falló ($LASTEXITCODE)" }
    Escribir-Log 'Esquema aplicado (prisma db push).'

    # --- 4. Administrador inicial ---
    $env:INST_ADMIN_USER = $adminUsuario
    $env:INST_ADMIN_PASS = $adminClave
    $salidaAdmin = & $nodo (Join-Path $app 'crear-admin-instalador.mjs') 2>&1 | Out-String
    Escribir-Log "crear-admin: $($salidaAdmin.Trim())"
    if ($claveGenerada -and $salidaAdmin -match 'ADMIN_CREADO') {
        $rutaPrimerAcceso = Join-Path $datos 'PRIMER-ACCESO.txt'
        @(
            "USB Monitor — Panel · acceso inicial"
            ""
            "Usuario:    $adminUsuario"
            "Contraseña: $adminClave"
            ""
            "Es una contraseña generada por el instalador. Entra en el"
            "panel y cámbiala cuanto antes; después borra este archivo."
        ) | Set-Content -LiteralPath $rutaPrimerAcceso -Encoding UTF8
        & icacls $rutaPrimerAcceso /inheritance:r /grant:r '*S-1-5-18:F' '*S-1-5-32-544:F' | Out-Null
        Escribir-Log 'Contraseña generada: dejada en PRIMER-ACCESO.txt.'
    }
    Remove-Item Env:INST_ADMIN_USER, Env:INST_ADMIN_PASS -ErrorAction SilentlyContinue

    # --- 5. Servicio del panel (WinSW) ---
    $carpetaServicio = Join-Path $instalacion 'servicio'
    $rutaXml = Join-Path $carpetaServicio 'USBMonitorPanel.xml'
    $xml = Get-Content -LiteralPath $rutaXml -Raw
    $xml = $xml -replace '__PUERTO__', "$puerto"
    $xml = $xml -replace '__REGISTROS__', (Join-Path $datos 'Registros')
    Set-Content -LiteralPath $rutaXml -Value $xml -Encoding UTF8

    $servicioPanel = Get-Service -Name 'USBMonitorPanel' -ErrorAction SilentlyContinue
    if ($servicioPanel) {
        if ($servicioPanel.Status -eq 'Running') { Stop-Service -Name 'USBMonitorPanel' -Force }
    } else {
        & (Join-Path $carpetaServicio 'USBMonitorPanel.exe') install
        if ($LASTEXITCODE -ne 0) { throw "WinSW install falló ($LASTEXITCODE)" }
        Escribir-Log 'Servicio del panel instalado.'
    }

    # --- 6. Cortafuegos ---
    & netsh advfirewall firewall delete rule name='USB Monitor — Panel' 2>&1 | Out-Null
    if ($cortafuegos -eq '1') {
        & netsh advfirewall firewall add rule name='USB Monitor — Panel' dir=in action=allow `
            protocol=TCP localport=$puerto remoteip=localsubnet profile=private,domain | Out-Null
        Escribir-Log "Cortafuegos: puerto $puerto abierto a la subred local."
    }

    # --- 7. Arranque y comprobación ---
    Start-Service -Name 'USBMonitorPanel'
    Escribir-Log 'Servicio del panel arrancado.'
    $responde = $false
    for ($i = 0; $i -lt 45; $i++) {
        try {
            $r = Invoke-WebRequest -UseBasicParsing -Uri "http://127.0.0.1:$puerto/" `
                    -TimeoutSec 3 -MaximumRedirection 0 -ErrorAction Stop
            $responde = $true; break
        } catch {
            if ($_.Exception.Response) { $responde = $true; break }  # 302/401 = ya sirve
            Start-Sleep -Seconds 2
        }
    }
    if ($responde) { Escribir-Log "El panel responde en el puerto $puerto." }
    else { Escribir-Log "AVISO: el panel aún no responde; revisa Registros\USBMonitorPanel.*.log" }

    # --- 8. Copia de seguridad semanal de la BD ---
    # Si esto falla no debe tumbar la instalación: es un extra.
    try {
        $accionTarea = New-ScheduledTaskAction -Execute 'powershell.exe' `
            -Argument ('-NoProfile -ExecutionPolicy Bypass -File "' +
                       (Join-Path $instalacion 'scripts\Copia-BaseDatos.ps1') + '"')
        $disparoTarea = New-ScheduledTaskTrigger -Weekly -DaysOfWeek Sunday -At 03:00
        $principalTarea = New-ScheduledTaskPrincipal -UserId 'SYSTEM' `
            -LogonType ServiceAccount -RunLevel Highest
        Register-ScheduledTask -TaskName 'USB Monitor — Copia de la BD' `
            -Action $accionTarea -Trigger $disparoTarea -Principal $principalTarea `
            -Description 'Copia semanal de la base de datos de USB Monitor (pg_dump; conserva las 8 últimas en Datos\Copias).' `
            -Force | Out-Null
        Escribir-Log 'Tarea de copia semanal registrada (domingos 03:00).'
    } catch {
        Escribir-Log "AVISO: no se pudo registrar la tarea de copia semanal: $($_.Exception.Message)"
    }

    Escribir-Log 'Configuración terminada.'
    exit 0
} catch {
    try { Escribir-Log "ERROR: $($_.Exception.Message)" } catch { Write-Host "ERROR: $($_.Exception.Message)" }
    exit 1
}
