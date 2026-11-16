# ================================================================
# USB Monitor — Panel · instalación del Redis integrado
# ----------------------------------------------------------------
# Acción diferida del MSI (se ejecuta como SYSTEM), después de
# Instalar-BaseDatos y antes de Configurar-Panel. Lee su
# configuración de HKLM\SOFTWARE\USBMonitor\Panel, como los demás.
#
# Qué hace, de forma idempotente (vale igual para instalar y para
# actualizar):
#   1. Asegura la contraseña interna de Redis («redisClave») en el
#      mismo «secretos.json» de la base de datos: se genera una
#      sola vez y se reutiliza en las actualizaciones, conservando
#      las demás claves del archivo.
#   2. Genera «redis.conf» junto a los binarios con la receta
#      privada del panel: escucha SOLO en 127.0.0.1, puerto fijo
#      6381 (no es el 6379 de un Redis «de verdad»: así nunca choca
#      con uno que ya tenga el equipo, y por eso el asistente ni lo
#      pregunta), contraseña obligatoria y datos en
#      C:\ProgramData\USBMonitor\Redis.
#   3. Registra el servicio «USBMonitorRedis» (WinSW, arranque
#      automático) y lo arranca; si ya existía (actualización), lo
#      reinicia para que recoja los binarios y la configuración
#      nuevos.
#   4. Comprueba con redis-cli que responde PING con la contraseña.
#      Si no responde, lo deja anotado como AVISO y la instalación
#      sigue: el panel funciona sin Redis (presencia y límites
#      pasan a memoria), así que un Redis torpe no debe tumbar la
#      instalación entera. Los fallos de estructura (faltan los
#      binarios, no se puede escribir la configuración) sí paran.
# Todo queda registrado en Registros\instalacion.log.
# ================================================================
$ErrorActionPreference = 'Stop'

# Puerto fijo del Redis integrado (ver la cabecera, punto 2).
$PuertoRedis = 6381

