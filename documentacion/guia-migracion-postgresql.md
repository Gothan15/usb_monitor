# Guía paso a paso: migración a PostgreSQL

> **Objetivo**: mover el proyecto USB Monitor desde SQLite (`db/custom.db`) a PostgreSQL conservando datos, scripts y despliegues.

Esta guía sigue un orden estricto de tareas. Ve marcando cada paso conforme lo completes.

## 🧭 Itinerario de alto nivel

1. Respaldar el estado actual de SQLite.
2. Provisionar PostgreSQL (local, Docker o gestionado).
3. Crear base de datos, usuario y permisos dedicados.
4. Actualizar variables de entorno (`.env`) y servicios Windows si aplican.
5. Ajustar Prisma (`schema.prisma`, migraciones, cliente).
6. Migrar datos (dump/import o pgloader).
7. Validar funcionamiento de la app, scripts CLI y servicios.
8. Depurar residuos (SQLite, tareas programadas, documentación).

Cada apartado trae comandos concretos y chequeos de verificación.

## ✅ Prerrequisitos imprescindibles

- **PostgreSQL 14+** instalado o accesible vía red.
- Usuario con permisos `CREATEDB` o acceso para crear esquemas.
- `psql` o una herramienta gráfica (pgAdmin, DBeaver) para ejecutar comandos.
- Node.js 18+, pnpm/npm y Prisma CLI (`npx prisma`).
- Copia de seguridad del archivo `db/custom.db` (SQLite actual) y de cualquier tabla auxiliar.
- Acceso a PowerShell 7+ (o Windows PowerShell 5.1) con permisos de administrador para instalar dependencias.
- (Opcional) Chocolatey o Winget para instalar `sqlite3`, `pgloader` u otras herramientas CLI.

> 💡 Mantén a mano las credenciales de la nueva instancia: host, puerto, base de datos, usuario y contraseña.

## Paso 0. Respaldar el estado actual

1. Copia el archivo SQLite y guárdalo fuera del repositorio:

```powershell
Copy-Item .\db\custom.db .\backups\custom-$(Get-Date -Format "yyyyMMdd-HHmm").db
```

2. Si hay servicios Windows (`USBMonitorService`), detén temporalmente la tarea programada o el servicio durante la migración para evitar escrituras en SQLite.

## Paso 1. Provisionar PostgreSQL

### Opción A. Instalación nativa en Windows

1. Descarga el instalador oficial desde <https://www.postgresql.org/download/windows/>.
2. Ejecuta como administrador, instala `PostgreSQL Server` y `Command Line Tools`.
3. Define contraseña para `postgres`, conserva puerto `5432` (o registra el nuevo).
4. Valida que el servicio `postgresql-x64-*` aparezca como **Running** en `services.msc`.

> 🛠️ Chocolatey: `choco install postgresql` (reinicia la terminal después).

### Paso 1.2. Configurar `psql` en el `PATH`

1. Ubica la carpeta `bin` creada por el instalador, por ejemplo `C:\Program Files\PostgreSQL\16\bin`.
2. Abre PowerShell **como administrador** y agrega la ruta a tu variable de entorno de usuario:

```powershell
[Environment]::SetEnvironmentVariable(
  "Path",
  "$([Environment]::GetEnvironmentVariable('Path', 'User'));C:\Program Files\PostgreSQL\16\bin",
  'User'
)
```

- Sustituye la ruta si instalaste otra versión o ubicación.

3. Cierra y vuelve a abrir tu terminal para que tome el nuevo `PATH`.
4. Verifica la configuración con:

```powershell
psql --version
```

Deberías ver la versión de PostgreSQL sin necesidad de escribir la ruta completa.

> 📌 Si prefieres un comando puntual sin modificar el `PATH`, ejecuta `"$Env:ProgramFiles\PostgreSQL\16\bin\psql.exe" -h localhost -U postgres` cada vez.

### Opción B. Instancia aislada con Docker

Si prefieres aislar la base de datos en un contenedor:

```powershell
docker run --name usb-postgres -e POSTGRES_PASSWORD=usb-secret -p 5432:5432 -d postgres:16
```

### Paso 1.1. Crear base de datos y usuario de aplicación

Conéctate como superusuario (ej. `postgres`):

```powershell
psql -h localhost -U postgres
```

Ya dentro de la consola interactiva, crea la base y el usuario de la aplicación:

```sql
CREATE DATABASE usb_monitor;
CREATE USER usb_app WITH ENCRYPTED PASSWORD 'cambia-esta-contraseña';
GRANT ALL PRIVILEGES ON DATABASE usb_monitor TO usb_app;
```

> En producción define contraseñas robustas, roles separados y SSL/TLS según la plataforma.

> Para salir de la consola `psql`, escribe `\q` y presiona Enter.

## Paso 2. Configurar variables de entorno

1. Duplica `.env.example` si aún no existe `.env` (ejemplo rápido desde PowerShell: `Copy-Item .env.example .env`).
2. Actualiza `DATABASE_URL` con la cadena de PostgreSQL. Si usas Visual Studio Code, puedes abrir el archivo con `code .env`; en PowerShell: `notepad .env`:

```env
DATABASE_URL="postgresql://usb_app:cambia-esta-contraseña@localhost:5432/usb_monitor?schema=public"
```

3. (Recomendado) Usa base shadow para migraciones seguras:

```env
SHADOW_DATABASE_URL="postgresql://usb_app:cambia-esta-contraseña@localhost:5432/usb_monitor_shadow?schema=public"
```

Si `psql` no está en el `PATH`, usa la ruta completa, por ejemplo: `"$Env:ProgramFiles\PostgreSQL\16\bin\psql.exe"`.

