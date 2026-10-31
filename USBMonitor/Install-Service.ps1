# USB Monitor Service - Script de Instalacion Automatica
# Debe ejecutarse como Administrador

param(
    [string]$Action = "install",
    [string]$ServerHost = "172.20.10.12",
    [int]$ServerPort = 3000,
    [string]$LogPath = "C:\ProgramData\USBMonitor",
    [string]$AgentToken = ""
)

# Colores para la consola
$Green = [ConsoleColor]::Green
$Red = [ConsoleColor]::Red
$Yellow = [ConsoleColor]::Yellow
$Cyan = [ConsoleColor]::Cyan

function Write-Status {
    param($Message, $Status)
    
    $color = if ($Status -eq "OK") { $Green } elseif ($Status -eq "ERROR") { $Red } else { $Yellow }
    $symbol = if ($Status -eq "OK") { "[OK]" } elseif ($Status -eq "ERROR") { "[X]" } else { "[>]" }
    
    Write-Host "$symbol " -ForegroundColor $color -NoNewline
    Write-Host $Message
}

function Test-Admin {
    $currentUser = [Security.Principal.WindowsIdentity]::GetCurrent()
    $principal = New-Object Security.Principal.WindowsPrincipal($currentUser)
    return $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
}

function Initialize-LogDirectory {
    if (-not (Test-Path $LogPath)) {
        Write-Status "Creando directorio de logs: $LogPath" "INFO"
        New-Item -ItemType Directory -Path $LogPath -Force | Out-Null
        Write-Status "Directorio creado" "OK"
    } else {
        Write-Status "Directorio de logs ya existe" "OK"
    }
}

function Set-ServiceRecovery {
    # Recuperación automática del servicio (Fase 0): si el servicio se
    # cae, Windows lo reinicia al minuto, hasta 3 veces, y el contador
    # de fallos se reinicia cada 24 horas. Tolerante a fallos: un error
    # aquí NO debe abortar la instalación.
    try {
        & sc.exe failure USBMonitorService "reset=" "86400" "actions=" "restart/60000/restart/60000/restart/60000" | Out-Null
        if ($?) {
            Write-Status "Recuperación automática del servicio configurada (reinicio al minuto)" "OK"
        } else {
            Write-Status "No se pudo configurar la recuperación automática del servicio" "INFO"
        }
    } catch {
        Write-Status "No se pudo configurar la recuperación automática: $_" "INFO"
    }
}

function Set-AgentToken {
    # Token por equipo (Fase 3): si la instalación remota pasa
    # -AgentToken, queda en la variable de MÁQUINA
    # USB_MONITOR_AGENT_TOKEN y el agente se autentica ante el servidor
    # con "Authorization: AgentToken <token>" (el servidor solo guarda
    # su hash). Sin parámetro no se toca nada: las instalaciones
    # anteriores siguen autenticándose con su API key.
    # Tolerante a fallos: un error aquí NO debe abortar la instalación.
    if (-not $AgentToken) {
        Write-Status "Sin -AgentToken: el agente seguirá autenticándose con su API key" "INFO"
        return
    }
    try {
        [Environment]::SetEnvironmentVariable("USB_MONITOR_AGENT_TOKEN", $AgentToken, "Machine")
        Write-Status "Variable de entorno: USB_MONITOR_AGENT_TOKEN = (configurado)" "OK"
    } catch {
        Write-Status "No se pudo guardar USB_MONITOR_AGENT_TOKEN: $_" "INFO"
    }
}

