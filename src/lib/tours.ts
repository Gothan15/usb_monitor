import type { LucideIcon } from "lucide-react";
import {
  LayoutDashboard,
  Command,
  Bell,
  BarChart3,
  Usb,
  Keyboard,
  Rocket,
  Monitor,
  ShieldCheck,
  KeyRound,
} from "lucide-react";

export interface TourStep {
  /** CSS selector for the target element to highlight */
  target?: string;
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
        "Este es tu centro de control para monitorear toda la actividad USB de la organización. Te guiaremos por las funcionalidades principales.",
      icon: Rocket,
    },
    {
      target: "[data-tour='sidebar']",
      title: "Navegación lateral",
      description:
        "Pasa el cursor sobre la barra lateral para expandirla y navega entre las distintas secciones: Resumen, Eventos, Equipos, Usuarios, Lista blanca y más.",
      position: "right",
      icon: LayoutDashboard,
    },
    {
      target: "[data-tour='command-trigger']",
      title: "Paleta de comandos (⌘K)",
      description:
        "Usa Ctrl+K o ⌘K para abrir la paleta de comandos. Desde ahí puedes navegar, ejecutar acciones y buscar rápidamente.",
      position: "bottom",
      icon: Command,
    },
    {
      target: "[data-tour='notifications']",
      title: "Centro de notificaciones",
      description:
        "Aquí recibirás alertas en tiempo real: dispositivos no autorizados, servicios caídos y más. El badge rojo indica notificaciones sin leer.",
      position: "bottom",
      icon: Bell,
    },
    {
      target: "[data-tour='stats-cards']",
      title: "Métricas en vivo",
      description:
        "Las tarjetas KPI muestran el estado general: equipos activos, eventos totales, alertas recientes y cobertura de la lista blanca.",
      position: "bottom",
      icon: BarChart3,
    },
    {
      target: "[data-tour='activity-feed']",
      title: "Eventos USB en vivo",
      description:
        "El feed de actividad muestra eventos USB en tiempo real conforme llegan. Verás conexiones, desconexiones y bloqueos.",
      position: "left",
      icon: Usb,
    },
    {
      title: "Atajos de teclado",
      description:
        "Usa Alt+1-9 para navegar entre secciones, Alt+R para refrescar, ⌘K para la paleta de comandos y Ctrl/⌘ + / para abrir la ayuda de atajos.",
      icon: Keyboard,
    },
    {
      title: "¡Listo para empezar!",
      description:
        "Ya conoces las herramientas principales. Explora el panel, configura tu lista blanca y mantén tu red segura.",
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
        "Desde aquí puedes ver tus dispositivos USB conectados, revisar tu historial y gestionar tu clave API.",
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
    {
      target: "[data-tour='api-key']",
      title: "Tu clave API",
      description:
        "Necesitas esta clave para que el agente USB se comunique con el servidor. Puedes copiarla o rotarla desde la sección Clave API.",
      position: "bottom",
      icon: KeyRound,
    },
  ],
};
