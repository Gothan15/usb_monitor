@echo off
rem ================================================================
rem USB Monitor - abre el panel en el navegador.
rem Lee el puerto real de HKLM\Software\USBMonitor\Panel (lo
rem escribe el instalador) y abre la direccion de red del
rem equipo: el panel solo sirve sus paginas en su direccion
rem unica de la red local, y localhost NO es una de ellas
rem (abrir localhost lo deja lento o sin responder).
rem ================================================================
setlocal
set "PUERTO=3000"
rem reg query muestra los valores REG_DWORD en hexadecimal
rem (0xbb8 = 3000): hay que convertir lo leido a decimal, porque
rem tal cual saldria http://...:0xbb8 y no abriria.
for /f "tokens=2*" %%a in ('reg query "HKLM\SOFTWARE\USBMonitor\Panel" /v PanelPort 2^>nul') do set "PUERTO_LEIDO=%%b"
if defined PUERTO_LEIDO set /a "PUERTO=%PUERTO_LEIDO%" 2>nul
rem La IP de la ruta por defecto: se "conecta" un socket UDP
rem (no envia nada) y se lee la direccion local que Windows
rem elige para salir; esa es la direccion unica del panel,
rem la misma que usa la bandeja. La IP de destino va como
rem numero (134744072 = 8.8.8.8) para no anidar comillas en
rem la linea del for. Sin red, queda localhost.
set "IP="
for /f "delims=" %%i in ('powershell -NoProfile -Command "$s=New-Object Net.Sockets.UdpClient; $s.Connect([Net.IPAddress]::new(134744072),65530); $s.Client.LocalEndPoint.Address.IPAddressToString; $s.Close()" 2^>nul') do set "IP=%%i"
if not defined IP set "IP=localhost"
echo Abriendo el panel: http://%IP%:%PUERTO%
start "" "http://%IP%:%PUERTO%"
endlocal
