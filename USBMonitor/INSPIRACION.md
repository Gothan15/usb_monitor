# Inspiración de diseño — Agente USBMonitor v2

La interfaz del agente («instrumento de seguridad») se inspira en
diseños hechos por humanos, del contexto de la herramienta:

- **El diálogo de montar de VeraCrypt**: una ventana pequeña, técnica
  y sobria, con una sola acción principal. El compañero copia esa
  idea: el dispositivo, su serial, dos campos y un botón.
- **El Administrador de dispositivos de Windows**: el estado de cada
  dispositivo se lee de un vistazo, con vocabulario consistente
  (habilitado/deshabilitado) y sin decoración que compita con el dato.
  El visor y la lista de bloqueados siguen ese patrón.
- **El funcionalismo de Braun / Dieter Rams**: cada control existe
  porque hace falta; si una opción no es esencial, no está. De ahí
  las opciones mínimas de la especificación (sección 8).

Reglas concretas aplicadas:

- Fondo grafito/acero oscuro (#232a31), panel #2b333b, un solo color
  de acción (acero #4d7ca6) y colores de estado con significado fijo:
  verde autorizado, ámbar aviso, rojo error/restaurar.
- Los datos técnicos (serial, instancia, unidad) van en tipografía
  monoespaciada (Consolas); el texto corrido en Segoe UI.
- El estado se expresa como palabra, no solo como color.
- Ventanas pequeñas, sin animaciones ni elementos decorativos.
