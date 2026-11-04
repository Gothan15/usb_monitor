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
        "Desde aquí saltas entre las secciones: Resumen, Eventos, Equipos, Usuarios, Lista blanca, Desbloqueos, Tareas, Escáner de red y Ajustes. Los contadores avisan de un vistazo cuántos equipos y eventos hay.",
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
        "El historial completo y con filtros: conexiones, desconexiones, bloqueos, desbloqueos y el apagado de un equipo si alguna vez se arma. Todo queda auditado.",
      position: "bottom",
      icon: Usb,
    },
    {
      view: "/admin/computers",
      target: "[data-tour='computers-main']",
      title: "Equipos",
      description:
        "Cada equipo aparece solo cuando su agente hace el primer contacto. Su estado sale de la última señal del agente: «En ejecución» o «Sin señal», sin datos duplicados. Desde aquí provisionas el token de cada agente, ves sus dispositivos USB e instalas el servicio en equipos nuevos: esas instalaciones se crean como tareas y se siguen en directo en la sección Tareas.",
      position: "bottom",
      icon: MonitorSmartphone,
    },
    {
      view: "/admin/unlocks",
      target: "[data-tour='unlocks-main']",
      title: "Desbloqueos",
      description:
        "Los bloqueos en curso y los intentos de contraseña. Ojo: el administrador NO aprueba nada aquí: la contraseña la introduce el dueño del equipo (o un administrador con la suya) en el propio equipo. Los equipos que dejan de dar señales se marcan: el silencio también es una evidencia.",
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
        "El registro de dispositivos conocidos, por número de serie. Estar en la lista NO exime de la contraseña: solo significa que el dispositivo puede desbloquearse. Fuera de la lista no hay contraseña que valga: primero se da de alta aquí.",
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
        "Cada instalación o actualización que lanzas desde el escáner o desde Equipos vive aquí hasta que termina. Por cada destino ves su estado en directo — comprobando, copiando, instalando, esperando señal — y el detalle de qué paso falló si algo va mal. El panel trabaja con dos destinos a la vez, reintenta los fallos que pueden salir bien a la segunda y solo da un equipo por instalado cuando su agente da la primera señal: la copia terminar no basta.",
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
        "Las políticas del sistema: desbloqueo por contraseña, emergencia sin red, bloqueo de sesión, el apagado automático ante dispositivos desconocidos (con su cuenta atrás editable) y el umbral de silencio. Abajo del todo tienes las preguntas frecuentes y el botón para repetir esta guía cuando quieras.",
      position: "bottom",
      icon: Wrench,
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
        "Desde aquí puedes ver tus dispositivos USB conectados y revisar tu historial. Tu equipo se identifica con un token propio: no necesitas ninguna clave.",
      icon: Monitor,
    },
    {
      target: "[data-tour='devices']",
      title: "Tus dispositivos",
      description:
        "Aquí verás los dispositivos USB actualmente conectados a tu equipo asignado, con su estado y detalles.",
      position: "bottom",
      icon: Usb,
    },
    {
      target: "[data-tour='whitelist-status']",
      title: "Estado de lista blanca",
      description:
        "Los dispositivos autorizados aparecen con una insignia verde. Si un dispositivo no está en la lista blanca, puedes solicitar su autorización.",
      position: "bottom",
      icon: ShieldCheck,
    },
  ],
};
