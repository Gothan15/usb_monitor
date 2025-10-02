# 🚀 INICIO RÁPIDO - USB Monitor

## Instalación en 3 Pasos

### 1️⃣ Instalar Dependencias

```powershell
pip install -r requirements.txt
```

### 2️⃣ Ejecutar Instalador Completo (como Administrador)

```powershell
python setup_complete.py
```

El instalador:

- ✅ Verifica Python
- ✅ Instala dependencias
- ✅ Configura variables de entorno
- ✅ Instala el servicio de Windows
- ✅ Instala el agente de usuario
- ✅ Inicia ambos componentes

### 3️⃣ Probar el Sistema

**Opción A: Conectar un USB real**

1. Conecta una memoria USB
2. Observa que se bloquea automáticamente
3. Aparecerá la ventana de login
4. Introduce tus credenciales
5. La USB se desbloqueará

**Opción B: Simular señal (sin USB)**

```powershell
# Terminal 1: Asegúrate de que el agente está corriendo
python usb_monitor_agent.py

# Terminal 2: Simular señal
python test_agent.py
# Selecciona opción 1
```

---

## 📋 Instalación Manual (Avanzada)

Si prefieres instalar paso por paso:

### 1. Instalar Servicio

```powershell
python usb_monitor_service.py install
python usb_monitor_service.py start
```

### 2. Instalar Agente

```powershell
python install_agent.py install
python usb_monitor_agent.py
```

---

## ⚙️ Configuración del Servidor

Por defecto, el sistema se conecta a `172.20.10.12:3000`.

Para cambiar esto:

```powershell
# Temporalmente (sesión actual)
$env:USB_MONITOR_SERVER_HOST = "192.168.1.100"
$env:USB_MONITOR_SERVER_PORT = "8080"

# Permanentemente: Panel de Control > Sistema > Variables de entorno
```

---

## 🔍 Verificar Estado

### Servicio

```powershell
sc query USBMonitorService
```

### Agente

- Busca el icono "USB" en la bandeja del sistema (junto al reloj)

### Logs

```powershell
# Servicio
notepad D:\Monitor_USB\usb_monitor.log

# Agente
notepad C:\ProgramData\USBMonitor\agent.log
```

---

## 🛑 Detener/Desinstalar

### Desinstalación Rápida (Recomendada)

```powershell
# Mantener logs (recomendado para diagnóstico)
python setup_complete.py --uninstall

# O eliminar TODO incluyendo logs
python setup_complete.py --full-remove
```

### Detener Componentes

```powershell
# Detener servicio
python usb_monitor_service.py stop

# Detener agente (clic derecho en icono de bandeja > Salir)
```

### Desinstalación Manual

```powershell
# 1. Detener todo
python usb_monitor_service.py stop
# (Cerrar agente desde bandeja del sistema)

# 2. Desinstalar componentes
python usb_monitor_service.py remove
python install_agent.py uninstall

# 3. (Opcional) Limpiar archivos
Remove-Item -Path "D:\Monitor_USB" -Recurse -Force
Remove-Item -Path "C:\ProgramData\USBMonitor" -Recurse -Force
```

### Verificar Desinstalación

```powershell
# Verificar estado
python check_status.py

# O verificar servicio manualmente
sc query USBMonitorService
```

---

## 🔍 Verificar Estado del Sistema

```powershell
# Script completo de verificación
python check_status.py
```

Este comando muestra:

- ✅ Estado del servicio (instalado/corriendo)
- ✅ Estado del agente (instalado/corriendo)
- ✅ Archivos de log y su tamaño
- ✅ Dependencias instaladas
- ✅ Variables de entorno
- ✅ Últimas líneas de los logs

---

## 🛑 Detener/Desinstalar

### Detener Servicio

```powershell
python usb_monitor_service.py stop
```

### Detener Agente

- Clic derecho en el icono de la bandeja > Salir

### Desinstalar Todo

```powershell
python setup_complete.py --uninstall
```

---

## 🆘 Problemas Comunes

### "Error: No se puede conectar al servidor"

- ✅ Verifica que el backend está corriendo
- ✅ Verifica el host y puerto configurados
- ✅ Verifica el firewall

### "El agente no muestra la ventana"

- ✅ Verifica que el agente está corriendo (icono en bandeja)
- ✅ Revisa los logs del agente
- ✅ Prueba con `python test_agent.py`

### "El USB no se desbloquea"

- ✅ Verifica las credenciales en el backend
- ✅ Revisa los logs del servicio
- ✅ Verifica que el servicio puede ejecutar diskpart

---

## 📚 Más Información

- **Sistema completo**: `README.md`
- **Agente de usuario**: `README_AGENT.md`
- **Servicio**: Documentación en `usb_monitor_service.py`

---

## 💡 Consejos

1. **Ejecuta el servicio como SYSTEM** (se hace automáticamente al instalarlo como servicio)
2. **Mantén el agente corriendo** para que detecte las señales
3. **Configura variables de entorno permanentes** para no tener que configurarlas cada vez
4. **Revisa los logs regularmente** para detectar problemas

---

¡Listo! 🎉 Tu sistema USB Monitor está configurado y funcionando.
