# 📂 Ubicación de Logs - USB Monitor Service

## ❓ ¿Dónde Se Guardan Los Logs?

### 📍 Ubicación Predeterminada

```
C:\ProgramData\USBMonitor\usb_monitor_service.log
```

**Ruta expandida**:

```
%ProgramData%\USBMonitor\usb_monitor_service.log
```

---

## 🔍 Cómo Acceder a los Logs

### Opción 1: PowerShell (Recomendado)

```powershell
# Ver en tiempo real
Get-Content "C:\ProgramData\USBMonitor\usb_monitor_service.log" -Wait -Tail 30

# Ver últimas 50 líneas
Get-Content "C:\ProgramData\USBMonitor\usb_monitor_service.log" -Tail 50

# Ver todo el archivo
Get-Content "C:\ProgramData\USBMonitor\usb_monitor_service.log"

# Filtrar por tipo de evento
Select-String "WHITELIST" "C:\ProgramData\USBMonitor\usb_monitor_service.log"
Select-String "ERROR" "C:\ProgramData\USBMonitor\usb_monitor_service.log"
Select-String "✓" "C:\ProgramData\USBMonitor\usb_monitor_service.log"
```

### Opción 2: Explorador de Archivos

1. **Abre Ejecutar** (`Win + R`)
2. **Escribe**: `%ProgramData%`
3. **Presiona Enter**
4. **Navega a**: `USBMonitor`
5. **Abre**: `usb_monitor_service.log`

### Opción 3: Bloc de Notas

```powershell
# Abre directamente en el bloc de notas
notepad "C:\ProgramData\USBMonitor\usb_monitor_service.log"
```

### Opción 4: VS Code

```powershell
# Abre en VS Code
code "C:\ProgramData\USBMonitor\usb_monitor_service.log"
```

---

## 📝 Formato del Archivo de Log

### Estructura de Cada Línea

```
[TIMESTAMP] | [NIVEL] | [MENSAJE]
```

### Ejemplo Real

```
2024-11-02 10:30:15 | INFO | ═══ EVENTO DE INSERCIÓN DETECTADO ═══
2024-11-02 10:30:15 | INFO |   [1/5] Letra de unidad resuelta: E:
2024-11-02 10:30:16 | INFO |   [2/5] ✓ Serial obtenido: ABC123DEF456
2024-11-02 10:30:17 | INFO |   [3/5] → Verificando whitelist...
2024-11-02 10:30:18 | INFO |   [4/5] ✓ Dispositivo autorizado
2024-11-02 10:30:19 | INFO |   [5/5] ✓ USB protegida contra escritura
2024-11-02 10:30:20 | INFO | ═══ VERIFICACIÓN COMPLETADA ═══
```

---

## 📊 Niveles de Log

| Nivel       | Símbolo | Color    | Significado                               |
| ----------- | ------- | -------- | ----------------------------------------- |
| **INFO**    | ℹ       | Azul     | Información normal, operación completada  |
| **WARNING** | ⚠       | Amarillo | Advertencia, algo inusual pero no crítico |
| **ERROR**   | ✗       | Rojo     | Error, requiere atención                  |
| **DEBUG**   | →       | Verde    | Información de diagnóstico                |

---

## 🎯 Ejemplos de Búsqueda en Logs

### Buscar Todos los Eventos de Whitelist

```powershell
Select-String "WHITELIST\|✓\|✗" "C:\ProgramData\USBMonitor\usb_monitor_service.log" | Select-Object -First 20
```

**Resultado esperado**:

```
2024-11-02 10:30:18 | INFO |   [4/5] ✓ Dispositivo autorizado
2024-11-02 10:35:22 | WARNING | ✗ Dispositivo no autorizado: XYZ789
```

### Buscar Todos los Errores

```powershell
Select-String "ERROR" "C:\ProgramData\USBMonitor\usb_monitor_service.log"
```

### Buscar Eventos de Desbloqueo

```powershell
Select-String "unlock\|unlock" "C:\ProgramData\USBMonitor\usb_monitor_service.log" -IgnoreCase
```

### Buscar Eventos de Protección

```powershell
Select-String "protect\|readonly" "C:\ProgramData\USBMonitor\usb_monitor_service.log" -IgnoreCase
```

### Ver Última Hora de Eventos