function Install-Companion {
    # Proceso compañero (Fase 1): pide la contraseña en la sesión del
    # usuario (el servicio, en sesión 0, no puede mostrar ventanas).
    # Se registra una tarea programada "USBMonitorPrompt" al iniciar
    # sesión con el ejecutable del compañero junto al servicio; si el
    # .exe no existe, se usa pythonw/python sobre usb_prompt.py. Si
    # schtasks falla, se deja una clave Run de HKLM como respaldo.
    # Tolerante a fallos: un error aquí NO debe abortar la instalación.
    $exeDir = Split-Path -Parent $PSCommandPath
    $promptExe = Join-Path $exeDir "USBMonitorPrompt.exe"
    $promptScript = Join-Path $exeDir "usb_prompt.py"

    $promptCommand = $null
    if (Test-Path $promptExe) {
        $promptCommand = "`"$promptExe`""
    } elseif (Test-Path $promptScript) {
        $pythonw = Get-Command pythonw.exe -ErrorAction SilentlyContinue
        if (-not $pythonw) { $pythonw = Get-Command python.exe -ErrorAction SilentlyContinue }
        if ($pythonw) {
            $promptCommand = "`"$($pythonw.Source)`" `"$promptScript`""
        }
    }

    if (-not $promptCommand) {
        Write-Status "Compañero (USBMonitorPrompt) no encontrado junto al instalador; se omite su registro" "INFO"
        return
    }

    $taskOk = $false
    try {
        & schtasks.exe /create /tn "USBMonitorPrompt" /sc onlogon /tr $promptCommand /f | Out-Null
        $taskOk = $?
    } catch {
        $taskOk = $false
    }

    if ($taskOk) {
        Write-Status "Compañero registrado: tarea programada USBMonitorPrompt (al iniciar sesión)" "OK"
    } else {
        Write-Status "schtasks falló; registrando el compañero en la clave Run de HKLM como respaldo" "INFO"
        try {
            New-ItemProperty -Path "HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Run" -Name "USBMonitorPrompt" -Value $promptCommand -PropertyType String -Force | Out-Null
            Write-Status "Compañero registrado en HKLM Run" "OK"
        } catch {
            Write-Status "No se pudo registrar el compañero: $_" "INFO"
        }
    }
}

function Install-Service {
    Write-Host "`n========================================" -ForegroundColor $Cyan
    Write-Host "     Instalando USB Monitor Service     " -ForegroundColor $Cyan
    Write-Host "========================================`n" -ForegroundColor $Cyan
    
    # Verificar permisos
    if (-not (Test-Admin)) {
        Write-Status "Este script requiere permisos de Administrador" "ERROR"
        exit 1
    }
    
    Write-Status "Ejecutando como Administrador" "OK"
    
    # Obtener ruta del ejecutable
    $exePath = Split-Path -Parent $PSCommandPath
    $servicePath = Join-Path $exePath "USBMonitorService.exe"
    
    if (-not (Test-Path $servicePath)) {
        Write-Status "No se encontro el ejecutable en: $servicePath" "ERROR"
        exit 1
    }
    
    Write-Status "Ejecutable encontrado: $servicePath" "OK"
    
    # Crear directorio de logs
    Initialize-LogDirectory
    
    # Configurar variables de entorno
    Write-Host "`n[>] Configurando variables de entorno..." -ForegroundColor $Yellow
    
    $envVars = @{
        "USB_MONITOR_SERVER_HOST" = $ServerHost
        "USB_MONITOR_SERVER_PORT" = $ServerPort
        "USB_MONITOR_LOG_PATH" = $LogPath
        "USB_MONITOR_ENDPOINT" = "/api/usb-event"
        "USB_MONITOR_LISTEN_PORT" = "5001"
    }
    
    foreach ($var in $envVars.GetEnumerator()) {
        [Environment]::SetEnvironmentVariable($var.Key, $var.Value, "Machine")
        Write-Status "Variable de entorno: $($var.Key) = $($var.Value)" "OK"
    }
    
    # Instalar servicio
    Write-Host "`n[>] Instalando servicio Windows..." -ForegroundColor $Yellow
    & $servicePath install
    
    if ($?) {
        Write-Status "Servicio instalado correctamente" "OK"
    } else {
        Write-Status "Error al instalar el servicio" "ERROR"
        exit 1
    }

    # Recuperación automática del servicio (Fase 0), token por equipo
    # (Fase 3, solo si viene -AgentToken) y registro del proceso
    # compañero que pide la contraseña (Fase 1)
    Set-ServiceRecovery
    Set-AgentToken
    Install-Companion

    # Iniciar servicio
    Write-Host "`n[>] Iniciando servicio..." -ForegroundColor $Yellow
    & $servicePath start
    
    Start-Sleep -Seconds 2
    
    $service = Get-Service -Name "USBMonitorService" -ErrorAction SilentlyContinue
    if ($service -and $service.Status -eq "Running") {
        Write-Status "Servicio iniciado correctamente" "OK"
    } else {
        Write-Status "Error al iniciar el servicio" "ERROR"
        exit 1
    }
    
    Write-Host "`n========================================" -ForegroundColor $Green
    Write-Host "     [OK] INSTALACION COMPLETADA        " -ForegroundColor $Green
    Write-Host "========================================" -ForegroundColor $Green
    
    Write-Host "`n[i] Informacion del servicio:" -ForegroundColor $Cyan
    Write-Host "  Ejecutable: $servicePath"
    Write-Host "  Logs: $LogPath"
    Write-Host "  Servidor: $ServerHost`:$ServerPort"
    Write-Host "`n[i] Proximos pasos:" -ForegroundColor $Cyan
    Write-Host "  1. Verifica los logs: Get-Content '$LogPath\usb_monitor_service.log' -Wait -Tail 30"
    Write-Host "  2. Prueba insertando una USB autorizada"
    Write-Host "  3. Verifica que el servicio permanezca activo"
}

