# Inspiración del diseño — «Herencia» (rediseño completo, 2026-10-31)

Rediseño estructural de USB Monitor (panel web y agente) en la rama
`rediseno-ui`, con la estética «old money» que pidió Gothan: lujo
tranquilo, nada de neones ni degradados estridentes. Sustituye a los
sistemas «Consola Señal» y «Aurora».

## Referencias (diseño hecho por humanos)

- **Banca privada suiza (Pictet, Lombard Odier)** — membretes
  sobrios, serif editorial, versalitas con tracking ancho y filetes
  finos en lugar de tarjetas con sombra.
- **Ralph Lauren y Brunello Cucinelli** — la paleta: marfil, papel,
  azul marino profundo, acero pulido y neutros fríos azulados (a juego con el azul: nada de marfiles ni espressos cálidos); materiales «de siempre».
- **Monocle (revista)** — cabeceras editoriales, numerales grandes en
  serif y pies de página con colofón tipográfico.
- **Aesop** — sobriedad radical: hairlines, espacio en blanco y cero
  adornos que no informen.

## La estructura (nueva, no un repintado)

- **Sin barra lateral.** Cabecera de periódico: franja superior con
  la fecha en versalitas y el estado en vivo; fila principal con el
  buscador a la izquierda, la **marca centrada** en Playfair Display
  y las acciones a la derecha; debajo, la **navegación horizontal**
  con subrayado de acero que se desplaza con muelle entre secciones
  (en móvil se desliza horizontalmente).
- **Cabecera editorial por página:** versalita de acero, titular
  serif grande, filete de acero y línea fina antes del contenido.
- **Componentes rehechos:** botones en versalitas con tracking y
  esquinas casi rectas; pestañas como subrayados editoriales (sin
  píldoras); tablas «libro mayor» con filetes y cabeceras en
  versalitas; tarjetas de papel sin sombra separadas por filetes;
  las cifras del resumen en Playfair, como un estado de cuentas.
- **Login:** panel de la casa en azul marino profundo con la lista
  de funciones numerada en serif itálica de acero (01 · 02 · 03) y
  el formulario sobre papel con doble filete (`.frame-double`).
- **Desahogo visual:** fuera las cajas dentro de cajas, los iconos
  en cajitas de color y las píldoras decorativas; las cifras de cada
  vista van en tiras separadas por filetes y las secciones respiran
  con más aire entre ellas.
- **Movimiento:** el justo — entradas suaves al cambiar de vista, el
  subrayado de navegación con muelle y hovers que solo oscurecen el
  filete. Calma total con `prefers-reduced-motion`.

## El agente de Windows, en el mismo idioma

- Compañero (`usb_prompt.py`): ventana marfil con tarjeta de papel,
  título en Georgia, botón principal azul marino y acentos de acero.
- Página local de emergencia (`:5001/desbloquear`): editorial en
  marfil, serif, doble filete y botón azul marino.
- GUI de configuración: estilos ttk en marfil/espresso/azul marino.

## Herramientas de escritorio: Fluent, el lenguaje de Windows 11 (2026-11-01)

Las tres ventanas del agente (compañero, visor de seriales y
herramienta de administración) abandonan tkinter y la paleta propia:
una herramienta que vive en Windows debe parecer de Windows. La
referencia es el diseño real de Microsoft para Windows 11
(Fluent 2): tipografía Segoe UI, superficies claras con borde fino
y esquinas redondeadas de 8px, botones con el acento del sistema,
tema claro/oscuro heredado del propio Windows y estados con los
colores semánticos del sistema. Se dibuja con pywebview (WebView2,
integrado en Windows 11) sobre un kit compartido
(`USBMonitor/fluent_ui.py`). Sustituye a los apuntes anteriores
sobre el compañero y la GUI de configuración; la página local de
emergencia conserva su estilo editorial propio, porque es una
página web y no una ventana del sistema.
