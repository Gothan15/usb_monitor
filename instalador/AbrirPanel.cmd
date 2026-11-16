@echo off
rem ================================================================
rem USB Monitor — abre el panel en el navegador.
rem Lee el puerto real de HKLM\Software\USBMonitor\Panel (lo escribe
rem el instalador) y muestra también la dirección para la red local.
rem ================================================================
setlocal
set "PUERTO=3000"
rem reg query muestra los valores REG_DWORD en hexadecimal
rem (0xbb8 = 3000): hay que convertir lo leido a decimal, porque
rem tal cual saldria http://localhost:0xbb8 y no abriria.
for /f "tokens=2*" %%a in ('reg query "HKLM\SOFTWARE\USBMonitor\Panel" /v PanelPort 2^>nul') do set "PUERTO_LEIDO=%%b"
if defined PUERTO_LEIDO set /a "PUERTO=%PUERTO_LEIDO%" 2>nul
echo Abriendo el panel: http://localhost:%PUERTO%
echo Desde otro equipo de la red: http://%COMPUTERNAME%:%PUERTO%
start "" "http://localhost:%PUERTO%"
endlocal
