# Reporte de Revisión de Arquitectura y Calidad de Código

**Fecha:** 4 de Febrero, 2026
**Proyecto:** Monitor_USB
**Revisado por:** Roo (Arquitecto Técnico)

---

## 1. Resumen Ejecutivo

El proyecto presenta una estructura base sólida utilizando **Next.js App Router** y **Prisma**, con una clara separación de carpetas. Sin embargo, se han identificado **riesgos críticos de escalabilidad** tanto en el backend como en el frontend. La arquitectura actual está diseñada para un entorno pequeño (< 100 computadoras) y sufrirá degradación severa de rendimiento en entornos empresariales medianos o grandes.

## 2. Estructura del Proyecto

### Evaluación
La organización de archivos en `src/` sigue las convenciones de Next.js App Router:
*   ✅ `src/app`: Uso correcto de rutas, layouts y API routes.
*   ✅ `src/lib`: Centralización de utilidades y configuración (db, auth, logger).
*   ✅ `src/components`: Separación de componentes UI.

### Observaciones
*   **Provider Bloated:** `AdminDashboardProvider` actúa como un "God Provider", centralizando la carga de *todos* los datos de la aplicación. Esto acopla innecesariamente las vistas y provoca que todas las pestañas dependan de la carga exitosa de todos los datasets.

## 3. Calidad de Código (Clean Code / SOLID)

### Code Smells Detectados

1.  **God Components / Responsabilidad Excesiva:**
    *   **`src/app/admin/_providers/AdminDashboardProvider.tsx`**: Viola el **Principio de Responsabilidad Única (SRP)**. Gestiona autenticación, estado global de UI, y la carga de datos de *todas* las entidades (Computadoras, Eventos, Whitelist, Usuarios).
    *   **`src/components/dashboard/OverviewTab.tsx`**: Contiene lógica de negocio compleja (cálculo de tendencias, filtrado por horas, estadísticas) que debería estar en el backend o en hooks personalizados/selectores. La capa de vista está "pensando" demasiado.

2.  **Acoplamiento de Lógica y Presentación:**
    *   El frontend realiza **paginación en el cliente** (`ComputersTab.tsx`). Recibe el listado completo de la base de datos y lo recorta en el navegador. Esto es insostenible para listas grandes.

3.  **Lógica de Negocio en `src/lib`:**
    *   **`src/lib/networkScanner.ts`**: Mezcla la lógica de escaneo de red (infraestructura) con la persistencia en base de datos (`persistComputers`). Viola la separación de capas; el escáner debería devolver resultados y un servicio orquestador debería guardarlos.

## 4. Performance y Escalabilidad

### Análisis Crítico

1.  **API de Computadoras (`src/app/api/computers/route.ts`)**:
    *   ❌ **Fetching sin límites:** `db.computer.findMany()` sin `take` ni `skip`. Devuelve *toda* la tabla.
    *   **Impacto:** Con 1,000+ equipos, la respuesta JSON será de varios MB, bloqueando el hilo principal del cliente y saturando la memoria del servidor.

2.  **Network Scanner (`src/lib/networkScanner.ts`)**:
    *   ❌ **Ineficiencia en Ping:** Usa `exec('ping ...')` que genera un proceso de shell por cada IP. Escanear una subred /24 crea 254 procesos. Extremadamente costoso en CPU/RAM.
    *   ❌ **Estado Volátil:** El objeto `jobs` reside en memoria RAM. Si el contenedor/servidor se reinicia, el estado del escaneo se pierde. No permite escalado horizontal (múltiples instancias del backend).

3.  **Uso de Prisma (`src/lib/db.ts` y APIs)**:
    *   **Problema N+1 (Potencial):** En `networkScanner.ts`, aunque se usa `upsert` en lotes (`persistComputers`), la lógica de transacción dentro de un bucle puede generar bloqueos de tabla si la concurrencia es alta.
    *   **Ingesta de Eventos USB:** Cada evento USB (`POST /api/usb-event`) dispara un `upsert` a la tabla `Computer`. En un entorno con muchos clientes enviando eventos simultáneamente, esto creará un cuello de botella en la escritura de la DB.

## 5. Recomendaciones de Refactorización

### Prioridad Alta (Performance)
1.  **Implementar Paginación en Server-Side:**
    *   Modificar `GET /api/computers` para aceptar `?page=1&limit=20`.
    *   Actualizar `ComputersTab` y `useTableSort` para manejar paginación remota.
2.  **Optimizar Network Scanner:**
    *   Reemplazar `exec('ping')` con una librería nativa de Node.js o `net-ping` (sockets raw) para reducir overhead.
    *   Mover el estado de `jobs` a Redis o a la base de datos para persistencia y soporte de múltiples instancias.

### Prioridad Media (Arquitectura)
3.  **Desacoplar `AdminDashboardProvider`:**
    *   Usar `React Query` (TanStack Query) directamente en los componentes que necesitan los datos (`ComputersTab`, `EventsTab`) en lugar de prop-drilling desde un provider global.
    *   Esto permitirá que la pestaña "Resumen" cargue rápido sin esperar a que cargue la lista completa de computadoras.
4.  **Backend-for-Frontend (BFF) para Estadísticas:**
    *   Crear un endpoint `/api/dashboard/stats` que devuelva los cálculos ya procesados (conteo de activos, tendencias, etc.) para que `OverviewTab` sea puramente presentacional.

### Prioridad Baja (Mantenibilidad)
5.  **Refactorizar `networkScanner.ts`:**
    *   Extraer la lógica de persistencia (`persistComputers`) a un servicio dedicado `ComputerService`.
    *   Inyectar dependencias para facilitar testing unitario.
