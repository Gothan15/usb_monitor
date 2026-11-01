# USB Monitor - Instalacion completa en una sola carpeta
# Compila los cuatro programas (si hace falta), los junta con el
# instalador en UNA carpeta y lo instala todo desde ahi: el servicio
# registrado desde esa carpeta y el companero con ella. Debe
# ejecutarse como Administrador.
#
# Uso:
#   .\Install-All.ps1
#   .\Install-All.ps1 -ServerHost 192.168.1.100 -AgentToken <token>
#   .\Install-All.ps1 -InstallPath "D:\USBMonitor" -SkipBuild

param(
    [string]$InstallPath = "C:\USBMonitor",
    [string]$ServerHost = "",
    [int]$ServerPort = 3000,
    [string]$AgentToken = "",
    [switch]$SkipBuild
)

$ErrorActionPreference = "Stop"
$root = $PSScriptRoot

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

# Los cuatro programas: su script de compilacion, el exe que produce
# y si es imprescindible (servicio y companero) o una herramienta
# auxiliar (visor y administracion: si fallan, se avisa y se sigue).
$Programs = @(
    @{ Build = "compilacion\build_usb_monitor_service_pyinstaller.ps1"; Exe = "dist\USBMonitorService.exe"; Required = $true;  Name = "servicio" },
    @{ Build = "compilacion\build_usb_prompt_pyinstaller.ps1";          Exe = "dist_usb_prompt\USBMonitorPrompt.exe"; Required = $true;  Name = "companero" },
    @{ Build = "compilacion\build_usb_serial_viewer_pyinstaller.ps1";   Exe = "dist_usb_serial_viewer\USBSerialViewer.exe"; Required = $false; Name = "visor de seriales" },
    @{ Build = "compilacion\build_usb_monitor_admin_pyinstaller.ps1";   Exe = "dist_usb_monitor_admin\USBMonitorAdmin.exe"; Required = $false; Name = "administracion" }
)

Write-Host "`n========================================" -ForegroundColor $Cyan
Write-Host "   USB Monitor - Instalacion completa   " -ForegroundColor $Cyan
Write-Host "========================================`n" -ForegroundColor $Cyan

if (-not (Test-Admin)) {
    Write-Status "Este script requiere permisos de Administrador" "ERROR"
    exit 1
}
Write-Status "Ejecutando como Administrador" "OK"

# ── 1. Compilar (salvo -SkipBuild) ─────────────────────────────────
if (-not $SkipBuild) {
    $pyOk = $false
    try {
        & python -m PyInstaller --version | Out-Null
        $pyOk = $?
    } catch { $pyOk = $false }
    if (-not $pyOk) {
        Write-Status "PyInstaller no esta disponible: ejecuta primero .\install_dependencies.ps1 (o pip install pyinstaller)" "ERROR"
        exit 1
    }
    foreach ($p in $Programs) {
        $buildScript = Join-Path $root $p.Build
        Write-Status "Compilando el $($p.Name)..." "INFO"
        & powershell -NoLogo -NoProfile -ExecutionPolicy Bypass -File $buildScript | Out-Host
        if ($LASTEXITCODE -ne 0) {
            if ($p.Required) {
                Write-Status "La compilacion del $($p.Name) fallo; no se puede instalar sin el" "ERROR"
                exit 1
            }
            Write-Status "La compilacion del $($p.Name) fallo; se sigue sin el (es auxiliar)" "INFO"
        }
    }
}

# ── 2. Comprobar los ejecutables ───────────────────────────────────
$toCopy = @()
foreach ($p in $Programs) {
    $exePath = Join-Path $root $p.Exe
    if (Test-Path $exePath) {
        $toCopy += $exePath
        Write-Status "Ejecutable listo: $($p.Exe)" "OK"
    } elseif ($p.Required) {
        Write-Status "Falta el ejecutable imprescindible $($p.Exe): compila antes o quita -SkipBuild" "ERROR"
        exit 1
    } else {
        Write-Status "Sin ejecutable del $($p.Name); se omite (auxiliar)" "INFO"
    }
}

# ── 3. Juntar todo en la carpeta de instalacion ────────────────────
if (-not (Test-Path $InstallPath)) {
    New-Item -ItemType Directory -Path $InstallPath -Force | Out-Null
}
Write-Status "Carpeta de instalacion: $InstallPath" "OK"

# Si el servicio ya corre desde esa carpeta, hay que pararlo antes
# de sobrescribir su ejecutable (Windows bloquea el archivo en uso).
$existing = Get-Service -Name "USBMonitorService" -ErrorAction SilentlyContinue
if ($existing -and $existing.Status -eq "Running") {
    Write-Status "Deteniendo el servicio actual para actualizar los archivos..." "INFO"
    Stop-Service -Name "USBMonitorService" -Force -ErrorAction SilentlyContinue
    Start-Sleep -Seconds 2
}

foreach ($file in $toCopy) {
    Copy-Item -Path $file -Destination $InstallPath -Force
}
Copy-Item -Path (Join-Path $root "Install-Service.ps1") -Destination $InstallPath -Force
Write-Status "Todo junto en $InstallPath (servicio, companero, herramientas e instalador)" "OK"

# ── 4. Instalar desde la carpeta final ─────────────────────────────
# Se invoca el Install-Service.ps1 COPIADO, en un proceso hijo: asi
# el servicio y la tarea del companero quedan registrados desde la
# carpeta definitiva, y un fallo suyo no se lleva este script por
# delante.
$installArgs = @(
    "-NoLogo", "-NoProfile", "-ExecutionPolicy", "Bypass",
    "-File", (Join-Path $InstallPath "Install-Service.ps1"),
    "-Action", "install",
    "-ServerPort", $ServerPort
)
if ($ServerHost) { $installArgs += @("-ServerHost", $ServerHost) }
if ($AgentToken) { $installArgs += @("-AgentToken", $AgentToken) }

Write-Status "Instalando el servicio desde $InstallPath..." "INFO"
& powershell @installArgs | Out-Host
if ($LASTEXITCODE -ne 0) {
    Write-Status "Install-Service.ps1 termino con error; revisa su salida" "ERROR"
    exit 1
}

Write-Host "`n========================================" -ForegroundColor $Green
Write-Host "   [OK] INSTALACION COMPLETA EN $InstallPath" -ForegroundColor $Green
Write-Host "========================================" -ForegroundColor $Green
Write-Host "`nContenido de la carpeta:" -ForegroundColor $Cyan
Get-ChildItem $InstallPath | ForEach-Object { Write-Host "  $($_.Name)" }
Write-Host "`nPara ver el estado: $InstallPath\Install-Service.ps1 -Action status" -ForegroundColor $Cyan
