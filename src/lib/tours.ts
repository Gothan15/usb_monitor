import type { LucideIcon } from "lucide-react";
import {
  LayoutDashboard,
  Command,
  Bell,
  BarChart3,
  Usb,
  Rocket,
  Monitor,
  MonitorSmartphone,
  Radar,
  ShieldCheck,
  KeyRound,
  Users,
  Wrench,
  ListTodo,
  Clock,
} from "lucide-react";

export interface TourStep {
  /** CSS selector for the target element to highlight */
  target?: string;
  /**
   * Ruta de la vista donde vive el objetivo (p. ej. "/admin/computers").
   * Si el paso la trae y no estás en ella, la guía navega hasta ahí,
   * espera a que el componente monte y desplaza la vista hasta él.
   */
  view?: string;
  title: string;
  description: string;
  /** Preferred popover position relative to target */
  position?: "top" | "bottom" | "left" | "right";
  icon?: LucideIcon;
}

export interface TourDefinition {
  id: string;
  steps: TourStep[];
}

/* ── Admin tour ── */

export const adminTour: TourDefinition = {
  id: "admin-first-login",
  steps: [
    {
      title: "Bienvenido al centro de control",
      description:
        "Este panel vigila la actividad USB de todos los equipos con el agente instalado: qué se conecta, qué se bloquea y quién lo desbloquea. Te llevo por cada sección; la vista se moverá sola hasta lo que estemos viendo.",
      icon: Rocket,
    },
    {
      target: "[data-tour='sidebar']",
      title: "Navegación",
      description:
        "Desde aquí saltas entre las secciones: Resumen, Eventos, Equipos, Usuarios, Lista blanca, Desbloqueos, Tareas, Escáner de red y Ajustes. Las medallas avisan de un vistazo: cuántos eventos y equipos en línea hay, y en Desbloqueos, cuántos bloqueos están en curso ahora mismo.",
      position: "right",
      icon: LayoutDashboard,
    },
    {
      view: "/admin",
      target: "[data-tour='stats-cards']",
      title: "Resumen: el pulso de la red",
      description:
        "El titular y las cifras del día: dispositivos en lista blanca, eventos totales y actividad de la última hora. Si algo va mal en la red, aquí se nota primero.",
      position: "bottom",
      icon: BarChart3,
    },
    {
      view: "/admin",
      target: "[data-tour='activity-feed']",
      title: "Alertas recientes",
      description:
        "Las últimas alertas sin tener que buscarlas: dispositivos no autorizados, bloqueos y equipos que dejan de dar señales.",
      position: "top",
      icon: Bell,
    },
    {
      view: "/admin/events",
      target: "[data-tour='events-main']",
      title: "Eventos USB",
      description:
        "El historial completo y con filtros: conexiones, desconexiones, bloqueos, desbloqueos y el apagado de un equipo si alguna vez se arma. Todo queda auditado, y desde el encabezado puedes exportarlo a CSV por fechas.",
      position: "bottom",
      icon: Usb,
    },
    {
      view: "/admin/computers",
      target: "[data-tour='computers-main']",
      title: "Equipos",
      description:
        "Cada equipo aparece solo cuando su agente hace el primer contacto, en una tabla por columnas: su estado («En ejecución» o «Sin señal», según su última señal), la versión de su agente — con aviso cuando hay una actualización disponible — y su última conexión. Con «Ver USB» ves los dispositivos que tiene conectados en ese momento, en directo; con «Reiniciar», el servicio de su agente; y desde aquí gestionas también la credencial de cada agente (su código de enrolamiento). Las instalaciones en equipos nuevos se crean como tareas y se siguen en la sección Tareas.",
      position: "bottom",
      icon: MonitorSmartphone,
    },
    {
      view: "/admin/unlocks",
      target: "[data-tour='unlocks-main']",
      title: "Desbloqueos",
      description:
        "Los bloqueos en curso y los intentos de contraseña, y debajo el historial de los ya cerrados, cada uno con su evidencia si el agente la recogió: la captura de pantalla y el contexto del momento del bloqueo. Ojo: el administrador NO aprueba nada aquí: la contraseña la introduce el dueño del equipo (o un administrador con la suya) en el propio equipo. Los equipos que dejan de dar señales se marcan: el silencio también es una evidencia.",
      position: "bottom",
      icon: KeyRound,
    },
    {
      view: "/admin/users",
      target: "[data-tour='users-main']",
      title: "Usuarios",
      description:
        "Las cuentas las crea un administrador y a cada una se le asigna SU equipo: esa asignación es la que decide quién puede desbloquear los dispositivos de ese equipo con su contraseña.",
      position: "bottom",
      icon: Users,
    },
    {
      view: "/admin/whitelist",
      target: "[data-tour='whitelist-main']",
      title: "Lista blanca",
      description:
        "El registro de dispositivos conocidos, por número de serie. Solo se puede cambiar desde la PC del servidor. Al ir a escribir un serial, un desplegable te ofrece los dispositivos conectados en ese momento — también los pinchados en esta misma PC — y desde Desbloqueos o desde «Ver USB» puedes dar de alta un dispositivo con un botón, sin teclear su serial. Estar en la lista NO exime de la contraseña: solo significa que el dispositivo puede desbloquearse. Fuera de la lista no hay contraseña que valga: primero se da de alta aquí.",
      position: "bottom",
      icon: ShieldCheck,
    },
    {
      view: "/admin/network",
      target: "[data-tour='network-main']",
      title: "Escáner de red",
      description:
        "Descubre equipos en la red local y cuáles tienen el agente. La presencia del servicio se confirma con la señal que el propio agente envía al panel, no abriendo puertos en los equipos. Y sin salir de aquí puedes lanzar la instalación en un equipo suelto o en varios a la vez con las casillas de selección.",
      position: "bottom",
      icon: Radar,
    },
    {
      view: "/admin/tasks",
      target: "[data-tour='tasks-main']",
      title: "Tareas de instalación",
      description:
        "Cada instalación que lanzas desde el escáner o desde Equipos vive aquí hasta que termina. Por cada destino ves su estado en directo — comprobando, copiando, instalando, esperando señal — y el detalle de qué paso falló si algo va mal. Las instalaciones van de una en una; cada PC lleva su propio usuario y su propia contraseña, y los destinos que repites se pueden guardar para la próxima vez. Solo se da un equipo por instalado cuando su agente da la primera señal: la copia terminar no basta. Y debajo quedan las órdenes del agente: las actualizaciones, los reinicios del servicio y las cancelaciones de apagado que el panel deja a cada equipo.",
      position: "bottom",
      icon: ListTodo,
    },
    {
      target: "[data-tour='notifications']",
      title: "Centro de notificaciones",
      description:
        "Alertas en tiempo real: dispositivos no autorizados, bloqueos y servicios caídos. El punto rojo indica que hay algo sin leer.",
      position: "bottom",
      icon: Bell,
    },
    {
      target: "[data-tour='command-trigger']",
      title: "Paleta de comandos (Ctrl+K)",
      description:
        "Con Ctrl+K o ⌘K saltas a cualquier sección y ejecutas acciones sin tocar el ratón. También tienes atajos Alt+1…9 para cambiar de sección.",
      position: "bottom",
      icon: Command,
    },
    {
      view: "/admin/settings",
      target: "[data-tour='settings-main']",
      title: "Ajustes",
      description:
        "Las políticas del sistema: desbloqueo por contraseña, emergencia sin red, bloqueo de sesión, el apagado automático ante dispositivos desconocidos (con su cuenta atrás editable) y el umbral de silencio. Aquí vive también el «Estado del sistema» — la salud de la base de datos y de la caché, y la versión en curso — y la apariencia del panel: el tamaño de la letra y el desenfoque de fondo de los diálogos. Abajo del todo tienes las preguntas frecuentes y el botón para repetir esta guía cuando quieras.",
      position: "bottom",
      icon: Wrench,
    },
    {
      title: "La bandeja, junto al reloj",
      description:
        "En la PC del servidor, junto al reloj de Windows, vive la bandeja del panel: la brújula con un punto de color que dice si el servicio está en marcha. Desde su menú abres el panel sin buscar la dirección, inicias, paras o reinicias el servicio, y abres su archivo de registro cuando algo falla.",
      icon: Monitor,
    },
    {
      title: "¡Listo para empezar!",
      description:
        "Ya conoces el panel. Da de alta tus dispositivos en la lista blanca, asigna cada usuario a su equipo y deja que los agentes hagan el resto.",
      icon: Rocket,
    },
  ],
};

