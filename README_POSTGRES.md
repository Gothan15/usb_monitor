# Guía de migración a PostgreSQL

> **Objetivo**: pasar la base de datos del sistema USB Monitor de SQLite a PostgreSQL manteniendo la integridad de los datos y el flujo de trabajo con Prisma.

## 🧭 Resumen del proceso

1. Preparar una instancia de PostgreSQL accesible en Windows (servicio local, Docker o servicio gestionado).
2. Crear la base de datos, el usuario y otorgar permisos.
3. Actualizar las variables de entorno (`.env`) con la cadena de conexión nueva.
4. Cambiar el `datasource` de Prisma a `provider = "postgresql"`.
5. Generar y aplicar migraciones para PostgreSQL.
6. Migrar los datos existentes desde SQLite.
7. Verificar la aplicación y adaptar scripts/automatizaciones.

Cada sección detalla comandos concretos y notas de validación.

## ✅ Prerrequisitos

- **PostgreSQL 14+** instalado o accesible vía red.
- Usuario con permisos `CREATEDB` o acceso para crear esquemas.
- `psql` o una herramienta gráfica (pgAdmin, DBeaver) para ejecutar comandos.
- Node.js 18+, pnpm/npm y Prisma CLI (`npx prisma`).
- Copia de seguridad del archivo `db/custom.db` (SQLite actual).
- Acceso a PowerShell 7+ (o Windows PowerShell 5.1) con permisos de administrador para instalar dependencias.
- (Opcional) Chocolatey o Winget para instalar `sqlite3`, `pgloader` u otras herramientas CLI.

> 💡 Mantén a mano las credenciales de la nueva instancia: host, puerto, base de datos, usuario y contraseña.

## 1. Preparar PostgreSQL

### 1.1. Instalar PostgreSQL en Windows

