# USB Monitor v2 - Instalador del agente
#
# Instala el servicio en C:\USBMonitor (o -InstallDir), deja el
# companero al iniciar sesion y arranca el servicio con
# recuperacion automatica.
#
# Uso:
#   .\Install-Service.ps1 [-ServerHost 192.168.1.10] [-ServerPort 3000]
#   .\Install-Service.ps1 -Uninstall
#
# Al desinstalar, PRIMERO se ejecuta la restauracion del agente
# (reactiva los dispositivos que haya deshabilitado) y solo despues
# se quita el servicio: la maquina queda como estaba (sin huella).
#
# Credencial: la unica del agente es el token propio del equipo.
# Lo genera un administrador en el panel (Equipos > Token del
# agente) o la instalacion remota; pasalo con -AgentToken o
# guardalo despues en la caja de herramientas
# (USBMonitorService.exe gui).

param(
    [string]$ServerHost = "localhost",
    [int]$ServerPort = 3000,
    [string]$AgentToken = "",
    [string]$InstallDir = "C:\USBMonitor",
    [switch]$Uninstall
)

$ErrorActionPreference = "Stop"
$serviceName = "USBMonitorService"
$serviceExe = Join-Path $InstallDir "USBMonitorService.exe"
$taskName = "USBMonitorCompanero"

function Assert-Admin {
    $identity = [Security.Principal.WindowsIdentity]::GetCurrent()
    $principal = New-Object Security.Principal.WindowsPrincipal($identity)
    if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
        throw "Ejecuta este script como administrador."
    }
}

function Find-BuiltExe($name, $distFolder) {
    $candidates = @(
        (Join-Path $PSScriptRoot $name),
        (Join-Path (Join-Path $PSScriptRoot $distFolder) $name),
        (Join-Path (Join-Path (Split-Path -Parent $PSScriptRoot) $distFolder) $name)
    )
    foreach ($c in $candidates) { if (Test-Path $c) { return $c } }
    throw "No se encontro $name. Compila primero con compilacion\Build-All.ps1."
}

Assert-Admin

if ($Uninstall) {
    Write-Host "Restaurando dispositivos antes de desinstalar..." -ForegroundColor Cyan
    if (Test-Path $serviceExe) {
        try {
            $svc = Get-Service $serviceName -ErrorAction SilentlyContinue
            if ($svc -and $svc.Status -ne "Stopped") {
                Stop-Service $serviceName -Force -ErrorAction SilentlyContinue
                Start-Sleep -Seconds 2
            }
        } catch { }
        # La propia parada del servicio ya restaura; esto cubre el
        # caso de un servicio que no llego a parar limpiamente.
        & $serviceExe restaurar | Out-Host
    }
    try { & $serviceExe remove | Out-Null } catch { }
    try { Unregister-ScheduledTask -TaskName $taskName -Confirm:$false -ErrorAction SilentlyContinue } catch { }
    Write-Host "Servicio desinstalado y sistema restaurado." -ForegroundColor Green
    Write-Host "La carpeta $InstallDir se conserva; borrala a mano si no la necesitas."
    return
}

Write-Host "Instalando el agente USBMonitor v2 en $InstallDir..." -ForegroundColor Cyan
$srcService = Find-BuiltExe "USBMonitorService.exe" "dist"

$existing = Get-Service $serviceName -ErrorAction SilentlyContinue
if ($existing) {
    if ($existing.Status -ne "Stopped") { Stop-Service $serviceName -Force }
    & $serviceExe remove | Out-Null
    Start-Sleep -Seconds 1
}

New-Item -ItemType Directory -Path $InstallDir -Force | Out-Null
Copy-Item $srcService -Destination $serviceExe -Force

$cfg = @{
    serverHost   = $ServerHost
    serverPort   = $ServerPort
    serverScheme = "http"
}
if ($AgentToken) { $cfg.agentToken = $AgentToken }
$cfg | ConvertTo-Json | Set-Content -Path (Join-Path $InstallDir "server.json") -Encoding UTF8
Write-Host "server.json escrito (host $ServerHost, puerto $ServerPort)."
if (-not $AgentToken) {
    Write-Host "Sin credencial: genera el token en el panel (Equipos > Token del agente) y guardalo en USBMonitorService.exe gui." -ForegroundColor Yellow
}

& $serviceExe install --startup auto | Out-Null
& sc.exe failure $serviceName reset= 86400 actions= restart/60000/restart/60000/restart/60000 | Out-Null

# El companero es el mismo ejecutable en modo prompt.
$action = New-ScheduledTaskAction -Execute $serviceExe -Argument "prompt"
$trigger = New-ScheduledTaskTrigger -AtLogOn
$principalTask = New-ScheduledTaskPrincipal -GroupId "S-1-5-32-545" -RunLevel Limited
Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $trigger -Principal $principalTask -Force | Out-Null

Start-Service $serviceName
Write-Host "`nServicio instalado y en marcha." -ForegroundColor Green
