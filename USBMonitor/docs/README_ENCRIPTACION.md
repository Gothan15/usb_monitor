# USB Monitor Service - Guía de Encriptación de API Key

## 🔐 Seguridad Mejorada

A partir de esta versión, el USB Monitor Service incluye encriptación automática de la API key cuando se configura desde la interfaz gráfica.

## 🚀 Inicio Rápido

### 1. Instalar Dependencias

Ejecuta el script de instalación como **Administrador**:

```powershell
.\install_dependencies.ps1
```

Este script instalará:

- pywin32
- wmi
- requests
- **cryptography** (nueva dependencia para encriptación)

### 2. Configurar API Key (Encriptada)

1. Abre la GUI como administrador:

   ```powershell
   python usb_monitor_service.py gui
   ```

2. Haz clic en **"Configurar API key del backend"**

3. Selecciona un usuario de la lista

4. Confirma la operación

✨ **La API key se encriptará automáticamente** y se almacenará de forma segura en la variable de entorno del sistema.

### 3. Verificar Encriptación

```powershell
# Ver la API key encriptada
[System.Environment]::GetEnvironmentVariable('USB_MONITOR_API_KEY', 'Machine')
```

Deberías ver algo como: `ENC:gAAAAABh...` (el prefijo `ENC:` indica que está encriptada)

### 4. Usar el Toggle de Inicio Automático

En la GUI verás:

- **Estado actual**: "Inicio automático: ✓ Activado" o "✗ Desactivado"
- **Botón**: "Alternar inicio automático"

Cada vez que hagas clic, cambiará entre automático y manual.

## 🔧 Cómo Funciona

### Proceso de Encriptación

1. **Identificador único**: Se obtiene el UUID del hardware de la máquina
2. **Derivación de clave**: Se usa PBKDF2 con 100,000 iteraciones y SHA-256
3. **Encriptación**: Se usa Fernet (AES-128 en modo CBC)
4. **Almacenamiento**: Se guarda con el prefijo `ENC:` en la variable de entorno

### Proceso de Desencriptación

1. El servicio lee `USB_MONITOR_API_KEY`
2. Detecta el prefijo `ENC:` y la desencripta automáticamente
3. Usa la API key desencriptada para autenticar las peticiones HTTP

## ⚠️ Importante

### Portabilidad

❌ Una API key encriptada en una máquina **NO funcionará en otra**

- La encriptación está atada al hardware de la máquina
- Si mueves el servicio a otra computadora, debes reconfigurar la API key

### Compatibilidad

✅ **API keys antiguas (sin encriptar) siguen funcionando**

- El sistema detecta automáticamente si una key está encriptada o no
- No es necesario migrar las configuraciones existentes
- Puedes actualizar gradualmente

### Sin cryptography

Si por alguna razón no puedes instalar `cryptography`:

- El servicio seguirá funcionando
- Las API keys se almacenarán sin encriptar
- Verás un warning en los logs

## 📝 Comandos Útiles

### Ver API Key Actual

```powershell
[System.Environment]::GetEnvironmentVariable('USB_MONITOR_API_KEY', 'Machine')
```

### Verificar Estado del Servicio

```powershell
Get-Service USBMonitorService
```

### Ver Configuración de Inicio Automático

```powershell
Get-Service USBMonitorService | Select-Object Name, StartType, Status
```

### Cambiar a Inicio Automático (manual)

```powershell
Set-Service -Name USBMonitorService -StartupType Automatic
```

### Cambiar a Inicio Manual (manual)

```powershell
Set-Service -Name USBMonitorService -StartupType Manual
```

## 🐛 Solución de Problemas

### La API key no funciona después de encriptar

**Solución 1**: Reinicia el servicio

```powershell
net stop USBMonitorService
net start USBMonitorService
```

**Solución 2**: Reconfigura la API key desde la GUI

### Error: "Cryptography no disponible"

```powershell
pip install cryptography
```

### La API key se encriptó en otra máquina

No hay forma de trasladarla. Debes:

1. Abrir la GUI en la nueva máquina
2. Reconfigurar la API key seleccionando un usuario

### El toggle de inicio automático no funciona

Verifica que:

1. Estás ejecutando la GUI como **Administrador**
2. El servicio está instalado (si no, instálalo primero)

## 📊 Ejemplo de Logs

### Encriptación Exitosa

```
2025-11-08 10:30:15 | INFO | GUI: se solicitó actualizar API key para usuario admin
2025-11-08 10:30:15 | INFO | setx stdout: SUCCESS: Specified value was saved.
2025-11-08 10:30:15 | INFO | API key configurada para admin.
```

### Desencriptación en el Servicio

```
2025-11-08 10:31:20 | INFO | ╔════════════════════════════════════════════════════════════╗
2025-11-08 10:31:20 | INFO | ║        SERVICIO USB MONITOR INICIADO                      ║
2025-11-08 10:31:20 | INFO | ╚════════════════════════════════════════════════════════════╝
2025-11-08 10:31:20 | INFO | Configuración inicial | frozen=True | destino=172.20.10.12:3000 | endpoint=/api/usb-event | puerto_http=5001 | api_key=sí
```

## 🔒 Mejores Prácticas

1. **Siempre ejecuta la GUI como administrador** para configurar la API key
2. **Reinicia el servicio** después de cambiar la API key
3. **No compartas** el valor encriptado entre máquinas
4. **Mantén actualizado** el módulo cryptography
5. **Usa el toggle** para cambiar el inicio automático fácilmente

## 📚 Referencias

- [Documentación completa](./ENCRIPTACION_APIKEY.md)
- [Cryptography documentation](https://cryptography.io/)
- [PBKDF2](https://en.wikipedia.org/wiki/PBKDF2)
- [Fernet](https://cryptography.io/en/latest/fernet/)
