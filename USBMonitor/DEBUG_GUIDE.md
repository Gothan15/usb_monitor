# 🐛 Guía de Depuración - USB Monitor Agent

## Problemas Comunes y Soluciones

### ❌ La ventana de login no aparece

#### 1. Verificar que el agente está corriendo

```powershell
# Ver procesos de Python
Get-Process python

# Ver logs del agente
Get-Content "C:\ProgramData\USBMonitor\agent.log" -Tail 50
```

#### 2. Verificar el archivo de señal

```powershell
# Ver contenido del archivo de señal
Get-Content "C:\ProgramData\USBMonitor\browser_signal.json" | ConvertFrom-Json

# Ver si existe
Test-Path "C:\ProgramData\USBMonitor\browser_signal.json"
```

#### 3. Crear señal de prueba

```powershell
python test_agent.py
# Seleccionar opción 1 o 4
```

#### 4. Ver logs en tiempo real

```powershell
# Terminal 1: Ejecutar agente con logs visibles
python usb_monitor_agent.py

# Terminal 2: Crear señal de prueba
python test_agent.py
```

---

### ❌ La señal no se procesa

#### Posibles causas:

1. **El archivo JSON está corrupto**

   ```powershell
   # Ver contenido
   cat "C:\ProgramData\USBMonitor\browser_signal.json"

   # Si está corrupto, eliminarlo
   Remove-Item "C:\ProgramData\USBMonitor\browser_signal.json"
   ```

2. **La señal ya fue procesada**

   ```powershell
   # Verificar campo "processed"
   (Get-Content "C:\ProgramData\USBMonitor\browser_signal.json" | ConvertFrom-Json).processed

   # Si es true, eliminar y crear nueva
   Remove-Item "C:\ProgramData\USBMonitor\browser_signal.json"
   python test_agent.py  # Opción 1
   ```

3. **El agente no está monitoreando**

   ```powershell
   # Verificar logs
   Select-String -Path "C:\ProgramData\USBMonitor\agent.log" -Pattern "Iniciando monitoreo"

   # Debería ver: "Iniciando monitoreo de señales en: C:\ProgramData\USBMonitor\browser_signal.json"
   ```

---

### ❌ La ventana se cierra en lugar de minimizarse

**Problema:** La ventana de login se destruye al cancelar o cerrar.

**Solución:** Ya implementado en la nueva versión. La ventana ahora usa `withdraw()` en lugar de `destroy()`.

**Verificación:**

```python
# En usb_monitor_agent.py, líneas ~360-370
# Debe usar: self.window.withdraw()
# No debe usar: self.window.destroy()
```

---

### ❌ El servicio no crea la señal

#### 1. Verificar logs del servicio

```powershell
Get-Content "D:\Monitor_USB\usb_monitor.log" -Tail 50
```

Buscar líneas como:

```
Señal creada para agente - Unidad: E:, Timestamp: 2025-10-02T14:30:45
```

#### 2. Verificar permisos

```powershell
# El servicio debe poder escribir en C:\ProgramData\USBMonitor\
icacls "C:\ProgramData\USBMonitor"
```

#### 3. Ejecutar servicio en modo debug

```powershell
# Detener servicio
python usb_monitor_service.py stop

# Ejecutar en consola
python usb_monitor_service.py debug

# Conectar USB y ver output
```

---

## 🧪 Pruebas Paso a Paso

### Test 1: Verificar que el agente recibe señales

```powershell
# Terminal 1: Iniciar agente
python usb_monitor_agent.py

# Terminal 2: Crear señal de prueba
python test_agent.py
# Seleccionar opción 1

# Resultado esperado:
# - Terminal 1 muestra: "Señal detectada: PC=TEST_PC, Unidad=E:"
# - Aparece ventana de login
```

### Test 2: Verificar procesamiento de señal

```powershell
python test_agent.py
# Seleccionar opción 4 (Crear señal y monitorear)

# Resultado esperado:
# - Se crea la señal
# - Cada 5 segundos verifica el estado
# - Muestra "✅ ¡Señal procesada exitosamente!" si el agente la procesa
```

### Test 3: Verificar múltiples señales

```powershell
# Terminal 1: Agente corriendo
python usb_monitor_agent.py

# Terminal 2: Crear múltiples señales
python test_agent.py  # Opción 1
# Esperar 10 segundos
python test_agent.py  # Opción 1
# Esperar 10 segundos
python test_agent.py  # Opción 1

# Resultado esperado:
# - Cada señal debe procesarse
# - Si la ventana está abierta, debe traerse al frente
```

---

## 📝 Logs Importantes

### Logs del Agente

**Ubicación:** `C:\ProgramData\USBMonitor\agent.log`

**Líneas clave a buscar:**

```
# Inicio correcto
USB Monitor Agent iniciado

# Monitoreo activo
Iniciando monitoreo de señales en: C:\ProgramData\USBMonitor\browser_signal.json

# Señal detectada
Señal detectada: PC=TEST_PC, Unidad=E:, Timestamp=2025-10-02T14:30:45

# Señal procesada
Señal marcada como procesada

# Ventana mostrada
Mostrando ventana de login para PC: TEST_PC, Unidad: E:

# Login exitoso
Login exitoso, USB desbloqueado

# Login cancelado
Login cancelado
```

### Logs del Servicio

**Ubicación:** `D:\Monitor_USB\usb_monitor.log`

**Líneas clave a buscar:**

```
# USB detectado
Evento USB detectado: USB inserted: E:

# Señal creada
Señal creada para agente - Unidad: E:, Timestamp: 2025-10-02T14:30:45

# Esperando autorización
Esperando autorización de desbloqueo para E: (timeout: 300s)...

# Autorización recibida
Desbloqueo autorizado para E:

# USB desbloqueado
USB E: desbloqueado exitosamente: readonly removido del volumen E:
```

