@echo off
rem ================================================================
rem USB Monitor — abre el panel en el navegador.
rem Lee el puerto real de HKLM\Software\USBMonitor\Panel (lo escribe
rem el instalador) y muestra también la dirección para la red local.
rem ================================================================
setlocal
set "PUERTO=3000"
for /f "tokens=2*" %%a in ('reg query "HKLM\SOFTWARE\USBMonitor\Panel" /v PanelPort 2^>nul') do set "PUERTO=%%b"
echo Abriendo el panel: http://localhost:%PUERTO%
echo Desde otro equipo de la red: http://%COMPUTERNAME%:%PUERTO%
start "" "http://localhost:%PUERTO%"
endlocal
