# USB Monitor Service - Script de Instalación Automática
# Debe ejecutarse como Administrador

param(
    [string]$Action = "install",
    [string]$ServerHost = "172.20.10.12",
    [int]$ServerPort = 3000,
    [string]$LogPath = "C:\ProgramData\USBMonitor"
)

# Colores para la consola
$Green = [ConsoleColor]::Green
$Red = [ConsoleColor]::Red
$Yellow = [ConsoleColor]::Yellow
$Cyan = [ConsoleColor]::Cyan

function Write-Status {
    param($Message, $Status)
    
    $color = if ($Status -eq "OK") { $Green } elseif ($Status -eq "ERROR") { $Red } else { $Yellow }
    $symbol = if ($Status -eq "OK") { "✓" } elseif ($Status -eq "ERROR") { "✗" } else { "→" }
    
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

function Install-Service {
    Write-Host "`n╔════════════════════════════════════════╗" -ForegroundColor $Cyan
    Write-Host "║     Instalando USB Monitor Service     ║" -ForegroundColor $Cyan
    Write-Host "╚════════════════════════════════════════╝`n" -ForegroundColor $Cyan
    
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
        Write-Status "No se encontró el ejecutable en: $servicePath" "ERROR"
        exit 1
    }
    
    Write-Status "Ejecutable encontrado: $servicePath" "OK"
    
    # Crear directorio de logs
    Initialize-LogDirectory
    
    # Configurar variables de entorno
    Write-Host "`n→ Configurando variables de entorno..." -ForegroundColor $Yellow
    
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
    Write-Host "`n→ Instalando servicio Windows..." -ForegroundColor $Yellow
    & $servicePath install
    
    if ($?) {
        Write-Status "Servicio instalado correctamente" "OK"
    } else {
        Write-Status "Error al instalar el servicio" "ERROR"
        exit 1
    }
    
    # Iniciar servicio
    Write-Host "`n→ Iniciando servicio..." -ForegroundColor $Yellow
    & $servicePath start
    
    Start-Sleep -Seconds 2
    
    $service = Get-Service -Name "USBMonitorService" -ErrorAction SilentlyContinue
    if ($service -and $service.Status -eq "Running") {
        Write-Status "Servicio iniciado correctamente" "OK"
    } else {
        Write-Status "Error al iniciar el servicio" "ERROR"
        exit 1
    }
    
    Write-Host "`n╔════════════════════════════════════════╗" -ForegroundColor $Green
    Write-Host "║        ✓ INSTALACIÓN COMPLETADA      ║" -ForegroundColor $Green
    Write-Host "╚════════════════════════════════════════╝" -ForegroundColor $Green
    
    Write-Host "`nℹ Información del servicio:" -ForegroundColor $Cyan
    Write-Host "  📁 Ejecutable: $servicePath"
    Write-Host "  📂 Logs: $LogPath"
    Write-Host "  🖥️  Servidor: $ServerHost`:$ServerPort"
    Write-Host "`nℹ Próximos pasos:" -ForegroundColor $Cyan
    Write-Host "  1. Verifica los logs: Get-Content '$LogPath\usb_monitor_service.log' -Wait -Tail 30"
    Write-Host "  2. Prueba insertando una USB autorizada"
    Write-Host "  3. Verifica que el servicio permanezca activo"
}

function Uninstall-Service {
    Write-Host "`n╔════════════════════════════════════════╗" -ForegroundColor $Red
    Write-Host "║    Desinstalando USB Monitor Service   ║" -ForegroundColor $Red
    Write-Host "╚════════════════════════════════════════╝`n" -ForegroundColor $Red
    
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
        Write-Host "`n✓ El servicio ha sido removido de Windows" -ForegroundColor $Green
    } else {
        Write-Status "Error al desinstalar el servicio" "ERROR"
        exit 1
    }
}

function Restart-Service {
    Write-Host "`n→ Reiniciando servicio..." -ForegroundColor $Yellow
    
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
    Write-Host "`n╔════════════════════════════════════════╗" -ForegroundColor $Cyan
    Write-Host "║      Estado del USB Monitor Service    ║" -ForegroundColor $Cyan
    Write-Host "╚════════════════════════════════════════╝`n" -ForegroundColor $Cyan
    
    $service = Get-Service -Name "USBMonitorService" -ErrorAction SilentlyContinue
    
    if ($service) {
        Write-Status "Servicio encontrado" "OK"
        Write-Status "Estado: $($service.Status)" if ($service.Status -eq "Running") { "OK" } else { "ERROR" }
        Write-Status "Tipo de inicio: $($service.StartType)" "OK"
        
        Write-Host "`nℹ Variables de entorno configuradas:" -ForegroundColor $Cyan
        Get-ChildItem Env:USB_MONITOR* | ForEach-Object {
            Write-Host "  $($_.Name) = $($_.Value)"
        }
        
        Write-Host "`nℹ Últimas líneas del log:" -ForegroundColor $Cyan
        $logPath = [Environment]::GetEnvironmentVariable("USB_MONITOR_LOG_PATH", "Machine")
        if (-not $logPath) { $logPath = $LogPath }
        $logFile = Join-Path $logPath "usb_monitor_service.log"
        
        if (Test-Path $logFile) {
            Get-Content $logFile -Tail 5 | ForEach-Object { Write-Host "  $_" }
        } else {
            Write-Status "Archivo de log no encontrado" "ERROR"
        }
    } else {
        Write-Status "Servicio no está instalado" "ERROR"
    }
}

function Show-Logs {
    param([int]$Lines = 50)
    
    $logPath = [Environment]::GetEnvironmentVariable("USB_MONITOR_LOG_PATH", "Machine")
    if (-not $logPath) { $logPath = $LogPath }
    $logFile = Join-Path $logPath "usb_monitor_service.log"
    
    if (Test-Path $logFile) {
        Write-Host "`n╔════════════════════════════════════════╗" -ForegroundColor $Cyan
        Write-Host "║           Últimas $Lines líneas del log             ║" -ForegroundColor $Cyan
        Write-Host "╚════════════════════════════════════════╝`n" -ForegroundColor $Cyan
        
        Get-Content $logFile -Tail $Lines | ForEach-Object {
            if ($_ -match "ERROR") {
                Write-Host $_ -ForegroundColor $Red
            } elseif ($_ -match "WARNING") {
                Write-Host $_ -ForegroundColor $Yellow
            } elseif ($_ -match "✓") {
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
╔════════════════════════════════════════════════════════════════╗
║       USB Monitor Service - Script de Instalación              ║
╚════════════════════════════════════════════════════════════════╝

Uso: .\Install-Service.ps1 -Action <acción> [opciones]

Acciones disponibles:
  install      - Instala y inicia el servicio (por defecto)
  uninstall    - Desinstala el servicio
  restart      - Reinicia el servicio
  status       - Muestra el estado del servicio
  logs         - Muestra las últimas líneas del log

Opciones:
  -ServerHost   - Host del servidor backend (defecto: 172.20.10.12)
  -ServerPort   - Puerto del servidor backend (defecto: 3000)
  -LogPath      - Ruta para los logs (defecto: C:\ProgramData\USBMonitor)

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
