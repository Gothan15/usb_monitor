# ================================================================
# USB Monitor — Panel · desinstalación de servicios
# ----------------------------------------------------------------
# Acción diferida del MSI al desinstalar (REMOVE="ALL", no en
# actualizaciones). Detiene y elimina los dos servicios y la regla
# de cortafuegos. La carpeta de DATOS (C:\ProgramData\USBMonitor
# con la base de datos y los secretos) NO se toca a propósito:
# para borrarla del todo, se elimina a mano tras desinstalar.
# (sc.exe con nombre completo: en PowerShell «sc» es un alias de
# Set-Content.)
# ================================================================
$ErrorActionPreference = 'Continue'

foreach ($servicio in @('USBMonitorPanel', 'USBMonitorPostgreSQL')) {
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
exit 0