---

## 🔍 Comandos de Diagnóstico

### Verificar Estado Completo

```powershell
python check_status.py
```

### Ver Logs en Tiempo Real (ambos)

```powershell
# PowerShell 1: Logs del agente
Get-Content "C:\ProgramData\USBMonitor\agent.log" -Wait -Tail 20

# PowerShell 2: Logs del servicio
Get-Content "D:\Monitor_USB\usb_monitor.log" -Wait -Tail 20

# PowerShell 3: Crear señal
python test_agent.py
```

### Verificar Archivo de Señal en Tiempo Real

```powershell
# Monitorear cambios en el archivo
while ($true) {
    Clear-Host
    Write-Host "=== ESTADO DEL ARCHIVO DE SEÑAL ===" -ForegroundColor Cyan
    Write-Host "Timestamp: $(Get-Date -Format 'HH:mm:ss')" -ForegroundColor Gray
    Write-Host ""

    if (Test-Path "C:\ProgramData\USBMonitor\browser_signal.json") {
        Get-Content "C:\ProgramData\USBMonitor\browser_signal.json" | ConvertFrom-Json | Format-List
    } else {
        Write-Host "Archivo no existe" -ForegroundColor Yellow
    }

    Start-Sleep -Seconds 2
}
```

### Limpiar Todo y Empezar de Cero

```powershell
# 1. Detener agente (Ctrl+C si está en consola)

# 2. Limpiar archivos
Remove-Item "C:\ProgramData\USBMonitor\browser_signal.json" -ErrorAction SilentlyContinue
Remove-Item "C:\ProgramData\USBMonitor\agent.log" -ErrorAction SilentlyContinue

# 3. Reiniciar agente
python usb_monitor_agent.py
```

---

## ✅ Cambios Implementados

### 1. Ventana no se cierra

- **Antes:** `self.window.destroy()` cerraba la ventana permanentemente
- **Ahora:** `self.window.withdraw()` la oculta pero mantiene en memoria
- **Beneficio:** Puede reutilizarse para múltiples intentos de login

### 2. Mejor detección de señales

- **Escritura atómica:** Usa archivo temporal + rename para evitar lecturas parciales
- **Validación mejorada:** Verifica timestamp, processed, y estructura JSON
- **Logs detallados:** Muestra exactamente qué se está procesando

### 3. Prevención de duplicados

- **Ventana única:** Si ya hay una ventana abierta, se trae al frente
- **Timestamp único:** Cada señal tiene timestamp único
- **Marca antes de mostrar:** Marca como procesada ANTES de mostrar ventana

### 4. Thread separado

- **No bloqueante:** La ventana se crea en thread separado
- **Monitoreo continuo:** El agente sigue monitoreando mientras la ventana está abierta
- **Múltiples ventanas:** Puede manejar múltiples señales (aunque previene duplicados)

---

## 📊 Flujo de Señalización Mejorado

```
┌─────────────────────────────────────────────────┐
│ SERVICIO USB MONITOR                            │
├─────────────────────────────────────────────────┤
│ 1. Detecta USB conectado (E:)                   │
│ 2. Bloquea con diskpart                         │
│ 3. Crea archivo temporal (.tmp)                 │
│ 4. Escribe JSON con timestamp único             │
│ 5. Renombra .tmp → browser_signal.json          │
│ 6. Log: "Señal creada para agente"             │
└─────────────────────────────────────────────────┘
                    ↓
┌─────────────────────────────────────────────────┐
│ ARCHIVO DE SEÑAL                                │
├─────────────────────────────────────────────────┤
│ {                                               │
│   "timestamp": "2025-10-02T14:30:45",          │
│   "pc_name": "DESKTOP-ABC",                     │
│   "drive_letter": "E:",                         │
│   "processed": false                            │
│ }                                               │
└─────────────────────────────────────────────────┘
                    ↓
┌─────────────────────────────────────────────────┐
│ AGENTE (Monitoreo cada 2 segundos)              │
├─────────────────────────────────────────────────┤
│ 1. Lee archivo JSON                             │
│ 2. Valida: processed=false, timestamp nuevo     │
│ 3. Marca processed=true                         │
│ 4. Log: "Señal detectada: E:"                  │
│ 5. Crea thread para ventana                     │
│ 6. Log: "Señal marcada como procesada"         │
└─────────────────────────────────────────────────┘
                    ↓
┌─────────────────────────────────────────────────┐
│ VENTANA DE LOGIN                                │
├─────────────────────────────────────────────────┤
│ - Si existe, trae al frente                     │
│ - Si no, crea nueva                             │
│ - Al cancelar: withdraw() no destroy()          │
│ - Al éxito: withdraw() y libera referencia      │
└─────────────────────────────────────────────────┘
```

---

## 🎯 Verificación de Correcciones

### Verificar que la ventana no se cierra:

```powershell
# 1. Iniciar agente
python usb_monitor_agent.py

# 2. Crear señal
python test_agent.py  # Opción 1

# 3. Cuando aparezca la ventana, hacer clic en "Cancelar"

# Resultado esperado:
# - La ventana desaparece (withdraw)
# - El agente sigue corriendo
# - Se puede crear otra señal y la ventana aparece de nuevo
```

### Verificar que las señales se procesan:

```powershell
python test_agent.py  # Opción 4

# Resultado esperado:
# - Crea señal
# - Monitorea cada 5 segundos
# - Muestra "✅ ¡Señal procesada exitosamente!" cuando el agente la procesa
```

---

**Última actualización:** 2 de octubre de 2025  
**Versión:** 1.1.0 (con correcciones de señalización)