> 📌 Si necesitas que la variable quede disponible a nivel de usuario en Windows (por ejemplo para tareas programadas), puedes ejecutarla con `setx DATABASE_URL "postgresql://..."` y reiniciar la terminal. Para el proyecto basta con mantenerla en `.env`.

> 📌 Si despliegas en producción, propaga estas variables a tu orquestador (Docker, servicios Windows, CI/CD).

## Paso 3. Ajustar `prisma/schema.prisma`

1. Abre `prisma/schema.prisma` y modifica el bloque `datasource`:

```prisma
datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
  shadowDatabaseUrl = env("SHADOW_DATABASE_URL") // opcional en entornos locales
}
```

3. Guarda el archivo.

> ⚠️ Mantén el historial de migraciones. Sólo ajusta migraciones pasadas si contienen SQL específico de SQLite.

## Paso 4. Generar y aplicar migraciones

### Escenario A. Proyecto nuevo (sin datos previos)

Si no necesitas traer datos históricos:

```powershell
npm run db:migrate -- --name init-postgres
npm run db:generate
```

Esto creará las tablas en la base Postgres y regenerará el cliente de Prisma.

### Escenario B. Migración con datos existentes

1. **Congela escrituras** en SQLite (detén servicios, tareas y sesiones `npm run dev`).
2. Genera el script de diferencias (desde la raíz del repo):

```powershell
npx prisma migrate diff --from-url "file:./db/custom.db" --to-url "$Env:DATABASE_URL" --script > prisma/migrations/sqlite-to-postgres.sql
```

3. Revisa el archivo generado y ejecútalo en PostgreSQL (ajusta la ruta de `psql` si es necesario):

```powershell
psql "$Env:DATABASE_URL" -f .\prisma\migrations\sqlite-to-postgres.sql
```

4. (Opcional) Registra una migración Prisma para entornos limpios:

```powershell
npx prisma migrate dev --name init-postgres
```

> 🛡️ No borres el dump ni el `.db` original hasta completar los chequeos del Paso 7.

## Paso 5. Migrar los datos

### Paso 5.1. Exportar desde SQLite

```powershell
# Directo con sqlite3 instalado en Windows (chocolatey) o WSL
# Si no tienes sqlite3, instálalo con: choco install sqlite
sqlite3 .\db\custom.db ".mode insert" ".output sqlite_dump.sql" ".dump"
```

### Paso 5.2. Importar en PostgreSQL

Limpia el dump eliminando instrucciones `PRAGMA` y `sqlite_sequence` si es necesario.

Luego:

```powershell
psql "$Env:DATABASE_URL" -f .\sqlite_dump.sql
```

Alternativas:

- Usa [pgloader](https://pgloader.readthedocs.io/en/latest/) para automatizar la conversión con (disponible en WSL o instalable con Chocolatey):
  ```powershell
  pgloader sqlite:///d:/Monitor_USB/db/custom.db $Env:DATABASE_URL
  ```
- Exporta e importa con una herramienta GUI (DBeaver soporta ambos motores).

> ✅ Revisa que índices (`@@index`) y nombres mapeados (`@@map`) sigan intactos.

## Paso 6. Validaciones post-migración

1. Ejecuta migraciones y renueva cliente Prisma:

```powershell
npm run db:migrate
npm run db:generate
```

2. Abre Prisma Studio y verifica tablas/relaciones:

```powershell
npx prisma studio
```

3. Levanta la app en desarrollo y revisa logs de Prisma:

```powershell
npm run dev
```

Observa la consola; Prisma mostrará la URL de conexión utilizada.

> 🔍 Confirma servicio activo con `Get-Service postgresql*`. Reinicia con `Restart-Service postgresql-x64-16` (ajusta versión).

## Paso 7. Ajustes y limpieza

- **Scripts CLI** (`scripts/*.ts`): se alimentan del mismo `DATABASE_URL`. Comprueba que `npm run user:*` funciona con Postgres.
- **Backups**: define una política de respaldo para Postgres (pg_dump, snapshots).
- Para respaldos manuales en Windows puedes usar: `pg_dump "$Env:DATABASE_URL" --file backup.sql` (usa la ruta completa al binario si no está en el `PATH`).
- **Monitorización**: añade health-checks si usas Postgres gestionado o de terceros.
- **Eliminar SQLite**: cuando verifiques que todo funciona, archiva o elimina `db/custom.db` y los backups generados.

## ✅ Lista de verificación final

- [ ] `.env` actualizado con `DATABASE_URL` de PostgreSQL (y `SHADOW_DATABASE_URL` opcional).
- [ ] `schema.prisma` apunta a `provider = "postgresql"`.
- [ ] Migraciones aplicadas sin errores.
- [ ] Datos importados y visibles en Prisma Studio.
- [ ] Aplicación (`npm run dev` o despliegue) funciona contra PostgreSQL.
- [ ] Backups confirmados y política de mantenimiento definida.

## ❓ Preguntas frecuentes

**¿Puedo mantener SQLite para desarrollo?**

> Puedes, pero mantendrás dos proveedores. Si prefieres simplicidad, usa Postgres tanto en desarrollo como en producción (con Docker, por ejemplo).

**¿Necesito regenerar el cliente Prisma?**

> Sí. Cada cambio de proveedor o esquema requiere `npm run db:generate` para evitar errores en tiempo de ejecución.

**¿Qué pasa si mis migraciones previas estaban basadas en SQLite?**

> Prisma recalculará el historial; solo asegúrate de que el estado inicial en Postgres se cree mediante `migrate dev` o `migrate deploy`. Si algún SQL específico de SQLite quedó en migraciones antiguas, ajusta manualmente.

---

🚀 Con esto tu sistema quedará listo para operar sobre PostgreSQL con mayor robustez y herramientas de administración avanzadas.
