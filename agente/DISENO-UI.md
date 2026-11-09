# Diseño de la interfaz del agente en C# — tema claro del panel

La interfaz WPF del agente hereda el lenguaje visual del panel web
actual («Herencia» en frío, TEMA CLARO por defecto): papel frío,
tinta azul marino, acero como acento, esquinas rectas, etiquetas en
mayúsculas pequeñas (small caps) y datos en monoespaciada. Nada de
tema oscuro: el agente anterior era grafito; este nace claro como
el panel, para que ambos se lean como el mismo sistema.

## Paleta (equivalencias del panel, `globals.css`)

- Fondo de ventana: `#EEF0F4` (papel frío)
- Superficie / tarjetas: `#FFFFFF` con borde `#C9D2DE`
- Superficie atenuada: `#E4E8EF`
- Tinta principal: `#1D2536`
- Tinta atenuada: `#5A6B80`
- Azul marino primario (botones principales): `#2F4470`
- Acero (acentos, foco, enlaces): `#657A90`
- Verde (conectado / correcto): `#2F7D4F`
- Ámbar (avisos): `#A8741A`
- Rojo (bloqueado / error / acciones destructivas): `#B3382E`

## Tipografía y forma

- Títulos: «Segoe UI» semibold; cuerpo: «Segoe UI» 13-14 px.
- Datos y valores (seriales, IP, tiempos, resultados): «Consolas».
- Etiquetas de campo y de sección: mayúsculas pequeñas, atenuadas,
  con separación entre letras.
- Esquinas rectas en todo (como el panel: `rounded-none`), bordes de
  1 px, sin sombras decorativas; la jerarquía la dan el filete
  superior de 2 px en acero de cada ventana y los titulares.
- Botones: principal azul marino con texto blanco; secundarios
  blancos con borde; destructivo rojo. Sin gradientes.

## Ventanas

1. **Compañero** (`prompt`): titular «Dispositivo bloqueado», el
   dispositivo en mono (nombre, serial, unidad), selector cuando hay
   varios, aviso ámbar sin campos si está fuera de la lista blanca, y
   formulario usuario/contraseña con el botón «Desbloquear». Mensajes
   del servidor tal cual los devuelve usb-auth (401 genérico, 403 con
   su texto, sin conexión → sugiere la página de emergencia).
2. **Caja de herramientas** (`gui`): todo en UNA sola pantalla de
   960×700, sin desplazamiento (ver «Distribución» más abajo):
   cabecera con el estado como palabra con punto de color (en
   ejecución / detenido / sin conexión), resumen y dueño asignado
   siempre visibles; columna izquierda con Servicio (iniciar,
   detener, reiniciar, instalar, desinstalar) y Acciones (Restaurar
   todo, página de emergencia, compañero, visor); columna derecha
   con Servidor (host ancho completo, puerto y esquema en una fila,
   guardar y **Probar conexión** con el resultado paso a paso) y
   Credencial (token del equipo, se guarda cifrado); y abajo el
   Registro como cinta de alto fijo sin barras — enseña la cola del
   log siempre al día y el archivo completo se abre con un botón.
3. **Visor de seriales** (`visor`): tabla clara de dispositivos
   presentes (nombre, serial, letra, tipo) con copiar al portapapeles.
4. **Asistente de configuración** (`configurar`, y `gui` cuando es
   la primera vez): guía la puesta en marcha de un equipo nuevo en
   cinco pasos numerados («Paso N de 5», con segmentos de progreso
   en acero y botones Atrás / Continuar / Saltar por ahora), con el
   mismo tema claro y las mismas tarjetas que la caja de
   herramientas. Los pasos: bienvenida; servidor (host, puerto,
   esquema y **Probar conexión** con el resultado paso a paso, con
   aviso visible si no hubo conexión); credencial del equipo (de
   dónde sale el token y campo enmascarado; se puede saltar y queda
   marcado como sin guardar); servicio (qué es, instalarlo y
   arrancarlo, con aviso claro si falta administrador y detección
   de si ya está instalado); y resumen final con el estado real de
   cada cosa (✓/✗) y salida a la caja de herramientas. Es primera
   vez cuando el equipo no tiene token guardado: en ese caso `gui`
   (y el doble clic sin argumentos) abre el asistente en vez de la
   caja de herramientas; el modo `configurar` lo abre siempre, para
   rehacer la configuración en cualquier PC.

## Distribución de la caja de herramientas (una pantalla, sin scroll)

Pedido de Gothan (2026-11-02): fácil de leer, con estilo pero
minimalista, y sin tener que desplazarse dentro de la ventana.
La versión anterior apilaba las cinco tarjetas en una columna de
700×780 con `ScrollViewer`: el registro quedaba fuera de pantalla.

Inspiración en diseños hechos por humanos (referencias reales):

- **Ajustes de PowerToys y de Windows 11 (Microsoft)**: tarjetas
  agrupadas por tema con etiquetas de sección claras y controles
  alineados; de ahí salen las tarjetas y el orden por secciones.
- **Ajustes del Sistema de macOS (Apple)**: filas de formulario con
  la etiqueta a la izquierda y el control a la derecha, que es como
  se leen Host/Puerto/Esquema sin esfuerzo.
- **Preferencias de Raycast (Raycast Technologies)**: ventana de
  utilidad compacta, densa pero con aire, donde todo se alcanza de
  un vistazo sin páginas ni desplazamiento.

Decisiones que salen de esas referencias:

- Dos columnas por afinidad: a la izquierda lo que se TOCA a diario
  (servicio y acciones); a la derecha lo que se CONFIGURA una vez
  (servidor y credencial). El estado va en la cabecera, siempre
  visible, no en una tarjeta más.
- Botones en rejilla uniforme (ocupan todo el ancho de su tarjeta):
  se localizan por posición, no leyendo una fila de píldoras.
- El registro deja de ser una caja con barras: es una cinta de
  alto fijo que enseña las últimas líneas (siempre pegada a la
  cola) y el log completo se abre en el editor con un botón.
- Se mantiene la paleta y la tipografía de este documento: el
  estilo sale de la jerarquía y el aire, no de adornos nuevos.

## Reglas

- Ninguna ventana bloquea su hilo mientras habla con el servidor:
  todo lo de red va en segundo plano y la ventana muestra estado.
- Los textos para el usuario: español llano, sin jerga sin explicar;
  «bloqueo» en vez de «pendiente» (la palabra interna del registro
  no se muestra como estado al usuario final).
- Sobriedad de herramienta interna: nada de tono promocional.
