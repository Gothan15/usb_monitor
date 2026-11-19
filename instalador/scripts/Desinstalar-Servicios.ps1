# ================================================================
# USB Monitor — Panel · desinstalación de servicios
# ----------------------------------------------------------------
# Lo llama el desinstalador de Inno Setup antes de quitar los
# archivos (nunca en una actualización, que no desinstala).
# Quita TODO lo que el instalador crea: cierra los procesos de
# usuario (la bandeja y la app de escritorio, que si no dejan
# sus .exe bloqueados), deshace el modo servidor dedicado si
# esta PC lo tenía, detiene y elimina los tres servicios, la
# regla de cortafuegos, la tarea de la copia semanal, los
# datos por usuario de %LOCALAPPDATA% y la carpeta de DATOS
# entera (C:\ProgramData\USBMonitor con el clúster, los
# secretos y los datos de Redis) con su registro espejo.
# Desinstalar es empezar de cero; la clave del registro la
# retira el propio desinstalador justo después.
# (sc.exe con nombre completo: en PowerShell «sc» es un alias de
# Set-Content.)
# ================================================================
$ErrorActionPreference = 'Continue'

# --- Los procesos de usuario: la bandeja y la app de escritorio ---
# Ni la bandeja (arranca con la sesión, junto al reloj) ni la
# app de escritorio son servicios: si siguen en marcha, sus
# .exe quedan bloqueados y el desinstalador no puede borrarlos
# — era el resto más visible de una desinstalación. La ventana
# de escritorio y su vigía comparten nombre de proceso: al
# cerrarlo caen los dos y el vigía ya no relanza la ventana.
# Esto corre elevado: cierra los procesos en todas las sesiones.
foreach ($proceso in @('USBMonitorBandeja', 'USBMonitorEscritorio')) {
    Get-Process -Name $proceso -ErrorAction SilentlyContinue |
        Stop-Process -Force -ErrorAction SilentlyContinue
}
Start-Sleep -Seconds 1

# --- El modo servidor dedicado, si esta PC lo tenía ---
# Solo la variante «servidor» trae el script de desactivación
# junto a este. Sin este paso, la PC seguiría entrando sola a
# la cuenta dedicada con un shell que apunta a un programa ya
# borrado. La cuenta a deshacer es la que conste en el inicio
# de sesión automático (el asistente dejaba elegir el nombre),
# con la de siempre como reserva; su SID y su perfil se
# apuntan ANTES de que el script la elimine, porque su carpeta
# de perfil no la borra Remove-LocalUser.
$desactivar = Join-Path $PSScriptRoot 'Desactivar-ModoDedicado.ps1'
if (Test-Path -LiteralPath $desactivar) {
    $cuentaDedicada = 'PanelUSB'
    try {
        $winlogon = Get-ItemProperty -LiteralPath 'HKLM:\SOFTWARE\Microsoft\Windows NT\CurrentVersion\Winlogon' -ErrorAction Stop
        $nombreAutologon = [string]$winlogon.DefaultUserName
        if ($nombreAutologon -and (Get-LocalUser -Name $nombreAutologon -ErrorAction SilentlyContinue)) {
            $cuentaDedicada = $nombreAutologon
        }
    } catch { }
    $sidDedicada = $null
    $perfilDedicado = $null
    $usuarioDedicado = Get-LocalUser -Name $cuentaDedicada -ErrorAction SilentlyContinue
    if ($usuarioDedicado) {
        $sidDedicada = $usuarioDedicado.SID.Value
        $entradaPerfil = Get-ItemProperty -LiteralPath "HKLM:\SOFTWARE\Microsoft\Windows NT\CurrentVersion\ProfileList\$sidDedicada" -ErrorAction SilentlyContinue
        if ($entradaPerfil) {
            $perfilDedicado = [Environment]::ExpandEnvironmentVariables([string]$entradaPerfil.ProfileImagePath)
        }
    }
    # Como proceso hijo y con su propia PowerShell: el script
    # de desactivación podría terminar con exit, y así ese
    # exit no se lleva por delante esta desinstalación.
    & powershell.exe -NoProfile -ExecutionPolicy Bypass -File $desactivar `
        -Cuenta $cuentaDedicada -EliminarCuenta -QuitarPrograma | Out-Host
    # La carpeta del perfil y su asiento en el registro de
    # perfiles, con candado: solo la carpeta «C:\Users\<cuenta>»
    # de ESA cuenta, la que el propio registro de perfiles dice.
    if ($perfilDedicado -and $sidDedicada) {
        $carpetaUsuarios = Split-Path ([Environment]::GetFolderPath('UserProfile')) -Parent
        $esperadaPerfil = Join-Path $carpetaUsuarios $cuentaDedicada
        if ([IO.Path]::GetFullPath($perfilDedicado).TrimEnd('\') -ieq [IO.Path]::GetFullPath($esperadaPerfil).TrimEnd('\')) {
            Remove-Item -LiteralPath $perfilDedicado -Recurse -Force -ErrorAction SilentlyContinue
            Remove-Item -LiteralPath "HKLM:\SOFTWARE\Microsoft\Windows NT\CurrentVersion\ProfileList\$sidDedicada" -Force -ErrorAction SilentlyContinue
        }
    }
}

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

# --- Los datos por usuario de la bandeja y la app de escritorio ---
# Cada usuario que las abrió tiene su carpeta
# %LOCALAPPDATA%\USBMonitor (los ajustes de la bandeja; los
# ajustes y el perfil WebView2 de la app de escritorio, con su
# sesión guardada). El desinstalador corre elevado y esa
# carpeta no es la suya: se recorre el registro de perfiles y
# se borra en cada perfil donde exista. La ruta se construye
# siempre igual (el perfil del registro + AppData\Local\
# USBMonitor), así que no hace falta candado adicional.
try {
    $listaPerfiles = Get-ChildItem -LiteralPath 'HKLM:\SOFTWARE\Microsoft\Windows NT\CurrentVersion\ProfileList' -ErrorAction Stop
    foreach ($entradaPerfil in $listaPerfiles) {
        $datosPerfil = Get-ItemProperty -LiteralPath $entradaPerfil.PSPath -ErrorAction SilentlyContinue
        if (-not $datosPerfil -or -not $datosPerfil.ProfileImagePath) { continue }
        $rutaPerfil = [Environment]::ExpandEnvironmentVariables([string]$datosPerfil.ProfileImagePath)
        $carpetaLocal = Join-Path $rutaPerfil 'AppData\Local\USBMonitor'
        if (Test-Path -LiteralPath $carpetaLocal) {
            Remove-Item -LiteralPath $carpetaLocal -Recurse -Force -ErrorAction SilentlyContinue
            Write-Host "Datos de usuario eliminados: $carpetaLocal"
        }
    }
} catch { }

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
