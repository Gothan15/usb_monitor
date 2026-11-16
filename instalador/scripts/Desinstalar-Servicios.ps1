# ================================================================
# USB Monitor — Panel · desinstalación de servicios
# ----------------------------------------------------------------
# Lo llama el desinstalador de Inno Setup antes de quitar los
# archivos (nunca en una actualización, que no desinstala).
# Quita TODO lo que el instalador crea: detiene y elimina los
# tres servicios, la regla de cortafuegos, la tarea de la copia
# semanal y la carpeta de DATOS entera (C:\ProgramData\USBMonitor
# con el clúster, los secretos y los datos de Redis) con su
# registro espejo. Desinstalar es empezar de cero; la clave del
# registro la retira el propio desinstalador justo después.
# (sc.exe con nombre completo: en PowerShell «sc» es un alias de
# Set-Content.)
# ================================================================
$ErrorActionPreference = 'Continue'

foreach ($servicio in @('USBMonitorPanel', 'USBMonitorRedis', 'USBMonitorPostgreSQL')) {
    $s = Get-Service -Name $servicio -ErrorAction SilentlyContinue
    if ($s) {
        if ($s.Status -eq 'Running') {
            & sc.exe stop $servicio | Out-Null
            Start-Sleep -Seconds 3
        }
        & sc.exe delete $servicio | Out-Null
        Write-Host "Servicio $servicio eliminado."
    }
}
& netsh advfirewall firewall delete rule name='USB Monitor — Panel' 2>&1 | Out-Null
Unregister-ScheduledTask -TaskName 'USB Monitor — Copia de la BD' -Confirm:$false `
    -ErrorAction SilentlyContinue

# --- Los datos también: desinstalar es empezar de cero ---
# La carpeta de datos se conservaba a propósito hasta la 1.5.2;
# ahora se borra entera, con el clúster de PostgreSQL, los
# secretos, los datos de Redis, los registros y las copias. La
# ruta sale del registro (aún presente: la clave se retira
# después de este script), con la estándar como reserva.
$datos = $null
try {
    $reg = Get-ItemProperty -LiteralPath 'HKLM:\SOFTWARE\USBMonitor\Panel' -ErrorAction Stop
    $datos = [string]$reg.DataDir
} catch { }
$esperada = Join-Path ([Environment]::GetFolderPath('CommonApplicationData')) 'USBMonitor'
if (-not $datos) { $datos = $esperada }
# Candado: solo se borra la carpeta esperada, la «USBMonitor»
# que cuelga de ProgramData. Cualquier otra ruta que dijera el
# registro se ignora: jamás se borra a ciegas lo que diga un valor.
if ([IO.Path]::GetFullPath($datos).TrimEnd('\') -ieq [IO.Path]::GetFullPath($esperada).TrimEnd('\')) {
    # Los servicios ya están parados y borrados arriba, pero
    # PostgreSQL puede tardar unos segundos en soltar los
    # archivos del clúster: se reintenta antes de rendirse.
    for ($intento = 1; $intento -le 5; $intento++) {
        try {
            Remove-Item -LiteralPath $datos -Recurse -Force -ErrorAction Stop
            break
        } catch {
            if ($intento -eq 5) {
                Write-Host "No se pudo borrar la carpeta de datos: $datos"
            } else {
                Start-Sleep -Seconds 2
            }
        }
    }
    if (Test-Path -LiteralPath $datos) {
        Write-Host "La carpeta de datos no se borró del todo: $datos"
    } else {
        Write-Host "Carpeta de datos eliminada: $datos"
    }
    # El registro espejo de la instalación vive suelto en
    # ProgramData, fuera de la carpeta: también lo crea el
    # instalador y también se va.
    $espejo = Join-Path (Split-Path $datos -Parent) 'USBMonitor-instalacion.log'
    Remove-Item -LiteralPath $espejo -Force -ErrorAction SilentlyContinue
}
exit 0
