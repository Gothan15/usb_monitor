@echo off
echo Buscando proceso en puerto 3000...
for /f "tokens=5" %%a in ('netstat -ano ^| findstr :3000') do (
    echo Matando proceso con PID: %%a
    taskkill /PID %%a /F
)
echo Listo!
pause