# Encriptación de API Key - Documentación

## Resumen de Cambios

Se ha implementado un sistema de encriptación para proteger la API key del servicio USB Monitor cuando se configura desde la interfaz gráfica (GUI).

## Características Implementadas

### 1. Encriptación de API Key

- **Algoritmo**: Fernet (criptografía simétrica de alto nivel)
- **Derivación de clave**: PBKDF2 con SHA-256
- **Identificador único**: UUID de la máquina o hostname+computername como fallback
- **Formato**: Las API keys encriptadas se almacenan con el prefijo `ENC:` para identificarlas

### 2. Funciones Principales

#### `get_machine_identifier() -> bytes`

Obtiene un identificador único de la máquina basándose en:

- UUID del hardware (vía WMI)
- Fallback: hostname + COMPUTERNAME

#### `get_encryption_key() -> bytes`

Genera una clave de encriptación derivada del identificador de la máquina usando:

- PBKDF2 con 100,000 iteraciones
- SHA-256 como algoritmo de hash
- Salt fijo: `USBMonitor_Salt_V1`

#### `encrypt_api_key(api_key: str) -> str`

Encripta una API key para almacenamiento seguro:

- Input: API key en texto plano
- Output: `ENC:{datos_encriptados}` si tiene cryptography instalado
- Fallback: Retorna la API key sin encriptar si cryptography no está disponible

#### `decrypt_api_key(encrypted_api_key: str) -> str`

Desencripta una API key almacenada:

- Detecta automáticamente si la key está encriptada (prefijo `ENC:`)
- Si no está encriptada, la retorna tal cual (compatibilidad con keys antiguas)
- Manejo robusto de errores de desencriptación

### 3. Toggle de Inicio Automático

Se implementó un sistema de toggle para el inicio automático del servicio:

#### `_get_service_autostart_status() -> Tuple[bool, Optional[int]]`

Consulta el estado actual del inicio automático del servicio.

#### `_toggle_service_autostart() -> Tuple[bool, str]`

Alterna el estado de inicio automático:

- Si está en **automático** → cambia a **manual**
- Si está en **manual** → cambia a **automático**

### 4. Mejoras en la GUI

- **Indicador de estado**: Muestra si el inicio automático está activado o desactivado
- **Botón actualizado**: "Alternar inicio automático" (antes "Configurar inicio automático")
- **Actualización automática**: El estado se actualiza cada 5 segundos y al ejecutar comandos

## Flujo de Uso

### Configuración de API Key (GUI)

1. Usuario abre la GUI como administrador
2. Hace clic en "Configurar API key del backend"
3. Selecciona un usuario de la lista
4. La API key se **encripta automáticamente** antes de guardarla en la variable de entorno
5. Se almacena en `USB_MONITOR_API_KEY` con el prefijo `ENC:`

### Uso de API Key (Servicio)

1. El servicio lee la variable de entorno `USB_MONITOR_API_KEY`
2. La función `get_auth_headers()` detecta si está encriptada (prefijo `ENC:`)
3. **Desencripta automáticamente** la API key antes de usarla
4. La incluye en las peticiones HTTP con el header `Authorization: ApiKey {key_desencriptada}`

### Toggle de Inicio Automático

1. Usuario hace clic en "Alternar inicio automático"
2. El sistema consulta el estado actual
3. Si está activado → lo desactiva (cambia a manual)
4. Si está desactivado → lo activa (cambia a automático)
5. El indicador se actualiza mostrando el nuevo estado

## Requisitos

### Dependencias Nuevas

```bash
pip install cryptography
```

### Compatibilidad

- **Sin cryptography instalado**: Las API keys se almacenan sin encriptar (fallback automático)
- **Con API keys antiguas**: Se detectan automáticamente y se usan sin desencriptar
- **Migración**: No es necesaria, el sistema es compatible con ambos formatos

## Seguridad

### Fortalezas

1. **Encriptación local**: La clave se deriva del hardware de la máquina
2. **No se almacenan claves maestras**: La clave de encriptación se regenera cada vez
3. **Prefijo identificador**: Fácil distinción entre keys encriptadas y no encriptadas
4. **Manejo de errores**: Si falla la desencriptación, se registra el error sin romper el servicio

### Consideraciones

1. **Portabilidad limitada**: Una API key encriptada en una máquina no funciona en otra
2. **Protección contra acceso local**: Si un atacante tiene acceso administrador local, puede desencriptar
3. **Salt fijo**: En producción, considerar usar un salt dinámico por instalación

## Logging

El sistema registra los siguientes eventos:

- Intentos de encriptación/desencriptación
- Errores de encriptación (sin romper la funcionalidad)
- Warnings cuando cryptography no está disponible
- Estado del inicio automático al alternar

## Pruebas

### Verificar Encriptación

1. Configura una API key desde la GUI
2. Verifica la variable de entorno:
   ```powershell
   [System.Environment]::GetEnvironmentVariable('USB_MONITOR_API_KEY', 'Machine')
   ```
3. Debe empezar con `ENC:`

### Verificar Desencriptación

1. Reinicia el servicio USB Monitor
2. Revisa los logs en `C:\ProgramData\USBMonitor\usb_monitor_service.log`
3. El servicio debe enviar peticiones HTTP exitosamente

### Verificar Toggle

1. Abre la GUI
2. Observa el indicador "Inicio automático: ✓ Activado" o "✗ Desactivado"
3. Haz clic en "Alternar inicio automático"
4. El indicador debe cambiar de estado

## Migración de Versiones Anteriores

No es necesaria ninguna acción manual:

1. Las API keys antiguas (sin encriptar) siguen funcionando
2. La próxima vez que se configure una API key desde la GUI, se encriptará automáticamente
3. Para encriptar una API key existente:
   - Abre la GUI
   - Vuelve a seleccionar el mismo usuario
   - Confirma la operación

## Solución de Problemas

### Error: "Cryptography no disponible"

**Solución**: Instala el módulo

```powershell
pip install cryptography
```

### Error al desencriptar API key

**Posibles causas**:

1. La API key se encriptó en otra máquina
2. El identificador de la máquina cambió

**Solución**: Reconfigura la API key desde la GUI

### El servicio no puede autenticar

**Verificar**:

1. La variable de entorno existe:
   ```powershell
   [System.Environment]::GetEnvironmentVariable('USB_MONITOR_API_KEY', 'Machine')
   ```
2. El servicio se reinició después de configurar la API key
3. Los logs del servicio para ver errores de desencriptación

## Código de Ejemplo

### Uso Manual de las Funciones

```python
# Encriptar una API key
from usb_monitor_service import encrypt_api_key, decrypt_api_key

api_key_plain = "mi-api-key-secreta"
api_key_encrypted = encrypt_api_key(api_key_plain)
print(f"Encriptada: {api_key_encrypted}")  # ENC:...

# Desencriptar
api_key_decrypted = decrypt_api_key(api_key_encrypted)
print(f"Desencriptada: {api_key_decrypted}")  # mi-api-key-secreta
```

## Changelog

### Versión 1.0.0

- ✅ Implementación inicial de encriptación con Fernet
- ✅ Funciones de encriptación/desencriptación
- ✅ Integración con `run_setx()` y `get_auth_headers()`
- ✅ Toggle de inicio automático
- ✅ Indicador visual del estado de inicio automático en GUI
- ✅ Compatibilidad con API keys antiguas sin encriptar
- ✅ Fallback cuando cryptography no está disponible
