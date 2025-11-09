# Guía paso a paso de los scripts (`scripts/`)

## 1. Requisitos previos

1. Instala **Node.js 18+** y **Python 3.11+**.
2. Ejecuta `npm install` en la raíz del proyecto para bajar dependencias.
3. Verifica que la base de datos esté corriendo y que tus variables de entorno (`DATABASE_URL` o equivalentes) apunten a la instancia correcta.
4. Para los scripts Python instala: `pip install requests psycopg[binary] psycopg2-binary` (puedes usar un entorno virtual).
5. Abre PowerShell en `d:\Monitor_USB`. Cuando veas comandos `npm run ...` son alias definidos en `package.json`. Si el alias no existe, ejecuta `npx tsx scripts/<script>.ts` o `python scripts/<script>.py` según corresponda.

## 2. Scripts TypeScript (usando `tsx`)

### 2.1 `createUser.ts`

- **Objetivo**: Crear un usuario nuevo, opcionalmente con API key propia y computadora asignada.
- **Uso**:
  ```powershell
  npm run user:create -- <usuario> <password> [apiKey] [rol] [computerName]
  ```
- **Pasos**:
  1. Lanza el comando con los argumentos obligatorios (`usuario`, `password`).
  2. Si defines `rol`, sólo acepta `admin` o `user`; si indicas computadora, debe existir en la base de datos.
  3. Verifica la salida `CREATED ...`. Cualquier código de salida distinto de `0` indica un error (usuario duplicado, computadora inexistente, etc.).

### 2.2 `assignComputer.ts`

- **Objetivo**: Asignar una computadora existente a un usuario ya creado.
- **Uso**:
  ```powershell
  npm run user:assign-computer -- <usuario> <computerName>
  ```
- **Pasos**:
  1. Ejecuta el comando con el usuario y la computadora objetivo.
  2. Si la computadora no existe, el script listará las disponibles; crea o selecciona la correcta antes de reintentar.
  3. Asegúrate de ver el mensaje `SUCCESS ...`; si el usuario ya tenía computadora, se indicará la anterior.

### 2.3 `deleteUser.ts`

- **Objetivo**: Eliminar un usuario por `username` o por `id`.
- **Usos válidos**:
  ```powershell
  npm run user:delete -- --username <usuario>
  npm run user:delete -- --id <id>
  npm run user:delete -- <usuario>
  ```
- **Pasos**:
  1. Elige **un solo** identificador (username _o_ id).
  2. Ejecuta el comando. Si el usuario existe, verás `DELETED id username`.
  3. Si aparece "Usuario no encontrado" revisa el identificador proporcionado.

### 2.4 `listUsers.ts`

- **Objetivo**: Listar usuarios con su API key, rol y computadora asignada.
- **Uso**:
  ```powershell
  npm run user:list
  ```
- **Pasos**:
  1. Ejecuta el comando.
  2. Revisa la tabla generada (formato `console.table`). Incluye computadora, IP y estado cuando hay asignación.
  3. Úsalo tras crear, borrar o rotar llaves para validar cambios.

### 2.5 `rotateApiKey.ts`

- **Objetivo**: Generar una nueva API key para un usuario.
- **Usos válidos**:
  ```powershell
  npm run user:rotate-key -- <usuario>
  npm run user:rotate-key -- --username <usuario>
  npm run user:rotate-key -- --id <id>
  ```
- **Pasos**:
  1. Ejecuta el comando indicando username **o** id.
  2. Copia la nueva API key mostrada en `ROTATED ...`.
  3. Reconfigura los servicios que dependan de esa llave (por ejemplo, usando `setApiKeyRemote.ts` o el GUI).

### 2.6 `listComputers.ts`

- **Objetivo**: Mostrar todas las computadoras registradas.
- **Uso**:
  ```powershell
  npm run computer:list
  ```
- **Pasos**:
  1. Ejecuta el comando y revisa nombre, IP, estado del servicio y fecha `lastSeen`.
  2. Usa la lista de usuarios asignados para validar despliegues.
  3. Útil para auditar equipos inactivos o sin servicio.

### 2.7 `debugListUsers.ts`

- **Objetivo**: Obtener un volcado simple de usuarios para depuración.
- **Uso**:
  ```powershell
  npx tsx scripts/debugListUsers.ts
  ```
- **Pasos**:
  1. Ejecuta el script.
  2. Revisa la salida `USERS_DEBUG [...]` en JSON. Ideal cuando necesitas inspeccionar datos sin formato tabular.

### 2.8 `updateComputerIP.ts`