```powershell
$oneHourAgo = (Get-Date).AddHours(-1)
Get-Content "C:\ProgramData\USBMonitor\usb_monitor_service.log" |
    Where-Object { [DateTime]::Parse($_.Split("|")[0]) -gt $oneHourAgo }
```

---

## 🔄 Rotación de Logs

### Problema: Archivo Muy Grande

Si el archivo de log crece demasiado (ej: varios GB):

### Solución 1: Limpiar Manualmente

```powershell
# Detén el servicio
.\Install-Service.ps1 -Action stop

# Guarda un backup
$date = Get-Date -Format "yyyyMMdd_HHmmss"
Copy-Item "C:\ProgramData\USBMonitor\usb_monitor_service.log" `
    "C:\ProgramData\USBMonitor\usb_monitor_service_backup_$date.log"

# Limpia el archivo actual
Clear-Content "C:\ProgramData\USBMonitor\usb_monitor_service.log"

# Reinicia el servicio
.\Install-Service.ps1 -Action start
```

### Solución 2: Guardar Solo Últimas Líneas

```powershell
# Detén el servicio
.\Install-Service.ps1 -Action stop

# Guarda solo las últimas 10,000 líneas
$logFile = "C:\ProgramData\USBMonitor\usb_monitor_service.log"
$content = Get-Content $logFile
$content | Select-Object -Last 10000 | Set-Content $logFile

# Reinicia el servicio
.\Install-Service.ps1 -Action start
```

### Solución 3: Crear Script de Rotación Automática

```powershell
# Archivo: Rotate-Logs.ps1
param(
    [int]$MaxSizeInMB = 100,
    [int]$MaxBackups = 5
)

$logFile = "C:\ProgramData\USBMonitor\usb_monitor_service.log"
$logDir = Split-Path $logFile

# Verifica tamaño
if (Test-Path $logFile) {
    $size = (Get-Item $logFile).Length / 1MB

    if ($size -gt $MaxSizeInMB) {
        Write-Host "Log excede $MaxSizeInMB MB. Rotando..."

        # Detén el servicio
        Stop-Service USBMonitorService -Force

        # Crea backup
        $timestamp = Get-Date -Format "yyyyMMdd_HHmmss"
        $backup = Join-Path $logDir "usb_monitor_service_$timestamp.log"
        Move-Item $logFile $backup

        # Limpia backups antiguos
        Get-ChildItem $logDir -Filter "usb_monitor_service_*.log" |
            Sort-Object CreationTime -Descending |
            Select-Object -Skip $MaxBackups |
            Remove-Item

        # Reinicia el servicio
        Start-Service USBMonitorService
        Write-Host "Rotación completada. Backup: $backup"
    }
}
```

**Ejecutar como tarea programada**:

```powershell
# Agregar a tareas programadas para ejecutar cada hora
$trigger = New-JobTrigger -Daily -At 2:00AM
Register-ScheduledJob -Name "RotateUSBMonitorLogs" -Trigger $trigger `
    -ScriptBlock { & "C:\USBMonitor\Rotate-Logs.ps1" }
```

---

## 🌐 Ubicaciones Alternativas

### Si Cambiaste la Ruta

Si durante la instalación especificaste una ruta diferente:

```powershell
# Verifica la variable de entorno
[Environment]::GetEnvironmentVariable("USB_MONITOR_LOG_PATH", "Machine")
```

**Resultado**:

```
C:\ProgramData\USBMonitor
```

O si cambiaste a una ruta custom:

```
D:\Logs\USBMonitor
E:\Monitor\logs
```

### Cambiar la Ubicación de Logs

```powershell
# Nueva ubicación
[Environment]::SetEnvironmentVariable(
    "USB_MONITOR_LOG_PATH",
    "D:\Custom\Logs\USBMonitor",
    "Machine"
)

# Crea el directorio si no existe
New-Item -ItemType Directory -Path "D:\Custom\Logs\USBMonitor" -Force

# Reinicia el servicio
.\Install-Service.ps1 -Action restart
```

---

## 📊 Análisis de Logs

### Script para Análisis Completo

```powershell
# Analizar-Logs.ps1
$logFile = "C:\ProgramData\USBMonitor\usb_monitor_service.log"

Write-Host "╔════════════════════════════════════════╗" -ForegroundColor Cyan
Write-Host "║        ANÁLISIS DE LOGS DEL SERVICIO   ║" -ForegroundColor Cyan
Write-Host "╚════════════════════════════════════════╝" -ForegroundColor Cyan

Write-Host "`n📊 Estadísticas:" -ForegroundColor Yellow
$content = Get-Content $logFile

