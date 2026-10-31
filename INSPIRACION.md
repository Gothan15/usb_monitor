# Inspiración de diseño — Renovación de UI (octubre 2026)

Renovación pedida por Gothan con la indicación de siempre: nada de diseño
genérico «de IA»; inspiración en **diseños hechos por humanos** publicados
en sitios de diseño. Estas son las referencias reales que se estudiaron
y qué se tomó de cada una:

## Referencias

1. **ThreatLens — Enterprise Cybersecurity SaaS Dashboard**, de DIGIMARIX
   (Dribbble).
   https://dribbble.com/shots/27543906-ThreatLens-Enterprise-Cybersecurity-SaaS-Dashboard
   - Tema oscuro de bajo contraste pensado para analistas que miran la
     pantalla todo el día, con **un solo acento verde neón** de señal.
   - Bloques de datos de alto contraste y las métricas críticas ancladas
     arriba, legibles «en menos de dos segundos».
   - → De aquí salen: el verde señal como único color de marca, la
     jerarquía de métricas grandes y la tabla de eventos con estados
     por color.

2. **Modern Proxy Dashboard — Cyber Security SaaS Admin Panel**, de
   Pure Pixel Lab (Dribbble).
   https://dribbble.com/shots/27370095-Modern-Proxy-Dashboard-UI-Design-Cyber-Security-SaaS-Admin-Pan
   - Consola oscura de administración con jerarquía visual muy marcada
     y tarjetas limpias de borde fino.
   - → Refuerza: bordes de 1px nítidos en vez de sombras/glass por todas
     partes, y radios más cerrados (panel de instrumentos, no app de
     consumo).

3. **Lenguaje de diseño de Nothing OS** (equipo de diseño de Nothing;
   Slava Kornilov, exdiseñador de Nothing OS y jurado de Awwwards).
   https://newsbywire.com/former-nothing-os-designer-joins-everest-ai/
   - Minimalismo técnico con «giro nerdy»: **matriz de puntos**,
     etiquetas en monoespaciada y un rojo de señal sobre tinta.
   - Su idea para dashboards de infraestructura: «interfaz calmada para
     sistemas complejos».
   - → De aquí salen: la matriz de puntos como textura de fondo, las
     etiquetas de sección en JetBrains Mono mayúsculas con tracking
     ancho, y la calma general (menos brillos, menos glassmorphism).

4. **Oneleet — MDM / Device Monitoring** (trabajo de usrnk1 en Dribbble).
   - Tablas densas de dispositivos/monitorización de un producto real de
     seguridad: filas compactas, estados claros, paneles laterales de
     detalle.
   - → De aquí sale la densidad de las tablas de equipos/eventos: se
     mantiene la estructura actual (ya era parecida) y se le aplica el
     nuevo sistema de color/estados.

5. **SOC Security Dashboard UI/UX**, de Pixelean, y **CyberGuard —
   Security Monitoring Dashboard UI** (ambos en Dribbble).
   - Consolas SOC clásicas: fondo tinta casi negro, semáforo de estados
     (verde/ámbar/rojo) y sensación de «sala de control».
   - → Refuerzan el tema oscuro por defecto y el semáforo semántico.

## El nuevo sistema: «Consola Señal»

- **Adiós al gris acero azulado y al glassmorphism generalizado.** La
  paleta anterior (todo en tono 250, croma ~0,02) hacía que la app se
  viera monocroma y «de plantilla». La nueva tinta es verdosa (tono
  ~155) y el papel claro es cálido (tono ~90).
- **Un solo color de marca:** verde señal (tipo ThreatLens/Nothing).
  El resto de colores son semáforo: cian = info, ámbar = aviso,
  rojo = bloqueo/peligro.
- **Sidebar tinta en ambos temas** (también en claro), como las
  consolas SOC: ancla visual constante.
- **Tipografía:** Plus Jakarta Sans para la interfaz (se queda) y
  JetBrains Mono con protagonismo nuevo: etiquetas de sección,
  cifras tabulares grandes en las tarjetas y marcas técnicas.
- **Radios más cerrados** (0,55rem): panel de instrumentos.
- **Textura:** matriz de puntos sutil (`.dot-grid`) en el fondo de la
  app y como protagonista en el panel de marca del login.
- Los componentes shadcn/ui no se reescriben: consumen los tokens, así
  que la renovación se propaga a las 30+ pantallas cambiando el sistema,
  no pantalla por pantalla. Se retocan a mano el shell, el login y las
  tarjetas de estadísticas, que son la cara visible.