function Uninstall-Service {
    Write-Host "`n========================================" -ForegroundColor $Red
    Write-Host "    Desinstalando USB Monitor Service   " -ForegroundColor $Red
    Write-Host "========================================`n" -ForegroundColor $Red
    
    if (-not (Test-Admin)) {
        Write-Status "Este script requiere permisos de Administrador" "ERROR"
        exit 1
    }
    
    $exePath = Split-Path -Parent $PSCommandPath
    $servicePath = Join-Path $exePath "USBMonitorService.exe"
    
    Write-Status "Deteniendo servicio..." "INFO"
    & $servicePath stop 2>$null
    Start-Sleep -Seconds 1
    
    Write-Status "Desinstalando servicio..." "INFO"
    & $servicePath remove 2>$null
    
    Start-Sleep -Seconds 1
    
    $service = Get-Service -Name "USBMonitorService" -ErrorAction SilentlyContinue
    if (-not $service) {
        Write-Status "Servicio desinstalado correctamente" "OK"
        Write-Host "`n[OK] El servicio ha sido removido de Windows" -ForegroundColor $Green
    } else {
        Write-Status "Error al desinstalar el servicio" "ERROR"
        exit 1
    }
}

function Restart-Service {
    Write-Host "`n[>] Reiniciando servicio..." -ForegroundColor $Yellow
    
    $exePath = Split-Path -Parent $PSCommandPath
    $servicePath = Join-Path $exePath "USBMonitorService.exe"
    
    & $servicePath stop
    Start-Sleep -Seconds 2
    & $servicePath start
    
    Start-Sleep -Seconds 1
    
    $service = Get-Service -Name "USBMonitorService" -ErrorAction SilentlyContinue
    if ($service -and $service.Status -eq "Running") {
        Write-Status "Servicio reiniciado correctamente" "OK"
    } else {
        Write-Status "Error al reiniciar el servicio" "ERROR"
    }
}

