# ============================================================
#  USB Monitor - Modo servidor dedicado: DESACTIVAR
# ============================================================
#  Deshace lo que hizo Activar-ModoDedicado.ps1:
#
#   1. Apaga el inicio de sesion automatico y borra la
#      contrasena guardada en el registro.
#   2. Quita la sustitucion del shell de la cuenta
#      dedicada: si entra, volvera a tener su Explorer
#      normal.
#   3. Opcional: borra la cuenta (-EliminarCuenta) y la
#      carpeta de la app (-QuitarPrograma).
#
#  Tu cuenta de administrador no se toca en ningun caso.
#
#  Uso (PowerShell como administrador):
#    powershell -ExecutionPolicy Bypass -File .\Desactivar-ModoDedicado.ps1
#    powershell -ExecutionPolicy Bypass -File .\Desactivar-ModoDedicado.ps1 -EliminarCuenta -QuitarPrograma

#Requires -Version 5.1
param(
    [string]$Cuenta = 'PanelUSB',
    [switch]$EliminarCuenta,
    [switch]$QuitarPrograma,
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

# --- 1. Fuera el inicio de sesion automatico ---------------
$rutaWinlogon = 'HKLM:\SOFTWARE\Microsoft\Windows NT\CurrentVersion\Winlogon'
Set-ItemProperty -Path $rutaWinlogon -Name AutoAdminLogon -Value '0'
foreach ($valor in 'DefaultUserName', 'DefaultPassword', 'DefaultDomainName') {
    Remove-ItemProperty -Path $rutaWinlogon -Name $valor -ErrorAction SilentlyContinue
}
Write-Host 'Inicio de sesion automatico desactivado y contrasena borrada del registro.'

# --- 2. Fuera la sustitucion del shell ---------------------
# El valor Shell vive en el HKCU de la cuenta dedicada. Su
# colmena puede estar cargada (si la cuenta tiene sesion
# abierta) o en su NTUSER.DAT: se cubren los dos casos.
$usuario = Get-LocalUser -Name $Cuenta -ErrorAction SilentlyContinue
if ($usuario) {
    $sid = $usuario.SID.Value
    if (-not (Get-PSDrive -Name HKU -ErrorAction SilentlyContinue)) {
        New-PSDrive -Name HKU -PSProvider Registry -Root HKEY_USERS | Out-Null
    }
    $claveShell = "SOFTWARE\Microsoft\Windows NT\CurrentVersion\Winlogon"
    if (Test-Path "HKU:\$sid") {
        Remove-ItemProperty -Path "HKU:\$sid\$claveShell" -Name Shell -ErrorAction SilentlyContinue
        Write-Host "Shell restaurado para $Cuenta."
    }
    else {
        # Colmena no cargada: se monta su NTUSER.DAT, se
        # quita el valor y se desmonta.
        $rutaPerfil = (Get-ItemProperty "HKLM:\SOFTWARE\Microsoft\Windows NT\CurrentVersion\ProfileList\$sid").ProfileImagePath
        $ntuser = Join-Path $rutaPerfil 'NTUSER.DAT'
        if (Test-Path $ntuser) {
            & reg.exe load 'HKU\PanelUSBTemporal' $ntuser | Out-Null
            try {
                Remove-ItemProperty -Path "HKU:\PanelUSBTemporal\$claveShell" -Name Shell -ErrorAction SilentlyContinue
                Write-Host "Shell restaurado para $Cuenta."
            }
            finally {
                # Sin esto, Windows no deja desmontar la
                # colmena: hay que soltar los manejadores.
                [GC]::Collect()
                & reg.exe unload 'HKU\PanelUSBTemporal' | Out-Null
            }
        }
        else {
            Write-Host "No se encontro el perfil de $Cuenta; probablemente nunca llego a entrar. Nada que restaurar."
        }
    }
}
else {
    Write-Host "La cuenta $Cuenta no existe; nada que restaurar en su shell."
}

# --- 3. Opcionales: cuenta y programa ----------------------
if ($EliminarCuenta -and $usuario) {
    Remove-LocalUser -Name $Cuenta
    Write-Host "Cuenta $Cuenta eliminada."
}
if ($QuitarPrograma -and (Test-Path $Destino)) {
    Remove-Item $Destino -Recurse -Force
    Write-Host "Carpeta de la app eliminada: $Destino"
}

Write-Host ''
Write-Host 'Modo dedicado DESACTIVADO. Al reiniciar, la PC se quedara en la pantalla de inicio de sesion normal.'