function Escribir-Log([string]$Mensaje) {
    $linea = "[{0}] [Redis] {1}" -f (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'), $Mensaje
    Write-Host $linea
    try { Add-Content -LiteralPath $script:RutaLog -Value $linea -Encoding UTF8 } catch { }
}

function Nueva-Clave([int]$Longitud = 32) {
    # Solo alfanumérica: segura de interpolar en redis.conf y en la URL.
    $bytes = New-Object byte[] 48
    [System.Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($bytes)
    $texto = [Convert]::ToBase64String($bytes) -replace '[^a-zA-Z0-9]', ''
    return $texto.Substring(0, $Longitud)
}

# Las rutas dentro de redis.conf van con barras normales y entre
# comillas: es la forma que la compilación MSYS2 de Redis acepta
# sin discusión, también con espacios en la ruta.
function Ruta-Conf([string]$Ruta) {
    return '"' + ($Ruta -replace '\\', '/') + '"'
}

try {
    $reg = Get-ItemProperty -LiteralPath 'HKLM:\SOFTWARE\USBMonitor\Panel'
    $datos = [string]$reg.DataDir
    $instalacion = [string]$reg.InstallDir
    $script:RutaLog = Join-Path $datos 'Registros\instalacion.log'

    $redisDir = Join-Path $instalacion 'redis'
    $redisExe = Join-Path $redisDir 'redis-server.exe'
    $redisCli = Join-Path $redisDir 'redis-cli.exe'
    $datosRedis = Join-Path $datos 'Redis'
    if (-not (Test-Path -LiteralPath $redisExe)) {
        throw "No está el binario de Redis: $redisExe"
    }
    New-Item -ItemType Directory -Force -Path $datosRedis | Out-Null

    Escribir-Log "Inicio. Puerto Redis=$PuertoRedis, datos=$datosRedis"

    # --- 1. Contraseña interna (en el secretos.json compartido) ---
    $rutaSecretos = Join-Path $datos 'secretos.json'
    if (Test-Path -LiteralPath $rutaSecretos) {
        $secretos = Get-Content -LiteralPath $rutaSecretos -Raw | ConvertFrom-Json
    } else {
        # Normalmente lo crea antes Instalar-BaseDatos; si este
        # script corriera solo, el archivo nace con su clave y la
        # ACL cerrada, igual que allí.
        $secretos = [pscustomobject]@{}
        Escribir-Log 'secretos.json no existía: se crea con la clave de Redis.'
    }
    if (-not $secretos.PSObject.Properties['redisClave']) {
        $secretos | Add-Member -NotePropertyName redisClave -NotePropertyValue (Nueva-Clave)
        $secretos | ConvertTo-Json | Set-Content -LiteralPath $rutaSecretos -Encoding UTF8
        # ACL cerrada por SID (SYSTEM + Administradores), sin herencia.
        & icacls $rutaSecretos /inheritance:r /grant:r '*S-1-5-18:F' '*S-1-5-32-544:F' | Out-Null
        Escribir-Log 'Clave de Redis generada y guardada en secretos.json.'
    } else {
        Escribir-Log 'Clave de Redis existente reutilizada.'
    }
    $claveRedis = [string]$secretos.redisClave

    # --- 2. redis.conf generado ---
    $rutaConf = Join-Path $redisDir 'redis.conf'
    @(
        "# Generado por el instalador de USB Monitor — Panel ($(Get-Date -Format 'yyyy-MM-dd'))"
        "# Redis privado del panel: no editar a mano (se regenera en"
        "# cada instalación/actualización; la contraseña sale de"
        "# C:\ProgramData\USBMonitor\secretos.json, clave redisClave)."
        "bind 127.0.0.1"
        "protected-mode yes"
        "port $PuertoRedis"
        "requirepass $claveRedis"
        "dir $(Ruta-Conf $datosRedis)"
        'dbfilename dump.rdb'
        "logfile $(Ruta-Conf (Join-Path $datos 'Registros\redis.log'))"
        "# Los datos son presencia de agentes, límites de intentos y"
        "# ajustes: poca cosa. El tope es un seguro, no un objetivo."
        "maxmemory 256mb"
    ) | Set-Content -LiteralPath $rutaConf -Encoding ASCII
    Escribir-Log 'redis.conf generado.'

    # --- 3. Servicio (WinSW) ---
    $carpetaServicio = Join-Path $instalacion 'servicio'
    $rutaXml = Join-Path $carpetaServicio 'USBMonitorRedis.xml'
    $xml = Get-Content -LiteralPath $rutaXml -Raw
    $xml = $xml -replace '__REGISTROS__', (Join-Path $datos 'Registros')
    Set-Content -LiteralPath $rutaXml -Value $xml -Encoding UTF8

    $nombreServicio = 'USBMonitorRedis'
    $servicio = Get-Service -Name $nombreServicio -ErrorAction SilentlyContinue
    if (-not $servicio) {
        & (Join-Path $carpetaServicio 'USBMonitorRedis.exe') install
        if ($LASTEXITCODE -ne 0) { throw "WinSW install de Redis falló ($LASTEXITCODE)" }
        Escribir-Log "Servicio $nombreServicio registrado."
        $servicio = Get-Service -Name $nombreServicio
    } elseif ($servicio.Status -eq 'Running') {
        # Actualización: reiniciar para recoger binarios y conf nuevos.
        Stop-Service -Name $nombreServicio -Force
        $servicio.WaitForStatus('Stopped', [TimeSpan]::FromSeconds(30))
        Escribir-Log 'Servicio de Redis detenido para actualizar.'
    }

    if ($servicio.Status -ne 'Running') {
        Start-Service -Name $nombreServicio
        Escribir-Log 'Servicio de Redis arrancado.'
    }

    # --- 4. Comprobación (PING con la contraseña) ---
    $responde = $false
    for ($i = 0; $i -lt 15; $i++) {
        $salida = & $redisCli -h 127.0.0.1 -p $PuertoRedis -a $claveRedis --no-auth-warning PING 2>$null
        if ($salida -eq 'PONG') { $responde = $true; break }
        Start-Sleep -Seconds 2
    }
    if ($responde) {
        Escribir-Log "Redis responde en 127.0.0.1:$PuertoRedis."
    } else {
        Escribir-Log "AVISO: Redis no respondió al PING; el panel funcionará sin él (revisa Registros\redis.log y Registros\USBMonitorRedis.*.log)."
    }

    Escribir-Log 'Redis listo.'
    exit 0
} catch {
    try { Escribir-Log "ERROR: $($_.Exception.Message)" } catch { Write-Host "ERROR: $($_.Exception.Message)" }
    exit 1
}