function Show-Status {
    Write-Host "`n========================================" -ForegroundColor $Cyan
    Write-Host "      Estado del USB Monitor Service    " -ForegroundColor $Cyan
    Write-Host "========================================`n" -ForegroundColor $Cyan
    
    $service = Get-Service -Name "USBMonitorService" -ErrorAction SilentlyContinue
    
    if ($service) {
        Write-Status "Servicio encontrado" "OK"
        $statusLabel = if ($service.Status -eq "Running") { "OK" } else { "ERROR" }
        Write-Status "Estado: $($service.Status)" $statusLabel
        Write-Status "Tipo de inicio: $($service.StartType)" "OK"
        
        Write-Host "`n[i] Variables de entorno configuradas:" -ForegroundColor $Cyan
        Get-ChildItem Env:USB_MONITOR* | ForEach-Object {
            Write-Host "  $($_.Name) = $($_.Value)"
        }
        
        Write-Host "`n[i] Ultimas lineas del log:" -ForegroundColor $Cyan
        $logPath = [Environment]::GetEnvironmentVariable("USB_MONITOR_LOG_PATH", "Machine")
        if (-not $logPath) { $logPath = $LogPath }
        $logFile = Join-Path $logPath "usb_monitor_service.log"
        
        if (Test-Path $logFile) {
            Get-Content $logFile -Tail 5 | ForEach-Object { Write-Host "  $_" }
        } else {
            Write-Status "Archivo de log no encontrado" "ERROR"
        }
    } else {
        Write-Status "Servicio no esta instalado" "ERROR"
    }
}

function Show-Logs {
    param([int]$Lines = 50)
    
    $logPath = [Environment]::GetEnvironmentVariable("USB_MONITOR_LOG_PATH", "Machine")
    if (-not $logPath) { $logPath = $LogPath }
    $logFile = Join-Path $logPath "usb_monitor_service.log"
    
    if (Test-Path $logFile) {
        Write-Host "`n========================================" -ForegroundColor $Cyan
        Write-Host "      Ultimas $Lines lineas del log      " -ForegroundColor $Cyan
        Write-Host "========================================`n" -ForegroundColor $Cyan
        
        Get-Content $logFile -Tail $Lines | ForEach-Object {
            if ($_ -match "ERROR") {
                Write-Host $_ -ForegroundColor $Red
            } elseif ($_ -match "WARNING") {
                Write-Host $_ -ForegroundColor $Yellow
            } elseif ($_ -match "\[OK\]") {
                Write-Host $_ -ForegroundColor $Green
            } else {
                Write-Host $_
            }
        }
    } else {
        Write-Status "Archivo de log no encontrado en: $logFile" "ERROR"
    }
}

# Main
switch ($Action.ToLower()) {
    "install" {
        Install-Service
    }
    "uninstall" {
        Uninstall-Service
    }
    "restart" {
        Restart-Service
    }
    "status" {
        Show-Status
    }
    "logs" {
        Show-Logs
    }
    default {
        Write-Host @"
================================================================
       USB Monitor Service - Script de Instalacion
================================================================

Uso: .\Install-Service.ps1 -Action <accion> [opciones]

Acciones disponibles:
  install      - Instala y inicia el servicio (por defecto)
  uninstall    - Desinstala el servicio
  restart      - Reinicia el servicio
  status       - Muestra el estado del servicio
  logs         - Muestra las ultimas lineas del log

Opciones:
  -ServerHost   - Host del servidor backend (defecto: 172.20.10.12)
  -ServerPort   - Puerto del servidor backend (defecto: 3000)
  -LogPath      - Ruta para los logs (defecto: C:\ProgramData\USBMonitor)
  -AgentToken   - Token por equipo para autenticar al agente ante el
                  servidor (opcional; sin él se usa la API key de siempre)

Ejemplos:
  .\Install-Service.ps1 -Action install
  .\Install-Service.ps1 -Action install -ServerHost 192.168.1.100
  .\Install-Service.ps1 -Action status
  .\Install-Service.ps1 -Action logs
  .\Install-Service.ps1 -Action uninstall

NOTA: Debe ejecutarse como Administrador

"@
    }
}
