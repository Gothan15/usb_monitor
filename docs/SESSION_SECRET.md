**Generar y gestionar `SESSION_SECRET`**

- **Descripción**: `SESSION_SECRET` es la clave usada por la aplicación para firmar cookies o tokens de sesión. Debe ser un valor aleatorio, de longitud adecuada (recomendado 32 bytes = 256 bits) y mantenerse privado.

**Formatos recomendados**

- **Base64 (recomendado)**: compacta y aceptada por la mayoría de librerías. Puede contener `+`, `/` y `=`.
- **Hex (alternativa)**: solo usa [0-9a-f], evita símbolos. Para 32 bytes, son 64 caracteres hex.

**Comandos (PowerShell — Windows, tu shell por defecto)**

- Generar 32 bytes y mostrar Base64:

```powershell
$bytes = New-Object byte[] 32
[System.Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($bytes)
[Convert]::ToBase64String($bytes)
```

- Generar 32 bytes y mostrar Hex (64 caracteres):

```powershell
$bytes = New-Object byte[] 32
[System.Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($bytes)
($bytes | ForEach-Object { "{0:x2}" -f $_ }) -join ''
```

**Alternativas (si prefieres otras herramientas)**

- Node (Base64):

```powershell
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
```

- Node (hex):

```powershell
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

- OpenSSL (si está instalado):

```powershell
openssl rand -base64 32
# o
openssl rand -hex 32
```

**Actualizar `d:\Monitor_USB\.env` (pasos seguros)**

1. Hacer copia de seguridad del archivo `.env` antes de cambiarlo:

```powershell
Copy-Item d:\Monitor_USB\.env d:\Monitor_USB\.env.bak
```

2. Generar el secret y reemplazar la línea existente `SESSION_SECRET=` (ejemplo con Base64):

```powershell
# Genera y guarda en $secret
$bytes = New-Object byte[] 32; [System.Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($bytes); $secret = [Convert]::ToBase64String($bytes)
# Reemplaza la línea en el .env
(Get-Content d:\Monitor_USB\.env) | ForEach-Object { if ($_ -match '^SESSION_SECRET=') { "SESSION_SECRET=$secret" } else { $_ } } | Set-Content d:\Monitor_USB\.env
```

3. Si no existe la variable y quieres añadirla al final:

```powershell
$bytes = New-Object byte[] 32; [System.Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($bytes); $secret = [Convert]::ToBase64String($bytes)
Add-Content d:\Monitor_USB\.env "SESSION_SECRET=$secret"
```

**Notas y buenas prácticas**

- Base64 puede incluir `=` al final (padding). Esto es normal y, en la mayoría de setups, funciona bien sin comillas. Si tu herramienta requiere, puedes envolver el valor entre comillas: `SESSION_SECRET="..."`.
- Reinicia la aplicación después de cambiar `SESSION_SECRET` para que el nuevo valor sea usado.
- Si hay sesiones activas, cambiar el secreto invalidará cookies/ sesiones existentes.
- Guarda el `.env.bak` en un lugar seguro o bórralo si no lo necesitas. No publiques el secreto en repositorios públicos.

**Ejemplo tomado del repositorio**
En `d:\Monitor_USB\.env` existe actualmente una entrada (ejemplo):

```
SESSION_SECRET=0bWv2Z8cC1OfpI3OaPv5ce1q-VE8MOd1keZ60vpx5Js
```

Si consideras que ese valor está comprometido o quieres rotarlo, sigue los pasos de copia de seguridad y reemplazo mostrados arriba.

**Comprobación rápida**

- Después de reiniciar la app, comprueba que la aplicación arranca sin errores y que las nuevas sesiones funcionan.

¿Quieres que genere yo el secret ahora y lo inserte automáticamente en `d:\Monitor_USB\.env` (haré copia de seguridad primero)?
