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
#      anterior, solo refresca el puerto y la URL del Redis
#      integrado: los secretos se conservan).
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
    # Espejo FUERA del árbol de datos: si la instalación falla, la
    # reversión se lleva las carpetas que el MSI creó (Registros\
    # entre ellas) y con ellas el registro de arriba. Este archivo
    # vive suelto en C:\ProgramData, que el instalador no gestiona,
    # y es el que hay que mirar (o enviar) cuando algo sale mal.
    try { Add-Content -LiteralPath $script:RutaLogEspejo -Value $linea -Encoding UTF8 } catch { }
}

function Nueva-Clave([int]$Longitud = 24) {
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
    Escribir-Log 'Arranque del script del panel.'

    $reg = Get-ItemProperty -LiteralPath 'HKLM:\SOFTWARE\USBMonitor\Panel'
    $puerto = [int]$reg.PanelPort
    $puertoBd = [int]$reg.PgPort
    $cortafuegos = [string]$reg.FirewallOk
    $instalacion = [string]$reg.InstallDir
    $datos = [string]$reg.DataDir
    New-Item -ItemType Directory -Force -Path (Join-Path $datos 'Registros') | Out-Null
    $script:RutaLog = Join-Path $datos 'Registros\instalacion.log'
    $script:RutaLogEspejo = Join-Path (Split-Path $datos -Parent) 'USBMonitor-instalacion.log'

    $app = Join-Path $instalacion 'app'
    $nodo = Join-Path $instalacion 'node\node.exe'
    $secretos = Get-Content -LiteralPath (Join-Path $datos 'secretos.json') -Raw | ConvertFrom-Json
    $urlBd = "postgresql://usbmonitor:$($secretos.appClave)@127.0.0.1:$puertoBd/usbmonitor"

    Escribir-Log "Inicio. Puerto panel=$puerto, BD=$puertoBd, Redis=6381"
    Escribir-Log "Ejecutando como $([System.Security.Principal.WindowsIdentity]::GetCurrent().Name); instalacion=$instalacion"

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
        # El Redis integrado puede ser nuevo para esta instalación
        # (un .env anterior a él no trae la línea): se añade o se
        # refresca con la clave vigente de secretos.json, que
        # Instalar-Redis.ps1 ya dejó asegurada antes de este paso.
        $urlRedis = "redis://:$($secretos.redisClave)@127.0.0.1:6381"
        $contenido = $contenido -replace '^REDIS_URL=.*', "REDIS_URL=$urlRedis"
        if (-not ($contenido -match '^REDIS_URL=')) { $contenido += "REDIS_URL=$urlRedis" }
        Set-Content -LiteralPath $rutaEnv -Value $contenido -Encoding UTF8
        Escribir-Log '.env existente conservado (se refrescaron el puerto y la URL de Redis).'
    } else {
        $nombrePc = $env:COMPUTERNAME
        $ipLan = Get-NetIPAddress -AddressFamily IPv4 -ErrorAction SilentlyContinue |
            Where-Object { $_.IPAddress -notlike '127.*' -and $_.IPAddress -notlike '169.254.*' } |
            Select-Object -First 1 -ExpandProperty IPAddress
        $origenes = @("http://localhost:$puerto", "http://127.0.0.1:$puerto", "http://${nombrePc}:$puerto")
        if ($ipLan) { $origenes += "http://${ipLan}:$puerto" }
        # El secreto de sesión: 32 bytes al azar en hexadecimal.
        # OJO: nada de RandomNumberGenerator.GetBytes() estático ni
        # de [Convert]::ToHexString — son de .NET moderno y en
        # PowerShell 5.1 (.NET Framework) NO existen: el script
        # moría aquí en la primera instalación real (2026-11-16).
        # La vía compatible con los dos es la de Nueva-Clave:
        # Create().GetBytes() sobre un array + BitConverter.
        $bytesSecreto = New-Object byte[] 32
        [System.Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($bytesSecreto)
        $secretoSesion = ([BitConverter]::ToString($bytesSecreto) -replace '-', '').ToLower()
        @(
            "# Generado por el instalador de USB Monitor — Panel ($(Get-Date -Format 'yyyy-MM-dd'))"
            "DATABASE_URL=$urlBd"
            "PORT=$puerto"
            "APP_PUBLIC_HOST=$nombrePc"
            "ALLOWED_ORIGINS=$($origenes -join ',')"
            "ENFORCE_HTTPS_REDIRECT=false"
            "SESSION_SECRET=$secretoSesion"
            "REDIS_URL=redis://:$($secretos.redisClave)@127.0.0.1:6381"
        ) | Set-Content -LiteralPath $rutaEnv -Encoding UTF8
        & icacls $rutaEnv /inheritance:r /grant:r '*S-1-5-18:F' '*S-1-5-32-544:F' | Out-Null
        Escribir-Log '.env creado y protegido.'
    }

    # --- 3. Esquema de la base de datos ---
    # La salida de Prisma va ENTERA al registro: si el push falla,
    # su texto (no solo el código de salida) es la causa raíz.
    # El instalador es FULL OFFLINE: Prisma intenta de normal una
    # llamada de telemetría/comprobación de versión al arrancar, y
    # en un equipo sin internet eso es demora (o un susto en el
    # registro) sin beneficio. CHECKPOINT_DISABLE la apaga.
    $env:CHECKPOINT_DISABLE = '1'
    $env:PRISMA_HIDE_UPDATE_MESSAGE = '1'
    $env:DATABASE_URL = $urlBd
    # OJO con $ErrorActionPreference = 'Stop' y los comandos
    # nativos: en PowerShell 5.1, la PRIMERA línea que un programa
    # escribe por su salida de error se convierte en un error
    # terminante del script. Prisma escribe casi todo por ahí
    # (empezando por «Prisma schema loaded from...», que no es un
    # error): el paso moría al instante, Prisma ni trabajaba y el
    # registro se quedaba con esa línea como si fuera la causa
    # (instalación real, 2026-11-16). La misma trampa que el PING
    # de Instalar-Redis. Se baja a Continue SOLO durante la
    # llamada y el éxito lo decide el código de salida, como con
    # cualquier programa nativo.
    # Y la carpeta de trabajo tiene que ser la de la aplicación:
    # Prisma 7 busca su prisma.config.ts (donde vive la URL de la
    # base de datos) desde la carpeta actual, no desde la del
    # esquema. Sin esto, lanzado desde otra carpeta, Prisma no
    # encuentra su configuración y se niega: «The datasource.url
    # property is required in your Prisma config file» (le pasó a
    # la 1.5.5 lanzando el script desde fuera, 2026-11-16).
    $eapAntes = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    Push-Location $app
    try {
        $salidaPrisma = & $nodo (Join-Path $app 'node_modules\prisma\build\index.js') db push `
            --schema (Join-Path $app 'prisma\schema.prisma') 2>&1 | Out-String
    } finally {
        Pop-Location
        $ErrorActionPreference = $eapAntes
    }
    foreach ($lineaPrisma in ($salidaPrisma -split "`r?`n")) {
        # La decoración que PowerShell añade a cada línea de la
        # salida de error de un programa nativo (el «node.exe :»,
        # CategoryInfo, FullyQualifiedErrorId...) no aporta nada:
        # se registra la línea de Prisma, limpia.
        if ($lineaPrisma -match '^\S+\.exe : (.*)$') { $lineaPrisma = $Matches[1] }
        if ($lineaPrisma -match 'CategoryInfo|FullyQualifiedErrorId|RemoteException|^\s*\+|^\s*~+\s*$') { continue }
        if ($lineaPrisma.Trim()) { Escribir-Log "prisma: $lineaPrisma" }
    }
    if ($LASTEXITCODE -ne 0) { throw "prisma db push falló ($LASTEXITCODE)" }
    Escribir-Log 'Esquema aplicado (prisma db push).'

    # --- 4. Administrador inicial ---
    $env:INST_ADMIN_USER = $adminUsuario
    $env:INST_ADMIN_PASS = $adminClave
    # La misma protección que con Prisma: Node escribe sus avisos
    # por la salida de error y con 'Stop' matarían el paso.
    $eapAntes = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    try {
        $salidaAdmin = & $nodo (Join-Path $app 'crear-admin-instalador.mjs') 2>&1 | Out-String
    } finally {
        $ErrorActionPreference = $eapAntes
    }
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
        # Ídem: WinSW también puede avisar por la salida de error.
        $eapAntes = $ErrorActionPreference
        $ErrorActionPreference = 'Continue'
        try {
            $salidaWinSw = & (Join-Path $carpetaServicio 'USBMonitorPanel.exe') install 2>&1 | Out-String
        } finally {
            $ErrorActionPreference = $eapAntes
        }
        if ($salidaWinSw.Trim()) { Escribir-Log "WinSW (panel): $($salidaWinSw.Trim())" }
        if ($LASTEXITCODE -ne 0) { throw "WinSW install falló ($LASTEXITCODE)" }
        Escribir-Log 'Servicio del panel instalado.'
    }
    # Las dependencias también van en la plantilla de WinSW, pero en
    # una actualización el servicio ya existe y el XML nuevo no lo
    # reescribe: sin esto, un panel anterior al Redis integrado no
    # ganaría nunca la dependencia. OJO con cómo se fijan: NUNCA con
    # «sc.exe config ... 'depend= ...'» desde PowerShell — al ir el
    # argumento entre comillas, el espacio tras «depend=» cae DENTRO
    # del primer nombre (« USBMonitorPostgreSQL») y el SCM no lo
    # encuentra jamás: el servicio no arranca y da el error 1075,
    # «el servicio de dependencia no existe» (cazado en una
    # instalación real el 2026-11-16; lo delata el evento 7003, que
    # imprime el nombre con doble espacio tras «servicio:»). Se fija
    # por dos vías limpias: sc.exe a través de cmd (su forma clásica,
    # sin las comillas de PowerShell por medio; vale para el SCM en
    # vivo) y Set-ItemProperty sobre la clave del servicio (la lista
    # queda como REG_MULTI_SZ byte a byte; vale para el arranque).
    & cmd.exe /c 'sc.exe config USBMonitorPanel depend= USBMonitorPostgreSQL/USBMonitorRedis' | Out-Null
    $depsOk = ($LASTEXITCODE -eq 0)
    try {
        Set-ItemProperty 'HKLM:\SYSTEM\CurrentControlSet\Services\USBMonitorPanel' -Name DependOnService -Value ([string[]]@('USBMonitorPostgreSQL', 'USBMonitorRedis')) -ErrorAction Stop
    } catch { $depsOk = $false }
    if (-not $depsOk) { Escribir-Log 'AVISO: no se pudieron fijar las dependencias del servicio del panel.' }
    else { Escribir-Log 'Dependencias del servicio del panel fijadas (BD y Redis).' }

    # --- 6. Cortafuegos ---
    & netsh advfirewall firewall delete rule name='USB Monitor — Panel' 2>&1 | Out-Null
    if ($cortafuegos -eq '1') {
        & netsh advfirewall firewall add rule name='USB Monitor — Panel' dir=in action=allow `
            protocol=TCP localport=$puerto remoteip=localsubnet profile=private,domain | Out-Null
        Escribir-Log "Cortafuegos: puerto $puerto abierto a la subred local."
    }

    # --- 7. Arranque y comprobación ---
    Start-Service -Name 'USBMonitorPanel'
    $estadoPanel = (Get-Service -Name 'USBMonitorPanel').Status
    Escribir-Log "Servicio del panel arrancado (estado: $estadoPanel)."
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