1. Descarga el instalador oficial desde [https://www.postgresql.org/download/windows/](https://www.postgresql.org/download/windows/).
2. Ejecuta el instalador **como administrador** y selecciona los componentes `PostgreSQL Server` y `Command Line Tools`.
3. Define una contraseña para el usuario `postgres` (superusuario por defecto) y deja el puerto predeterminado `5432` a menos que esté ocupado.
4. Finaliza la instalación y confirma que el servicio `postgresql-x64-*` aparece como **En ejecución** en `services.msc`.

> 🛠️ Alternativa rápida: si usas Chocolatey, puedes instalarlo con `choco install postgresql` (recuerda reiniciar PowerShell para que se actualicen las variables de entorno).

### 1.2. Instancia local con Docker (opcional)

Si prefieres aislar la base de datos en un contenedor:

```powershell
docker run --name usb-postgres -e POSTGRES_PASSWORD=usb-secret -p 5432:5432 -d postgres:16
```

### 1.3. Preparar base de datos y usuario

Conéctate como superusuario (por ejemplo `postgres`) desde PowerShell:

```powershell
psql -h localhost -U postgres
```

Ya dentro de la consola interactiva, crea la base y el usuario de la aplicación:

```sql
CREATE DATABASE usb_monitor;
CREATE USER usb_app WITH ENCRYPTED PASSWORD 'cambia-esta-contraseña';
GRANT ALL PRIVILEGES ON DATABASE usb_monitor TO usb_app;
```

En entornos productivos, crea un usuario distinto para tareas administrativas y usa políticas de contraseñas seguras.

> Para salir de la consola `psql`, escribe `\q` y presiona Enter.

## 2. Configurar variables de entorno

1. Duplica `.env.example` si aún no existe `.env` (ejemplo rápido desde PowerShell: `Copy-Item .env.example .env`).
2. Actualiza `DATABASE_URL` con la cadena de PostgreSQL. Si usas Visual Studio Code, puedes abrir el archivo con `code .env`; en PowerShell: `notepad .env`:

```env
DATABASE_URL="postgresql://usb_app:cambia-esta-contraseña@localhost:5432/usb_monitor?schema=public"
```

3. (Opcional pero recomendado) Define una base shadow para migraciones locales (crea la base con `psql -h localhost -U postgres -c "CREATE DATABASE usb_monitor_shadow;"`):

```env
SHADOW_DATABASE_URL="postgresql://usb_app:cambia-esta-contraseña@localhost:5432/usb_monitor_shadow?schema=public"
```

Si `psql` no está en el `PATH`, usa la ruta completa, por ejemplo: `"$Env:ProgramFiles\PostgreSQL\16\bin\psql.exe"`.

> 📌 Si necesitas que la variable quede disponible a nivel de usuario en Windows (por ejemplo para tareas programadas), puedes ejecutarla con `setx DATABASE_URL "postgresql://..."` y reiniciar la terminal. Para el proyecto basta con mantenerla en `.env`.

> 📌 Si despliegas en producción, asegurate de propagar estas variables en tu plataforma (Docker Compose, servicios Windows, Railway, etc.).

## 3. Actualizar `schema.prisma`

1. Abre `prisma/schema.prisma`.
2. Cambia el bloque `datasource` a:

```prisma
datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
  shadowDatabaseUrl = env("SHADOW_DATABASE_URL") // opcional en entornos locales
}
```

3. Guarda el archivo.

> ⚠️ No elimines las migraciones existentes; Prisma las reutilizará para crear la estructura en PostgreSQL.

## 4. Generar y aplicar migraciones

### 4.1. Sin datos previos (instalación nueva)

Si apenas comienzas y no necesitas datos históricos:

```powershell
npm run db:migrate -- --name init-postgres
npm run db:generate
```

Esto creará las tablas en la base Postgres y regenerará el cliente de Prisma.

### 4.2. Con datos existentes (SQLite → Postgres)

1. **Bloquea la aplicación** o asegúrate de que nadie escriba en SQLite durante la migración.
2. Genera el SQL de diferencias (asegúrate de ejecutar PowerShell en la raíz del proyecto):

```powershell
npx prisma migrate diff --from-url "file:./db/custom.db" --to-url "$Env:DATABASE_URL" --script > prisma/migrations/sqlite-to-postgres.sql
```

3. Revisa el archivo generado y ejecútalo en PostgreSQL (ajusta la ruta de `psql` si es necesario):

```powershell
psql "$Env:DATABASE_URL" -f .\prisma\migrations\sqlite-to-postgres.sql
```

4. Opcionalmente, crea una migración Prisma explícita para futuras bases:

```powershell
npx prisma migrate dev --name init-postgres
```

> 🛡️ Haz una copia de `db/custom.db` antes de cualquier migración. Si algo falla, podrás volver atrás rápidamente.

## 5. Migrar los datos

### 5.1. Exportar desde SQLite

```powershell
# Directo con sqlite3 instalado en Windows (chocolatey) o WSL
# Si no tienes sqlite3, instálalo con: choco install sqlite
sqlite3 .\db\custom.db ".mode insert" ".output sqlite_dump.sql" ".dump"
```

### 5.2. Importar en PostgreSQL

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

> ✅ Verifica que los índices (`@@index`) y nombres de tablas (`@@map`) coincidan después de importar.

## 6. Verificaciones post-migración

1. Ejecuta migraciones pendientes y genera cliente:

```powershell
npm run db:migrate
npm run db:generate
```

2. Abre Prisma Studio para inspeccionar datos:

```powershell
npx prisma studio
```

3. Ejecuta la aplicación en desarrollo para asegurar que se conecta a Postgres:

```powershell
npm run dev
```

Observa la consola; Prisma mostrará la URL de conexión utilizada.

> 🔍 Si necesitas confirmar que el servicio de PostgreSQL está activo en Windows, ejecuta `Get-Service postgresql*` desde PowerShell. Para reiniciarlo usa `Restart-Service postgresql-x64-16` (ajusta la versión según tu instalación).

## 7. Ajustes adicionales

- **Scripts CLI** (`scripts/*.ts`): no necesitan cambios, pero asegúrate de que el nuevo `DATABASE_URL` esté disponible al ejecutar `npm run user:create`, etc.
- **Backups**: define una política de respaldo para Postgres (pg_dump, snapshots).
- Para respaldos manuales en Windows puedes usar: `pg_dump "$Env:DATABASE_URL" --file backup.sql` (usa la ruta completa al binario si no está en el `PATH`).
- **Monitorización**: añade chequeos de salud o alertas si usas un Postgres gestionado.
- **Eliminar SQLite**: cuando verifiques que todo funciona, archiva o elimina `db/custom.db` y los backups generados.

## 🧪 Lista de comprobación final

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