/* ── User tour ── */

export const userTour: TourDefinition = {
  id: "user-first-login",
  steps: [
    {
      title: "Bienvenido a tu panel",
      description:
        "Desde aquí ves los dispositivos USB de tu equipo y su historial. Entras con tu cuenta del panel y solo desde tu equipo asignado: tu cuenta no abre desde otra PC. Te enseño las dos vistas; la guía se mueve sola.",
      icon: Rocket,
    },
    {
      view: "/user",
      target: "[data-tour='devices-main']",
      title: "Tus dispositivos",
      description:
        "Los USB que tu equipo tiene conectados ahora mismo. La lista se actualiza sola cada pocos segundos: no hay botón de actualizar porque no hace falta.",
      position: "bottom",
      icon: Usb,
    },
    {
      view: "/user",
      target: "[data-tour='user-computer']",
      title: "Tu equipo asignado",
      description:
        "El equipo ligado a tu cuenta, con su dirección y si está activo. Solo verás dispositivos de este equipo, nunca los de los demás.",
      position: "bottom",
      icon: MonitorSmartphone,
    },
    {
      view: "/user",
      target: "[data-tour='user-devices']",
      title: "Conectados ahora",
      description:
        "Cada dispositivo con su unidad, su modelo, su número de serie y su tamaño, y desde cuándo lleva conectado. Si conectas uno nuevo, aparece aquí solo, sin recargar la página.",
      position: "bottom",
      icon: Usb,
    },
    {
      view: "/user",
      target: "[data-tour='user-devices']",
      title: "Bloqueos y contraseña",
      description:
        "Si un USB está en la lista blanca, al conectarlo sale un cartel en tu PC pidiendo tu contraseña del panel, y queda abierto hasta que lo extraigas. Si no está en la lista, el cartel solo avisa de que quedó bloqueado: esos no se abren con contraseña.",
      position: "bottom",
      icon: KeyRound,
    },
    {
      view: "/user/history",
      target: "[data-tour='history-main']",
      title: "Tu historial",
      description:
        "Todo lo que ha pasado con los USB de tu equipo: conexiones, desconexiones, bloqueos y desbloqueos, de más reciente a más antiguo. También se actualiza solo.",
      position: "bottom",
      icon: Clock,
    },
    {
      view: "/user/history",
      target: "[data-tour='user-history']",
      title: "Eventos de seguridad",
      description:
        "Los marcados como evento de seguridad son los de dispositivos fuera de la lista blanca; los autorizados salen con su etiqueta de desbloqueado o conectado. Si ves algo que no reconoces, avisa al administrador.",
      position: "bottom",
      icon: ShieldCheck,
    },
  ],
};