Write-Host "  Total de líneas: $($content.Count)"
Write-Host "  Eventos exitosos (✓): $(@($content | Select-String "✓").Count)"
Write-Host "  Eventos fallidos (✗): $(@($content | Select-String "✗").Count)"
Write-Host "  Errores (ERROR): $(@($content | Select-String "ERROR").Count)"
Write-Host "  Advertencias (WARNING): $(@($content | Select-String "WARNING").Count)"

Write-Host "`n🔍 Seriales Detectados:" -ForegroundColor Yellow
$content | Select-String "Serial obtenido:" | ForEach-Object {
    $_ -match "Serial obtenido: (.+)" | Out-Null
    "  $($matches[1])"
}

Write-Host "`n⚠️  Dispositivos NO autorizados:" -ForegroundColor Yellow
$content | Select-String "✗" | Select-Object -First 10 | ForEach-Object {
    "  $_"
}

Write-Host "`n✓ Dispositivos Autorizados:" -ForegroundColor Yellow
$content | Select-String "Dispositivo autorizado" | Select-Object -First 10 | ForEach-Object {
    "  $_"
}
```

---

## 🔐 Permisos de Acceso

### Verificar Permisos

```powershell
Get-Acl "C:\ProgramData\USBMonitor" | Format-List
```

### Modificar Permisos

```powershell
# Dale permisos de lectura a un usuario específico
$acl = Get-Acl "C:\ProgramData\USBMonitor"
$rule = New-Object System.Security.AccessControl.FileSystemAccessRule(
    "DOMAIN\username",
    "Modify",
    "ContainerInherit,ObjectInherit",
    "None",
    "Allow"
)
$acl.SetAccessRule($rule)
Set-Acl "C:\ProgramData\USBMonitor" $acl
```

---

## 🎯 Monitoreo en Tiempo Real

### Panel en Vivo

```powershell
# Monitor-Logs.ps1
while ($true) {
    Clear-Host
    Write-Host "╔════════════════════════════════════════╗" -ForegroundColor Cyan
    Write-Host "║   Monitoreo en Vivo - USB Monitor      ║" -ForegroundColor Cyan
    Write-Host "╚════════════════════════════════════════╝" -ForegroundColor Cyan

    $logFile = "C:\ProgramData\USBMonitor\usb_monitor_service.log"
    $lastLines = Get-Content $logFile -Tail 15

    Write-Host "`nÚltimos eventos:" -ForegroundColor Yellow
    $lastLines | ForEach-Object {
        if ($_ -match "ERROR") { Write-Host $_ -ForegroundColor Red }
        elseif ($_ -match "✓") { Write-Host $_ -ForegroundColor Green }
        elseif ($_ -match "✗") { Write-Host $_ -ForegroundColor Red }
        elseif ($_ -match "→") { Write-Host $_ -ForegroundColor Yellow }
        else { Write-Host $_ }
    }

    Write-Host "`nActualizando en 5 segundos..." -ForegroundColor Gray
    Start-Sleep -Seconds 5
}
```

**Ejecutar**:

```powershell
powershell -ExecutionPolicy Bypass -File Monitor-Logs.ps1
```

---

## 📞 Referencia Rápida

| Tarea             | Comando                                                                          |
| ----------------- | -------------------------------------------------------------------------------- |
| Ver logs          | `Get-Content "C:\ProgramData\USBMonitor\usb_monitor_service.log"`                |
| Monitor vivo      | `Get-Content "C:\ProgramData\USBMonitor\usb_monitor_service.log" -Wait -Tail 30` |
| Ver errores       | `Select-String "ERROR" "C:\ProgramData\USBMonitor\usb_monitor_service.log"`      |
| Últimas 50 líneas | `Get-Content "C:\ProgramData\USBMonitor\usb_monitor_service.log" -Tail 50`       |
| Limpiar logs      | `Clear-Content "C:\ProgramData\USBMonitor\usb_monitor_service.log"`              |
| Abrir en editor   | `notepad "C:\ProgramData\USBMonitor\usb_monitor_service.log"`                    |

---

**Resumen**: Los logs se guardan en `C:\ProgramData\USBMonitor\usb_monitor_service.log` de forma predeterminada, pero pueden ser configurados en una ruta personalizada mediante la variable de entorno `USB_MONITOR_LOG_PATH`.
