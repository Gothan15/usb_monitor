# Script para instalar las dependencias del USB Monitor Service
# Ejecutar como administrador

Write-Host "========================================" -ForegroundColor Cyan
Write-Host "  USB Monitor Service - Instalador" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

# Verificar si se ejecuta como administrador
$currentPrincipal = New-Object Security.Principal.WindowsPrincipal([Security.Principal.WindowsIdentity]::GetCurrent())
$isAdmin = $currentPrincipal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)

if (-not $isAdmin) {
    Write-Host "ERROR: Este script debe ejecutarse como Administrador" -ForegroundColor Red
    Write-Host "Por favor, cierra esta ventana y ejecuta PowerShell como Administrador" -ForegroundColor Yellow
    pause
    exit 1
}

Write-Host "✓ Ejecutando con privilegios de administrador" -ForegroundColor Green
Write-Host ""

# Verificar si Python está instalado
Write-Host "Verificando instalación de Python..." -ForegroundColor Yellow
try {
    $pythonVersion = python --version 2>&1
    Write-Host "✓ Python encontrado: $pythonVersion" -ForegroundColor Green
} catch {
    Write-Host "ERROR: Python no está instalado o no está en el PATH" -ForegroundColor Red
    Write-Host "Por favor, instala Python desde https://www.python.org/downloads/" -ForegroundColor Yellow
    pause
    exit 1
}

Write-Host ""
Write-Host "Instalando dependencias principales..." -ForegroundColor Yellow
Write-Host "--------------------------------------" -ForegroundColor Cyan

# Instalar pywin32
Write-Host "Instalando pywin32..." -ForegroundColor Cyan
python -m pip install --upgrade pywin32
if ($LASTEXITCODE -eq 0) {
    Write-Host "✓ pywin32 instalado correctamente" -ForegroundColor Green
} else {
    Write-Host "✗ Error al instalar pywin32" -ForegroundColor Red
}

# Instalar wmi
Write-Host "Instalando WMI..." -ForegroundColor Cyan
python -m pip install --upgrade wmi
if ($LASTEXITCODE -eq 0) {
    Write-Host "✓ WMI instalado correctamente" -ForegroundColor Green
} else {
    Write-Host "✗ Error al instalar WMI" -ForegroundColor Red
}

# Instalar requests
Write-Host "Instalando requests..." -ForegroundColor Cyan
python -m pip install --upgrade requests
if ($LASTEXITCODE -eq 0) {
    Write-Host "✓ requests instalado correctamente" -ForegroundColor Green
} else {
    Write-Host "✗ Error al instalar requests" -ForegroundColor Red
}

# Instalar cryptography (nueva dependencia)
Write-Host "Instalando cryptography (para encriptación de API keys)..." -ForegroundColor Cyan
python -m pip install --upgrade cryptography
if ($LASTEXITCODE -eq 0) {
    Write-Host "✓ cryptography instalado correctamente" -ForegroundColor Green
} else {
    Write-Host "✗ Error al instalar cryptography" -ForegroundColor Red
}

# Instalar argon2-cffi (verificación local de la contraseña en la
# emergencia sin red: página :5001/desbloquear del servicio)
Write-Host "Instalando argon2-cffi (para la emergencia sin red)..." -ForegroundColor Cyan
python -m pip install --upgrade argon2-cffi
if ($LASTEXITCODE -eq 0) {
    Write-Host "✓ argon2-cffi instalado correctamente" -ForegroundColor Green
} else {
    Write-Host "✗ Error al instalar argon2-cffi" -ForegroundColor Red
}

Write-Host ""
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "  Instalación completada" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""
Write-Host "Próximos pasos:" -ForegroundColor Yellow
Write-Host "1. Ejecuta: python usb_monitor_service.py gui" -ForegroundColor White
Write-Host "2. Haz clic en 'Instalar servicio'" -ForegroundColor White
Write-Host "3. Configura la API key desde la GUI" -ForegroundColor White
Write-Host "4. Haz clic en 'Iniciar servicio'" -ForegroundColor White
Write-Host ""
Write-Host "Nota: La API key ahora se encripta automáticamente" -ForegroundColor Green
Write-Host "      para mayor seguridad." -ForegroundColor Green
Write-Host ""

pause