- **Objetivo**: Actualizar la IP asociada a una computadora.
- **Uso**:
  ```powershell
  npx tsx scripts/updateComputerIP.ts <computerName> <nuevaIP>
  ```
- **Pasos**:
  1. Proporciona nombre de la computadora y la nueva IP.
  2. Verifica el mensaje `✅ IP actualizada ...`.
  3. Toma nota de la URL sugerida `http://<nuevaIP>:5001` para el backend.

### 2.9 `getApiKey.ts`

- **Objetivo**: Obtener la API key del primer usuario asignado a una computadora.
- **Uso**:
  ```powershell
  npx tsx scripts/getApiKey.ts <computerName>
  ```
  (si no das nombre usa `GWINTBLEIDD` por defecto)
- **Pasos**:
  1. Ejecuta el comando.
  2. Si la computadora no existe, el script listará las válidas.
  3. Cuando haya usuarios asignados, copia la API key y sigue las instrucciones para configurar el servicio (`setx ...` + reinicio).

### 2.10 `setApiKeyRemote.ts`

- **Objetivo**: Configurar la API key en la máquina remota (manual o vía WinRM).
- **Uso manual** (sólo instrucciones):
  ```powershell
  npx tsx scripts/setApiKeyRemote.ts <computerName>
  ```
- **Uso automático vía WinRM**:
  ```powershell
  npx tsx scripts/setApiKeyRemote.ts <computerName> <hostname> <username> <password>
  ```
- **Pasos**:
  1. Ejecuta el modo que prefieras.
  2. Si usas WinRM, confirma que esté habilitado y que las credenciales sean válidas.
  3. Tras éxito (manual o automático) reinicia el servicio con `net stop USBMonitorService` y `net start USBMonitorService`.

### 2.11 `updateUserRoles.ts`

- **Objetivo**: Forzar roles (`admin` para usuario "admin" y `user` para el resto).
- **Uso**:
  ```powershell
  npx tsx scripts/updateUserRoles.ts
  ```
- **Pasos**:
  1. Ejecuta el script.
  2. Revisa el log para ver cuántos usuarios se actualizaron.
  3. Útil después de migraciones donde el campo `role` quedó vacío.

## 3. Scripts Python

### 3.1 `configure_api_key_gui.py`

- **Objetivo**: GUI que permite elegir usuario y aplicar su API key como variable de entorno de sistema.
- **Uso**:
  ```powershell
  python scripts/configure_api_key_gui.py
  ```
- **Pasos**:
  1. Ejecuta la consola como **Administrador** (necesario para `setx ... /M`).
  2. Selecciona un usuario en la tabla y confirma la acción.
  3. Tras el mensaje de éxito, reinicia manualmente el servicio `USBMonitorService`.

### 3.2 `check_whitelist_serial.py`

- **Objetivo**: Diagnosticar si un serial está autorizado en la whitelist, comparando API y base de datos.
- **Uso**:
  ```powershell
  python scripts/check_whitelist_serial.py
  ```
  (usa el serial definido en `TEST_SERIAL`; edítalo si necesitas otro)
- **Pasos**:
  1. Asegúrate de tener configuradas las variables de entorno esperadas por el servicio (`USB_MONITOR_API_KEY`, `DATABASE_*`).
  2. Ejecuta el script: primero consulta la API, luego, si es necesario, ejecuta un `psql` directo.
  3. Sigue el diagnóstico final para tomar acciones (agregar a whitelist, arreglar backend, etc.).

## 4. Flujos recomendados

1. **Rotar API key y aplicarla**:

   1. `npm run user:rotate-key -- <usuario>`
   2. `npx tsx scripts/setApiKeyRemote.ts <computerName> [hostname user password]` _o_ `python scripts/configure_api_key_gui.py`
   3. Reinicia el servicio remoto/local después de aplicar la nueva llave.

2. **Alta y asignación de usuario nuevo**:

   1. `npm run user:create -- <usuario> <password> [rol] [computerName]`
   2. `npm run user:assign-computer -- <usuario> <computerName>` (si no se indicó en el paso anterior)
   3. `npm run user:list` para validar.

3. **Auditoría periódica**:
   1. `npm run computer:list`
   2. `npm run user:list`
   3. `npx tsx scripts/debugListUsers.ts` si necesitas detalles crudos.

## 5. Notas finales

- Todos los scripts TypeScript usan la instancia Prisma definida en `src/lib/db`. Si cambias la cadena de conexión asegúrate de regenerar el cliente (`npm run db:generate`).
- Maneja las API keys con cuidado; evita exponerlas en logs compartidos.
- Tras cualquier operación crítica considera registrar en tu bitácora interna la fecha, cambios y responsable.
