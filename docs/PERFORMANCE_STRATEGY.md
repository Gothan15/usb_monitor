# Estrategia Integral de Optimización de Rendimiento

Este documento detalla el plan estratégico para minimizar latencia y optimizar tiempos de carga en el sistema de monitoreo USB.

**Estado Actual:**
- **Stack:** Next.js 15.5 (App Router), Prisma 6.11, React Query v5.
- **Infra:** Node.js runtime.
- **Base de Datos:** PostgreSQL.
- **Observaciones:** El endpoint de ingesta de eventos (`POST /api/usb-event`) realiza múltiples operaciones de BD síncronas. La validación de API Key golpea la BD en cada petición. Faltan índices clave para búsquedas en dashboard.

---

## 1. Estrategias Frontend y UX

### Optimización de React Query & State
- **Stale-While-Revalidate (SWR):** Mantener la configuración actual de `staleTime: 30s` para datos generales, pero reducir a `0s` o usar `invalidateQueries` inmediato para acciones críticas (ej. desbloqueo USB).
- **Optimistic UI (UI Optimista):**
  - Implementar en botones de "Autorizar" o "Bloquear". La interfaz debe reflejar el cambio *antes* de que el servidor responda.
  - *Impacto:* Sensación de latencia cero para el administrador.
- **Prefetching:**
  - Usar `queryClient.prefetchQuery` en el evento `onMouseEnter` de las filas de la tabla de computadoras/usuarios.
  - *Impacto:* Carga instantánea al navegar a los detalles (`/admin/computers/[id]`).

### Carga de Recursos (Code Splitting & Assets)
- **Lazy Loading de Componentes Pesados:**
  - Los modales de configuración o gráficos complejos (`recharts`) deben cargarse con `next/dynamic` y `loading: () => <Skeleton />`.
- **Bundle Analyzer:**
  - Ejecutar `@next/bundle-analyzer` para detectar dependencias gigantes (ej. si se importa todo `lucide-react` en lugar de iconos individuales, aunque el compilador de Next.js suele optimizar esto, vale la pena verificar).

---

## 2. Optimización Backend y API

### Ingesta de Eventos (Critical Path)
El endpoint `POST /api/usb-event` es el cuello de botella más probable bajo carga.

- **Caché de Autenticación (API Keys):**
  - **Problema:** Actualmente se consulta `prisma.user.findUnique` en cada petición POST.
  - **Solución:** Implementar caché en memoria (LRU Cache) o Redis para almacenar la validación de `apiKey` -> `userId`.
  - *Ganancia:* Eliminación de 1 query por petición.
- **Desacoplamiento (Future Proofing):**
  - Si el volumen de eventos USB crece masivamente, mover el procesamiento a un **Background Job**.
  - Flujo: API -> Cola (Redis/BullMQ) -> Worker -> DB.
  - Por ahora: Usar `Promise.all` para paralelizar la escritura del Evento y la actualización del Computer si la integridad estricta no es bloqueante.

### Headers y Compresión
- Asegurar que `next.config.ts` tenga `compress: true` (default).
- Configurar cabeceras `Cache-Control` en endpoints GET públicos o semi-estáticos (`max-age=60, stale-while-revalidate=300`).

---

## 3. Base de Datos (PostgreSQL + Prisma)

### Índices Faltantes
Según el análisis de `schema.prisma`, se recomiendan los siguientes índices para acelerar el Dashboard:

1. **Búsquedas por Nombre de PC en Eventos:**
   ```prisma
   model USBEvent {
     // ...
     @@index([pcName]) // Crítico para filtrado en dashboard
     @@index([serialNumber]) // Para rastrear historia de un USB
   }
   ```

2. **Login y Seguridad:**
   Asegurar índice en `apiKey` (ya existe `@unique`, lo cual crea índice implícito, correcto).

### Optimización de Consultas
- **Evitar `select *` implícito:** En Prisma, usar `select: { id: true, name: true }` en lugar de traer el objeto completo si solo se necesitan campos específicos para una tabla.
- **Pagination vs Infinite Scroll:**
  - Para tablas de >1000 registros, usar paginación basada en cursor (`cursor-based pagination`) en lugar de `offset`, ya que el offset se vuelve lento con tablas grandes.

---

## 4. Infraestructura y Red

### Redis (Recomendado)
- Implementar Redis (ej. Upstash o AWS ElastiCache) para:
  1. **Rate Limiting:** Proteger la API de spam de agentes USB defectuosos.
  2. **Session Cache:** Acelerar `requireAuth`.
  3. **Key-Value Store:** Guardar configuraciones globales sin tocar Postgres.

### HTTP/3 y CDN
- Si se despliega en Vercel, HTTP/3 y Brotli están activados por defecto.
- Si se despliega en VPS propio (Nginx/Docker), configurar explícitamente HTTP/2 o HTTP/3 y compresión Gzip/Brotli.

---

## 5. Observabilidad

### Core Web Vitals (Frontend)
- Monitorizar **INP (Interaction to Next Paint)**: Crítico para dashboards administrativos.
- Monitorizar **LCP (Largest Contentful Paint)**: Optimizar la carga de la tabla principal de datos.

### Métricas de Backend
- **Time to First Byte (TTFB):** Debe ser < 200ms.
- **Database Query Latency:** Configurar alertas si queries lentas (Slow Query Log en Postgres) exceden 100ms.
- **Logging Asíncrono:** Reemplazar `console.log` síncrono en rutas críticas por una librería de logging estructurado (ej. Pino) que no bloquee el event loop en cargas altas (o usar `pino-pretty` solo en dev).

---

## Plan de Acción Inmediato

1. **[Backend]** Implementar caché en memoria para validación de API Keys en `POST /api/usb-event`.
2. **[DB]** Agregar índices faltantes en `schema.prisma` (`pcName`, `serialNumber` en `USBEvent`).
3. **[Frontend]** Implementar prefetching en listas de usuarios/computadoras.
4. **[Infra]** Instalar `ioredis` y configurar conexión básica para Rate Limiting (si hay presupuesto de infra) o usar `lru-cache` localmente.
