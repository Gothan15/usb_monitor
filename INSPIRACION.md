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
  azul marino profundo, latón envejecido; materiales «de siempre».
- **Monocle (revista)** — cabeceras editoriales, numerales grandes en
  serif y pies de página con colofón tipográfico.
- **Aesop** — sobriedad radical: hairlines, espacio en blanco y cero
  adornos que no informen.

## La estructura (nueva, no un repintado)

- **Sin barra lateral.** Cabecera de periódico: franja superior con
  la fecha en versalitas y el estado en vivo; fila principal con el
  buscador a la izquierda, la **marca centrada** en Playfair Display
  y las acciones a la derecha; debajo, la **navegación horizontal**
  con subrayado de latón que se desplaza con muelle entre secciones
  (en móvil se desliza horizontalmente).
- **Cabecera editorial por página:** versalita de latón, titular
  serif grande, filete de latón y línea fina antes del contenido.
- **Componentes rehechos:** botones en versalitas con tracking y
  esquinas casi rectas; pestañas como subrayados editoriales (sin
  píldoras); tablas «libro mayor» con filetes y cabeceras en
  versalitas; tarjetas de papel sin sombra separadas por filetes;
  las cifras del resumen en Playfair, como un estado de cuentas.
- **Login:** panel de la casa en azul marino profundo con la lista
  de funciones numerada en serif itálica de latón (01 · 02 · 03) y
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
  título en Georgia, botón principal azul marino y acentos de latón.
- Página local de emergencia (`:5001/desbloquear`): editorial en
  marfil, serif, doble filete y botón azul marino.
- GUI de configuración: estilos ttk en marfil/espresso/azul marino.
