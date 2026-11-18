# ============================================================
#  USB Monitor - Modo servidor dedicado: ACTIVAR
# ============================================================
#  Convierte esta PC en un servidor del panel y nada mas:
#
#   1. Copia USBMonitorEscritorio.exe a una carpeta fija de
#      Program Files.
#   2. Crea una cuenta local dedicada (sin privilegios de
#      administrador) solo para ensenar el panel.
#   3. Le sustituye el shell a ESA cuenta: al entrar, en vez
#      de Explorer arranca el vigilante de la app, que abre
#      el panel a pantalla completa y lo relanza si se cae.
#      Sin escritorio, sin barra de tareas, sin menu Inicio.
#   4. Activa el inicio de sesion automatico de esa cuenta,
#      para que al encender la PC el panel aparezca solo.
#
#  Tu cuenta de administrador NO se toca: sigue con su
#  Explorer normal. Para mantener la PC, Ctrl+Alt+Supr,
#  Cambiar de usuario, y entras con tu cuenta de siempre.
#
#  Uso (PowerShell como administrador):
#    powershell -ExecutionPolicy Bypass -File .\Activar-ModoDedicado.ps1
#
#  Parametros:
#    -Cuenta     Nombre de la cuenta dedicada (PanelUSB).
#    -OrigenExe  Ruta del exe compilado. Por defecto se
#                busca en escritorio\dist, junto al proyecto.
#    -Destino    Carpeta de instalacion de la app.

#Requires -Version 5.1
param(
    [string]$Cuenta = 'PanelUSB',
    [string]$OrigenExe = '',
    [string]$Destino = 'C:\Program Files\USBMonitor\Escritorio'
)

$ErrorActionPreference = 'Stop'

# --- 0. Hay que ser administrador --------------------------
$identidad = [Security.Principal.WindowsIdentity]::GetCurrent()
$principal = New-Object Security.Principal.WindowsPrincipal($identidad)
if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
    Write-Host 'Este script necesita una PowerShell abierta como administrador.'
    exit 1
}

# Pasa una SecureString a texto plano, solo en memoria y
# solo para entregarla a quien la necesita (crear la
# cuenta, el inicio automatico y el proceso como esa
# cuenta). Nunca se escribe en ningun archivo.
function Convertir-APlano([Security.SecureString]$Segura) {
    $puntero = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($Segura)
    try {
        return [Runtime.InteropServices.Marshal]::PtrToStringBSTR($puntero)
    }
    finally {
        [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($puntero)
    }
}

# --- 1. Localizar el exe compilado ------------------------
if ([string]::IsNullOrWhiteSpace($OrigenExe)) {
    # El script vive en escritorio\dedicado: la salida de
    # Construir-Escritorio.ps1 esta en escritorio\dist.
    $carpetaProyecto = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
    $OrigenExe = Join-Path $carpetaProyecto 'dist\USBMonitorEscritorio.exe'
}
if (-not (Test-Path $OrigenExe)) {
    Write-Host "No se encontro el exe en: $OrigenExe"
    Write-Host 'Compilalo primero con Construir-Escritorio.ps1 o pasa su ruta con -OrigenExe.'
    exit 1
}

# --- 2. Copiar el exe a su carpeta fija -------------------
New-Item -ItemType Directory -Path $Destino -Force | Out-Null
$exeDestino = Join-Path $Destino 'USBMonitorEscritorio.exe'
Copy-Item $OrigenExe $exeDestino -Force
Write-Host "App instalada en: $exeDestino"

# --- 3. La contrasena de la cuenta dedicada ---------------
# Se pide dos veces y se comparan en memoria. La cuenta no
# es administradora y no guarda datos: su unico trabajo es
# ensenar el panel. Aun asi, que sea una contrasena de
# verdad, no el nombre del equipo.
$clave1 = Read-Host "Contrasena para la cuenta $Cuenta" -AsSecureString
$clave2 = Read-Host 'Repitela' -AsSecureString
$plana1 = Convertir-APlano $clave1
$plana2 = Convertir-APlano $clave2
if ($plana1 -ne $plana2) {
    Write-Host 'Las contrasenas no coinciden. No se ha creado nada mas.'
    exit 1
}
if ($plana1.Length -lt 8) {
    Write-Host 'Minimo 8 caracteres, por la politica de Windows y por sentido comun.'
    exit 1
}

# --- 4. Crear (o actualizar) la cuenta dedicada -----------
$existente = Get-LocalUser -Name $Cuenta -ErrorAction SilentlyContinue
if ($existente) {
    Set-LocalUser -Name $Cuenta -Password $clave1 -PasswordNeverExpires $true
    Write-Host "La cuenta $Cuenta ya existia: contrasena actualizada."
}
else {
    New-LocalUser -Name $Cuenta -Password $clave1 `
        -FullName 'Panel USB Monitor' `
        -Description 'Cuenta dedicada del panel USB Monitor (modo servidor dedicado)' `
        -PasswordNeverExpires -UserMayNotChangePassword -AccountNeverExpires | Out-Null
    Write-Host "Cuenta $Cuenta creada."
}

# La cuenta dedicada jamas debe ser administradora: si lo
# era de una instalacion anterior, se le quita del grupo
# (el grupo se busca por SID, que no depende del idioma).
$grupoAdmin = Get-LocalGroup -SID 'S-1-5-32-544'
if (Get-LocalGroupMember -Group $grupoAdmin -Member $Cuenta -ErrorAction SilentlyContinue) {
    Remove-LocalGroupMember -Group $grupoAdmin -Member $Cuenta
    Write-Host "Ojo: $Cuenta estaba en Administradores y se ha sacado del grupo."
}

# Permiso de lectura y ejecucion sobre la carpeta de la
# app: la cuenta tiene que poder arrancar el exe, y nada
# mas que eso.
& icacls $Destino /grant "${Cuenta}:(OI)(CI)RX" /T /Q | Out-Null
if ($LASTEXITCODE -ne 0) {
    Write-Host 'icacls no pudo dar el permiso de ejecucion sobre la carpeta de la app.'
    exit 1
}

# --- 5. Sustituir el shell SOLO de esa cuenta -------------
# El valor Shell de Winlogon es por usuario (HKCU), asi que
# se escribe ejecutando un proceso breve COMO esa cuenta:
# de paso, ese primer inicio crea su perfil en disco.
$valorShell = "`"$exeDestino`" --vigia"
$scriptInterno = Join-Path $env:TEMP 'usbmonitor-shell.ps1'
Set-Content -Path $scriptInterno -Encoding UTF8 -Value @"
Set-ItemProperty -Path 'HKCU:\SOFTWARE\Microsoft\Windows NT\CurrentVersion\Winlogon' -Name Shell -Value '$valorShell'
"@
try {
    $credencial = New-Object PSCredential($Cuenta, $clave1)
    $proceso = Start-Process powershell.exe -Credential $credencial -PassThru -Wait `
        -WindowStyle Hidden `
        -ArgumentList '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', "`"$scriptInterno`""
    if ($proceso.ExitCode -ne 0) {
        Write-Host "El proceso como $Cuenta salio con codigo $($proceso.ExitCode): el shell no quedo escrito."
        exit 1
    }
}
finally {
    Remove-Item $scriptInterno -ErrorAction SilentlyContinue
}
Write-Host "Shell sustituido para $Cuenta (tu cuenta no se toca)."

# --- 6. Inicio de sesion automatico -----------------------
# AVISO: Windows guarda esta contrasena en el registro de
# una forma que cualquier administrador local puede leer.
# Es el mecanismo normal del modo kiosko y se acepta
# porque la cuenta no es administradora ni guarda datos;
# la alternativa con cifrado es la herramienta Autologon
# de Sysinternals, si algun dia hace falta.
$rutaWinlogon = 'HKLM:\SOFTWARE\Microsoft\Windows NT\CurrentVersion\Winlogon'
Set-ItemProperty -Path $rutaWinlogon -Name AutoAdminLogon -Value '1'
Set-ItemProperty -Path $rutaWinlogon -Name DefaultUserName -Value $Cuenta
Set-ItemProperty -Path $rutaWinlogon -Name DefaultDomainName -Value $env:COMPUTERNAME
Set-ItemProperty -Path $rutaWinlogon -Name DefaultPassword -Value $plana1
$plana1 = $null
$plana2 = $null

Write-Host ''
Write-Host 'Modo dedicado ACTIVADO.'
Write-Host "Al reiniciar, la PC entrara sola como $Cuenta y abrira el panel a pantalla completa."
Write-Host 'Para mantener la PC: Ctrl+Alt+Supr, Cambiar de usuario, y entra con tu cuenta administradora.'
Write-Host 'Para deshacerlo: Desactivar-ModoDedicado.ps1'
