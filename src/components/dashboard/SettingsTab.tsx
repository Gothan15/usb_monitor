"use client";

import { useState, useEffect, useRef, useSyncExternalStore } from "react";
import { getCsrfTokenFromDocument } from "@/lib/utils";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import {
  Server,
  LayoutTemplate,
  RotateCcw,
  Activity,
  KeyRound,
  ChevronDown,
  HelpCircle,
  Package,
} from "lucide-react";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { resetTour } from "@/components/onboarding/TourEngine";
import { EmpujeChecklist } from "./EmpujeChecklist";
import { adminTour } from "@/lib/tours";
import { useLayoutStore, type Disposicion } from "@/store/useLayoutStore";
import { PanelLeft, PanelTop } from "lucide-react";
import { useLiveSyncStore } from "@/store/useLiveSyncStore";
import { Switch } from "@/components/ui/switch";

interface ApiSettings {
  startupNetworkDelay: number;
}

interface EstadoPaquete {
  version: string | null;
  sha256: string | null;
  agente: { presente: boolean; tamano: number };
  empujador: { presente: boolean; tamano: number };
}

function formatoTamano(bytes: number): string {
  if (!bytes) return "";
  return `${(bytes / (1024 * 1024)).toFixed(1).replace(".", ",")} MB`;
}

interface UnlockSettings {
  passwordUnlockEnabled: boolean;
  offlineEmergencyEnabled: boolean;
  requireAgentToken: boolean;
  lockSessionOnInsert: boolean;
  shutdownOnNonWhitelisted: boolean;
  shutdownCountdownSeconds: number;
  captureEvidenceOnNonWhitelisted: boolean;
  silenceThresholdMinutes: number;
}

const SECCIONES = [
  { id: "sincronizacion-en-tiempo-real", nombre: "Sincronización en Tiempo Real" },
  { id: "api-y-automatizacion", nombre: "API y automatización" },
  { id: "desbloqueo-por-contrasena", nombre: "Desbloqueo por contraseña" },
  { id: "interfaz-y-navegacion", nombre: "Interfaz y Navegación" },
  { id: "paquete-agente", nombre: "Paquete del agente" },
  { id: "enrolamiento", nombre: "Enrolamiento de agentes" },
  { id: "preguntas-frecuentes", nombre: "Preguntas frecuentes" },
] as const;

const PREGUNTAS_FRECUENTES: { pregunta: string; respuesta: string }[] = [
  {
    pregunta: "¿Estar en la lista blanca significa que un dispositivo ya no pide contraseña?",
    respuesta:
      "No. La lista blanca solo marca el dispositivo como conocido. La contraseña se sigue pidiendo siempre, y el desbloqueo dura hasta que el dispositivo se extrae: al volver a conectarlo, la pide otra vez.",
  },
  {
    pregunta: "¿Puedo desbloquear con la contraseña de administrador un dispositivo que no está en la lista blanca?",
    respuesta:
      "No, ni siquiera con la del administrador. Primero hay que darlo de alta en Lista blanca con su número de serie; sin eso, el equipo cliente solo muestra el aviso de dispositivo no listado y no ofrece campo de contraseña.",
  },
  {
    pregunta: "¿El administrador tiene que aprobar cada desbloqueo?",
    respuesta:
      "No hay aprobaciones de ningún tipo. La contraseña la introduce en el equipo cliente el dueño asignado a ese equipo, o un administrador usando la suya. El panel se limita a registrar el intento y su resultado.",
  },
  {
    pregunta: "¿Quién puede desbloquear los dispositivos de un equipo?",
    respuesta:
      "El usuario asignado a ese equipo (la asignación se hace en Usuarios, eligiendo el equipo) o cualquier administrador con su propia contraseña. Si el equipo está en modo «solo administrador», solo vale la contraseña de un administrador.",
  },
  {
    pregunta: "¿Qué pasa si el equipo cliente se queda sin red?",
    respuesta:
      "El agente bloquea igual, usando su copia local de la lista blanca, y guarda los eventos en una cola persistente que se sube cuando vuelve la conexión. Además, el equipo tiene una página de emergencia local para desbloquear sin red, con límite de intentos y registro diferido.",
  },
  {
    pregunta: "¿Cómo bloquea el agente un dispositivo?",
    respuesta:
      "Por capas, verificando cada una antes de darla por buena: primero deshabilita el dispositivo (PnP); si ese nodo no cede, aplica un candado de volumen sobre todas sus particiones; y solo como último recurso, lo deja en solo lectura, marcado como degradado. Todo lo que cambia lo anota con su valor original y lo revierte al extraer el dispositivo, al parar el servicio o al desinstalar.",
  },
  {
    pregunta: "¿Un disco duro externo se bloquea igual que una memoria USB?",
    respuesta:
      "Sí. Los discos conectados por USB se bloquean y desbloquean igual que las memorias. Y los discos internos nunca se tocan: para clasificar un disco como USB, el agente exige que su árbol de dispositivos cuelgue del bus USB, algo que un SATA o un NVMe interno jamás cumple; si la comprobación falla, el disco no se clasifica y no se toca.",
  },
  {
    pregunta: "¿Las impresoras USB se bloquean?",
    respuesta:
      "No. Las impresoras se detectan y aparecen en la lista de dispositivos del equipo con su etiqueta «Impresora», pero no se bloquean ni piden contraseña: no son almacenamiento. Los adaptadores de red USB tampoco son memorias: son un tipo propio («Red USB») y los que ya estaban conectados al arrancar el servicio no se bloquean.",
  },
  {
    pregunta:
      "¿Cómo preparo una máquina virtual o un equipo nuevo para la instalación remota?",
    respuesta:
      "La instalación remota sigue el modelo de Kaspersky: el panel empuja el agente por SMB (recurso C$) y lo instala creando un servicio temporal por RPC, sin WinRM ni SSH. Para que el empujón entre en una red sin dominio hay que cumplir los pasos de la lista de verificación de aquí abajo en el destino: compartición activa con la red en perfil Privado, una cuenta administradora local con contraseña y LocalAccountTokenFilterPolicy=1 para que el administrador entre completo en remoto. No hace falta fiarse de memoria: al crear la tarea, el panel comprueba los requisitos en vivo contra cada destino y la vista de Tareas enseña qué paso falló y con qué comando se arregla.",
  },
  {
    pregunta: "¿Qué hace el ajuste «Apagar el equipo si el dispositivo no está en la lista blanca»?",
    respuesta:
      "Si está activado, al insertar un dispositivo fuera de la lista blanca el equipo cliente inicia la cuenta atrás configurada (entre 10 y 600 segundos) y se apaga. La cuenta se cancela si el dispositivo se extrae o se desbloquea a tiempo, si el ajuste se desactiva o si el servicio se detiene; y no se aplica a lo que ya estaba conectado al arrancar el servicio, para que el equipo no entre en un bucle de apagados.",
  },
  {
    pregunta:
      "¿Qué es la captura de evidencia al bloquear un dispositivo no autorizado?",
    respuesta:
      "Con el ajuste «Capturar evidencia al bloquear un dispositivo no autorizado» activado, cuando el agente bloquea un dispositivo que no está en la lista blanca, el compañero guarda una foto de ese momento: la captura de pantalla de todos los monitores, qué ventana estaba en primer plano, la lista de procesos de la sesión con el título de sus ventanas (que revela los documentos abiertos) y las pestañas del navegador. Todo sube al panel pegado a ese bloqueo y se consulta con el botón «Evidencia» de la vista de Desbloqueos. Tiene límites claros: sin una sesión de Windows abierta y desbloqueada no hay escritorio que capturar y la evidencia llega sin imagen, con la nota de por qué; y de las pestañas, la garantizada es la activa de cada ventana del navegador — la lista completa se intenta por automatización de la ventana y, si el navegador no la expone, la evidencia lo dice marcando la lista como parcial. Está desactivada por defecto.",
  },
  {
    pregunta: "¿Cómo sé si el agente de un equipo está funcionando?",
    respuesta:
      "En Equipos, el estado sale de la última señal que el agente envió al panel: «En ejecución» o «Sin señal», sin datos duplicados. En Desbloqueos, los equipos que superan el umbral de silencio se marcan con su última señal: si alguien detiene o desinstala el agente, el panel lo evidencia por el silencio, aunque no pueda impedirlo físicamente.",
  },
  {
    pregunta: "¿Qué es el token por equipo y cómo se cambia?",
    respuesta:
      "Es la credencial con la que cada agente se identifica ante el panel. Se genera en Equipos, con el botón «Token del agente»: se muestra una sola vez, el panel guarda solo su huella y el agente lo guarda en el equipo. Generar uno nuevo invalida el anterior en el acto.",
  },
  {
    pregunta: "¿Cómo instalo el agente en un equipo nuevo?",
    respuesta:
      "Hay tres caminos: ejecutar el instalador en el propio equipo (el ejecutable se registra a sí mismo como servicio y crea la tarea del compañero); crear una tarea de instalación desde el escáner de red o desde Equipos, que lo empuja por SMB con la cuenta administradora del destino; o, si el equipo ya tiene un agente que reporta, la misma tarea lo actualiza por su canal sin tocar credenciales. En todos los casos el panel solo da el equipo por instalado cuando el agente da su primera señal.",
  },
  {
    pregunta:
      "¿Cómo preparo una máquina virtual (VMware) para instalarle el agente desde el panel?",
    respuesta:
      "Como cualquier equipo destino del empujón — la lista de verificación de aquí arriba se comprueba en vivo contra cada destino al crear la tarea. En VMware, el adaptador de red va en modo puente (bridged): la máquina queda en la misma red que el panel, con su propia IP; con NAT no se llega. Para Windows 11 hacen falta firmware UEFI y TPM virtual. Dentro de Windows: la conexión en perfil Privado; «Compartir archivos e impresoras» activo, que es lo que abre el puerto 445 y mantiene vivo el recurso C$; una cuenta administradora local con contraseña (no vale PIN ni cuenta Microsoft); y el valor LocalAccountTokenFilterPolicy = 1, para que ese administrador entre por red con su token completo y no recortado por UAC. Del lado del panel, el agente ya instalado tiene que poder volver al puerto del panel (3000): si la tarea instala pero el equipo nunca se confirma como instalado, lo que falla suele ser el cortafuegos del equipo del panel. Truco de prueba: con la máquina preparada y aún sin agente, sácale una instantánea y vuelve a ella tras cada intento, para repetir siempre desde la máquina virgen.",
  },
  {
    pregunta:
      "¿De dónde sale el ejecutable que se instala en remoto? ¿Interviene la caja de herramientas?",
    respuesta:
      "De la carpeta local del panel, no de internet: en «paquete-agente», junto al panel, se deja el USBMonitorService.exe vigente (con su manifiesto.json), y el empujador — el USBMonitorEmpujador.exe de la carpeta «empujador» — lo copia por SMB a C:\\USBMonitor del destino. Nada se descarga de GitHub durante la instalación: GitHub es solo el origen donde se recoge el paquete, porque el zip de la Release del agente trae los dos ejecutables. La caja de herramientas no interviene: en el destino, un servicio temporal ejecuta el ejecutable copiado en su modo «instalar-remoto», sin ventanas ni asistente, con la dirección de este panel y un token recién provisionado para ese equipo; registra el servicio, crea la tarea de inicio del compañero y el servicio temporal se borra solo. Las actualizaciones de agentes ya instalados parten del mismo sitio: descargan el paquete de este panel y verifican su SHA-256 antes de sustituirse.",
  },
  {
    pregunta:
      "¿Cómo actualizo el paquete del agente que el panel sirve a los demás equipos?",
    respuesta:
      "Desde Ajustes → Paquete del agente: sube el zip de la Release del agente (desde la v1.0.11 trae el ejecutable y el empujador) y el panel lo descomprime y coloca cada pieza en su carpeta — el ejecutable en «paquete-agente» y el empujador en «empujador» — y escribe el manifiesto con la versión, que se lee del propio ejecutable (su recurso de versión); el campo de versión y el nombre del zip solo cuentan si el ejecutable no declara ninguna. Ese paquete es el que los agentes ya instalados descargan al actualizarse (verificando su SHA-256) y el que el empujador copia a los equipos nuevos; y la versión del manifiesto es la que Equipos compara con la de cada equipo para enseñar el sello de «Actualización disponible».",
  },
  {
    pregunta: "¿Cómo funciona una tarea de instalación?",
    respuesta:
      "Una tarea es una instalación (o actualización) lanzada contra uno o varios equipos a la vez: la creas desde el escáner de red o desde Equipos, eligiendo los destinos y dando una vez el usuario y la contraseña de administrador de esos equipos. Para cada destino, el panel elige solo el método: si el equipo ya tiene un agente que da señales, se actualiza por su propio canal, sin credenciales; si no, va por empujón SMB. Con «omitir si ya está instalado» activado, un destino que ya corre el agente vigente se marca como omitido y no se toca. El panel trabaja con dos destinos a la vez, reintenta los fallos que pueden salir bien a la segunda (una sesión o un permiso denegado no se reintentan: no van a cambiar solos) y la vista de Tareas muestra cada estado en directo. Y un equipo solo se da por instalado cuando su agente da la primera señal al panel: que la copia termine no basta.",
  },
  {
    pregunta: "¿Dónde queda guardada la contraseña de una tarea?",
    respuesta:
      "En ningún sitio permanente: vive solo en la memoria del servidor mientras la tarea está en curso, y en la base de datos queda únicamente el usuario empleado y el historial de estados, nunca la clave. Por eso, si el panel se reinicia a mitad de una tarea, los destinos que estaban en curso quedan marcados como «Interrumpido» y reintentar la tarea vuelve a pedir la contraseña.",
  },
  {
    pregunta: "¿El agente y el compañero sobreviven a un reinicio?",
    respuesta:
      "Sí. El servicio se instala con arranque automático y recuperación ante fallos (Windows lo relanza si se cae). El compañero arranca al iniciar sesión mediante su tarea programada y, si en una sesión falta, el propio servicio lo vuelve a lanzar en la sesión del usuario.",
  },
  {
    pregunta: "¿Por qué no se ve el compañero aunque el servicio esté activo?",
    respuesta:
      "Es lo normal: el compañero arranca oculto y solo muestra su ventana cuando hay un dispositivo bloqueado esperando la contraseña. Oculto no significa ausente: sigue vigilando en segundo plano.",
  },
  {
    pregunta: "¿Qué tengo que hacer tras actualizar el panel desde GitHub?",
    respuesta:
      "Si el aviso de la actualización lo indica, ejecuta «npm run db:push» en la carpeta del panel para aplicar los cambios de la base de datos, y reconstruye con «npm run build» antes de arrancar con «npm run start». El agente se actualiza sustituyendo su ejecutable por el nuevo y reiniciando el servicio.",
  },
  {
    pregunta: "¿Para qué sirve Redis? ¿Dónde se configura?",
    respuesta:
      "Solo lo usa el límite de peticiones del panel. Se configura con la variable REDIS_URL del archivo .env (por ejemplo, redis://localhost:6379) y es lo recomendado en producción.",
  },
  {
    pregunta: "¿Cómo vuelvo a ver la guía introductoria?",
    respuesta:
      "Con el botón «Reactivar guía» de esta misma sección. La guía también aparece sola la primera vez que un administrador abre el panel en un navegador donde aún no la ha visto.",
  },
];

export function SettingsTab() {
  const { toast } = useToast();

  // La guía vive en el layout de administración: aquí solo se
  // limpia su marca de «ya vista» y se le pide que arranque.
  const reactivarGuia = () => {
    resetTour(adminTour.id);
    window.dispatchEvent(
      new CustomEvent("usb-monitor:restart-tour", {
        detail: { tourId: adminTour.id },
      }),
    );
    toast({
      title: "Guía introductoria",
      description: "El recorrido vuelve a empezar desde el principio.",
    });
  };
  const [api, setApi] = useState<ApiSettings>({
    startupNetworkDelay: 15,
  });
  const [unlock, setUnlock] = useState<UnlockSettings>({
    passwordUnlockEnabled: true,
    offlineEmergencyEnabled: true,
    requireAgentToken: false,
    lockSessionOnInsert: false,
    shutdownOnNonWhitelisted: false,
    shutdownCountdownSeconds: 60,
    captureEvidenceOnNonWhitelisted: false,
    silenceThresholdMinutes: 5,
  });

  const [apiInicial, setApiInicial] = useState<number | null>(null);
  const [unlockInicial, setUnlockInicial] = useState<UnlockSettings | null>(null);

  // Paquete del agente: estado leído del panel y subida del zip.
  const [paquete, setPaquete] = useState<EstadoPaquete | null>(null);
  const [archivoPaquete, setArchivoPaquete] = useState<File | null>(null);
  const [versionPaquete, setVersionPaquete] = useState("");
  const [subiendoPaquete, setSubiendoPaquete] = useState(false);
  const [mensajePaquete, setMensajePaquete] = useState<string | null>(null);
  // Actualización automática de los agentes (ajuste del panel).
  const [autoUpdate, setAutoUpdate] = useState(false);
  const [mensajeAutoUpdate, setMensajeAutoUpdate] = useState<string | null>(null);
  // Enrolamiento de la flota: clave compartida de alta de agentes.
  const [enrollConfigurada, setEnrollConfigurada] = useState<boolean | null>(null);
  const [claveEnrollNueva, setClaveEnrollNueva] = useState<string | null>(null);
  const [generandoEnroll, setGenerandoEnroll] = useState(false);
  const [mensajeEnroll, setMensajeEnroll] = useState<string | null>(null);
  const [errorEnroll, setErrorEnroll] = useState<string | null>(null);
  const [errorPaquete, setErrorPaquete] = useState<string | null>(null);
  const inputPaqueteRef = useRef<HTMLInputElement>(null);

  const disposicion = useLayoutStore((state) => state.disposicion);
  const setDisposicion = useLayoutStore((state) => state.setDisposicion);
  const { isLiveSyncEnabled, toggleLiveSync } = useLiveSyncStore();
  const mounted = useSyncExternalStore(
    () => () => {},
    () => true,
    () => false
  );

  useEffect(() => {
    fetch("/api/settings")
      .then((res) => res.json())
      .then((data) => {
        if (data.startup_network_delay !== undefined) {
          setApi({
            startupNetworkDelay: data.startup_network_delay,
          });
          setApiInicial(data.startup_network_delay);
        }
        const unlockCargado = {
          passwordUnlockEnabled: data.passwordUnlockEnabled ?? true,
          offlineEmergencyEnabled: data.offlineEmergencyEnabled ?? true,
          requireAgentToken: data.requireAgentToken ?? false,
          lockSessionOnInsert: data.lockSessionOnInsert ?? false,
          shutdownOnNonWhitelisted: data.shutdownOnNonWhitelisted ?? false,
          shutdownCountdownSeconds: data.shutdownCountdownSeconds ?? 60,
          captureEvidenceOnNonWhitelisted:
            data.captureEvidenceOnNonWhitelisted ?? false,
          silenceThresholdMinutes: data.silenceThresholdMinutes ?? 5,
        };
        setUnlock(unlockCargado);
        setUnlockInicial(unlockCargado);
        setAutoUpdate(Boolean(data.agentAutoUpdate));
      })
      .catch((err) => console.error("Failed to load settings", err));
  }, []);

  useEffect(() => {
    fetch("/api/admin/agent-package")
      .then((res) => res.json())
      .then((data) => {
        if (data.ok) {
          setPaquete({
            version: data.version ?? null,
            sha256: data.sha256 ?? null,
            agente: data.agente ?? { presente: false, tamano: 0 },
            empujador: data.empujador ?? { presente: false, tamano: 0 },
          });
        }
      })
      .catch((err) => console.error("Failed to load agent package", err));
  }, []);

  useEffect(() => {
    fetch("/api/agent/enroll-key")
      .then((res) => res.json())
      .then((data) => {
        if (data.ok) setEnrollConfigurada(Boolean(data.configured));
      })
      .catch((err) => console.error("Failed to load enroll key", err));
  }, []);

  const generarClaveEnroll = async () => {
    setGenerandoEnroll(true);
    setMensajeEnroll(null);
    setErrorEnroll(null);
    try {
      const res = await fetch("/api/agent/enroll-key", { method: "POST" });
      const data = await res.json();
      if (!data.ok) {
        setErrorEnroll(data.error || "No se pudo generar la clave de enrolamiento.");
        return;
      }
      setClaveEnrollNueva(data.key);
      setEnrollConfigurada(true);
      setMensajeEnroll(
        "Clave generada. Cópiala ahora: no se vuelve a mostrar. La anterior, si la había, ya no vale."
      );
    } catch {
      setErrorEnroll("No se pudo generar la clave de enrolamiento.");
    } finally {
      setGenerandoEnroll(false);
    }
  };

  const revocarClaveEnroll = async () => {
    setMensajeEnroll(null);
    setErrorEnroll(null);
    try {
      const res = await fetch("/api/agent/enroll-key", { method: "DELETE" });
      const data = await res.json();
      if (!data.ok) {
        setErrorEnroll(data.error || "No se pudo revocar la clave de enrolamiento.");
        return;
      }
      setEnrollConfigurada(false);
      setClaveEnrollNueva(null);
      setMensajeEnroll(
        "Clave revocada: ya no se puede enrolar ningún equipo nuevo. Los tokens ya emitidos siguen valiendo."
      );
    } catch {
      setErrorEnroll("No se pudo revocar la clave de enrolamiento.");
    }
  };

  const cambiarAutoUpdate = async (activo: boolean) => {
    setAutoUpdate(activo);
    setMensajeAutoUpdate(null);
    try {
      const res = await fetch("/api/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ agentAutoUpdate: activo }),
      });
      if (!res.ok) throw new Error("Error");
      setMensajeAutoUpdate(
        activo
          ? "Actualización automática activada: cada equipo se pondrá al día solo cuando el paquete sea más nuevo que su versión."
          : "Actualización automática desactivada."
      );
    } catch {
      setAutoUpdate(!activo);
      setMensajeAutoUpdate("No se pudo guardar el ajuste.");
    }
  };

  const subirPaquete = async () => {
    if (!archivoPaquete) {
      setErrorPaquete("Elige primero el zip de la Release del agente.");
      setMensajePaquete(null);
      return;
    }
    setSubiendoPaquete(true);
    setErrorPaquete(null);
    setMensajePaquete(null);
    try {
      const form = new FormData();
      form.append("paquete", archivoPaquete);
      if (versionPaquete.trim()) {
        form.append("version", versionPaquete.trim());
      }
      const csrfToken = getCsrfTokenFromDocument();
      if (!csrfToken) {
        setErrorPaquete(
          "La sesión no trae el token de seguridad: vuelve a iniciar sesión e inténtalo de nuevo.",
        );
        setSubiendoPaquete(false);
        return;
      }
      const res = await fetch("/api/admin/agent-package", {
        method: "POST",
        credentials: "include",
        headers: { "x-csrf-token": csrfToken },
        body: form,
      });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.ok) {
        setErrorPaquete(data?.error || "No se pudo colocar el paquete.");
        return;
      }
      setPaquete(data.estado);
      const avisos: string[] = Array.isArray(data.avisos) ? data.avisos : [];
      setMensajePaquete(
        [
          `Paquete colocado: agente v${data.estado.version ?? "sin versión"}.`,
          ...avisos,
        ].join(" "),
      );
      setArchivoPaquete(null);
      setVersionPaquete("");
      if (inputPaqueteRef.current) inputPaqueteRef.current.value = "";
    } catch {
      setErrorPaquete("No se pudo conectar con el servidor.");
    } finally {
      setSubiendoPaquete(false);
    }
  };

  const saveSettings = async (
    sectionLabel: string,
    payload: any,
    alGuardar?: () => void,
  ) => {
    try {
      const res = await fetch("/api/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (res.ok) {
        showSavedToast(sectionLabel);
        alGuardar?.();
      } else {
        toast({
          title: "Error al guardar",
          description: "Hubo un problema al aplicar los cambios.",
          variant: "destructive",
        });
      }
    } catch (err) {
      toast({
        title: "Error de red",
        description: "No se pudo conectar con el servidor.",
        variant: "destructive",
      });
    }
  };

  const showSavedToast = (label: string) =>
    toast({
      title: `${label} actualizado`,
      description: "Los cambios se aplicaron correctamente.",
    });

  return (
    <div data-tour="settings-main" className="animate-view-in lg:grid lg:grid-cols-[230px_minmax(0,1fr)] lg:gap-14">
      {/* ── Índice de ajustes ── */}
      <aside className="mb-10 lg:mb-0">
        <div className="lg:sticky lg:top-8">
          <p className="smallcaps text-muted-foreground">Índice de ajustes</p>
          <nav className="mt-4 flex gap-x-6 gap-y-1 overflow-x-auto lg:flex-col lg:overflow-visible">
            {SECCIONES.map((seccion) => (
              <a
                key={seccion.id}
                href={`#${seccion.id}`}
                className="smallcaps whitespace-nowrap py-1.5 text-muted-foreground transition-colors hover:text-foreground lg:border-l lg:border-border lg:pl-4 lg:hover:border-[var(--acero)]"
              >
                {seccion.nombre}
              </a>
            ))}
          </nav>
        </div>
      </aside>

      {/* ── Secciones ── */}
      <div className="min-w-0">
        <section id="sincronizacion-en-tiempo-real" className="scroll-mt-24 pb-12">
          <h2 className="font-display flex items-center gap-2.5 text-[1.4rem] font-bold leading-tight text-foreground">
            <Activity className="size-5 shrink-0 text-[var(--acero)]" />
            Sincronización en Tiempo Real
          </h2>
          <p className="mt-2 max-w-2xl text-sm leading-relaxed text-muted-foreground">
            Controla la recepción automática de datos a través de WebSockets.
          </p>

          <div className="mt-8 flex flex-row items-center justify-between gap-6">
            <div className="max-w-[80%] space-y-0.5">
              <Label className="text-base font-medium">Sincronización de datos en vivo</Label>
              <p className="text-xs leading-relaxed text-muted-foreground">
                Habilita o deshabilita la actualización automática de eventos, equipos y usuarios en la interfaz. Cuando está desactivado, podrás refrescar manualmente.
              </p>
            </div>
            {mounted && (
              <Switch
                checked={isLiveSyncEnabled}
                onCheckedChange={toggleLiveSync}
                
              />
            )}
          </div>
        </section>

        <section
          id="api-y-automatizacion"
          className="scroll-mt-24 border-t border-border py-12"
        >
          <h2 className="font-display flex items-center gap-2.5 text-[1.4rem] font-bold leading-tight text-foreground">
            <Server className="size-5 shrink-0 text-[var(--acero)]" />
            API y automatización
          </h2>
          <p className="mt-2 max-w-2xl text-sm leading-relaxed text-muted-foreground">
            Gestiona acceso al API REST y los comandos remotos del agente.
          </p>

          <div className="mt-8 max-w-xl">
            <Label className="text-xs font-semibold uppercase tracking-[0.22em] text-muted-foreground">
              Espera de red al arranque (segundos)
            </Label>
            <Input
              type="number"
              min={0}
              value={api.startupNetworkDelay}
              onChange={(event) =>
                setApi({ startupNetworkDelay: Number(event.target.value) || 0 })
              }
              className="mt-2"
            />
            <p className="mt-2 text-xs text-muted-foreground">
              Tiempo de espera en el arranque para parches de red.
            </p>
          </div>
          <Button
            className="mt-8"
            onClick={() =>
              saveSettings(
                "API y automatización",
                { startup_network_delay: api.startupNetworkDelay },
                () => setApiInicial(api.startupNetworkDelay),
              )
            }
            disabled={
              apiInicial === null ||
              api.startupNetworkDelay === apiInicial
            }
          >
            Guardar cambios
          </Button>
        </section>

        <section
          id="desbloqueo-por-contrasena"
          className="scroll-mt-24 border-t border-border py-12"
        >
          <h2 className="font-display flex items-center gap-2.5 text-[1.4rem] font-bold leading-tight text-foreground">
            <KeyRound className="size-5 shrink-0 text-[var(--acero)]" />
            Desbloqueo por contraseña
          </h2>
          <p className="mt-2 max-w-2xl text-sm leading-relaxed text-muted-foreground">
            Interruptores del flujo 2FA de los USB y de la detección de
            agentes por silencio.
          </p>

          <div className="mt-4 divide-y divide-border">
            <div className="flex items-center justify-between gap-4 py-5">
              <div>
                <Label>Desbloqueo por contraseña activo</Label>
                <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                  Si se apaga, ningún USB se libera con contraseña: queda
                  bloqueado como si no estuviera en la lista blanca.
                </p>
              </div>
              <Switch
                checked={unlock.passwordUnlockEnabled}
                onCheckedChange={(v) => setUnlock({ ...unlock, passwordUnlockEnabled: v })}
              />
            </div>
            <div className="flex items-center justify-between gap-4 py-5">
              <div>
                <Label>Emergencia sin red</Label>
                <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                  Permite desbloquear con la contraseña verificada contra el
                  hash guardado en la propia PC cuando no hay conexión.
                </p>
              </div>
              <Switch
                checked={unlock.offlineEmergencyEnabled}
                onCheckedChange={(v) => setUnlock({ ...unlock, offlineEmergencyEnabled: v })}
              />
            </div>
            <div className="flex items-center justify-between gap-4 py-5">
              <div>
                <Label>Exigir token por equipo</Label>
                <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                  La ingesta de eventos deja de ser abierta: cada agente se
                  autentica con su token. Actívalo cuando todos los agentes
                  estén actualizados.
                </p>
              </div>
              <Switch
                checked={unlock.requireAgentToken}
                onCheckedChange={(v) => setUnlock({ ...unlock, requireAgentToken: v })}
              />
            </div>
            <div className="flex items-center justify-between gap-4 py-5">
              <div>
                <Label>Bloquear la sesión al conectar un USB</Label>
                <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                  Además de bloquear el dispositivo, cierra la sesión de
                  Windows hasta que se desbloquee. Desactivado por defecto.
                </p>
              </div>
              <Switch
                checked={unlock.lockSessionOnInsert}
                onCheckedChange={(v) => setUnlock({ ...unlock, lockSessionOnInsert: v })}
              />
            </div>
            <div className="flex items-center justify-between gap-4 py-5">
              <div>
                <Label>Apagar el equipo si el dispositivo no está en la lista blanca</Label>
                <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                  Al insertar un dispositivo fuera de la lista blanca, el
                  equipo cliente inicia una cuenta atrás y se apaga,
                  con el tiempo que definas abajo. Se cancela si el dispositivo se extrae o se
                  desbloquea a tiempo, y no se aplica a lo que ya estaba
                  conectado al arrancar el servicio. Desactivado por
                  defecto.
                </p>
              </div>
              <Switch
                checked={unlock.shutdownOnNonWhitelisted}
                onCheckedChange={(v) => setUnlock({ ...unlock, shutdownOnNonWhitelisted: v })}
              />
            </div>
            <div className="flex items-center justify-between gap-4 py-5">
              <div>
                <Label>Capturar evidencia al bloquear un dispositivo no autorizado</Label>
                <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                  Al bloquear un dispositivo que no está en la lista
                  blanca, el equipo guarda una foto del momento: captura
                  de pantalla, la ventana en primer plano, los procesos
                  en marcha y las pestañas del navegador. La evidencia
                  queda en el panel, junto al bloqueo, en la vista de
                  Desbloqueos. Solo hay captura si la sesión de Windows
                  está abierta y desbloqueada. Desactivado por defecto.
                </p>
              </div>
              <Switch
                checked={unlock.captureEvidenceOnNonWhitelisted}
                onCheckedChange={(v) => setUnlock({ ...unlock, captureEvidenceOnNonWhitelisted: v })}
              />
            </div>
            <div className="py-5 pl-0">
              <div className="max-w-xl">
                <Label className="text-xs font-semibold uppercase tracking-[0.22em] text-muted-foreground">
                  Tiempo antes de apagar (segundos)
                </Label>
                <Input
                  type="number"
                  min={10}
                  max={600}
                  value={unlock.shutdownCountdownSeconds}
                  disabled={!unlock.shutdownOnNonWhitelisted}
                  onChange={(event) =>
                    setUnlock({ ...unlock, shutdownCountdownSeconds: Number(event.target.value) || 60 })
                  }
                  className="mt-2 w-28"
                />
                <p className="mt-2 text-xs text-muted-foreground">
                  Cuenta atrás visible en el equipo cliente antes de
                  apagarse: entre 10 y 600 segundos. Extraer o
                  desbloquear el dispositivo la cancela.
                </p>
              </div>
            </div>
            <div className="py-5">
              <div className="max-w-xl">
                <Label className="text-xs font-semibold uppercase tracking-[0.22em] text-muted-foreground">
                  Umbral de silencio del agente (minutos)
                </Label>
                <Input
                  type="number"
                  min={1}
                  value={unlock.silenceThresholdMinutes}
                  onChange={(event) =>
                    setUnlock({ ...unlock, silenceThresholdMinutes: Number(event.target.value) || 5 })
                  }
                  className="mt-2"
                />
                <p className="mt-2 text-xs text-muted-foreground">
                  Tiempo sin señales para marcar un equipo «sin agente» en la
                  vista de Desbloqueos.
                </p>
              </div>
            </div>
          </div>
          <Button
            onClick={() =>
              saveSettings("Desbloqueo por contraseña", { ...unlock }, () =>
                setUnlockInicial({ ...unlock }),
              )
            }
            disabled={
              unlockInicial === null ||
              JSON.stringify(unlock) === JSON.stringify(unlockInicial)
            }
          >
            Guardar cambios
          </Button>
        </section>

        <section
          id="interfaz-y-navegacion"
          className="scroll-mt-24 border-t border-border py-12"
        >
          <h2 className="font-display flex items-center gap-2.5 text-[1.4rem] font-bold leading-tight text-foreground">
            <LayoutTemplate className="size-5 shrink-0 text-[var(--acero)]" />
            Interfaz y Navegación
          </h2>
          <p className="mt-2 max-w-2xl text-sm leading-relaxed text-muted-foreground">
            Personaliza la experiencia visual y los componentes del dashboard.
          </p>

          <div className="mt-8">
            <Label className="text-xs font-semibold uppercase tracking-[0.22em] text-muted-foreground">
              Disposición del panel
            </Label>
            <div className="mt-3 flex flex-wrap gap-3">
              {(
                [
                  {
                    valor: "cabecera",
                    titulo: "Cabecera",
                    detalle: "Navegación en la barra superior",
                    Icono: PanelTop,
                  },
                  {
                    valor: "lateral",
                    titulo: "Barra lateral",
                    detalle: "Navegación a la izquierda",
                    Icono: PanelLeft,
                  },
                ] as const
              ).map(({ valor, titulo, detalle, Icono }) => {
                const activa = disposicion === valor;
                return (
                  <button
                    key={valor}
                    type="button"
                    onClick={() => setDisposicion(valor as Disposicion)}
                    aria-pressed={activa}
                    className={
                      activa
                        ? "flex min-w-[220px] items-start gap-3 border border-[var(--acero)] bg-primary/[0.05] px-4 py-3.5 text-left"
                        : "flex min-w-[220px] items-start gap-3 border border-border px-4 py-3.5 text-left transition-colors hover:border-muted-foreground/50"
                    }
                  >
                    <Icono
                      className={
                        activa
                          ? "mt-0.5 size-5 shrink-0 text-[var(--acero)]"
                          : "mt-0.5 size-5 shrink-0 text-muted-foreground"
                      }
                    />
                    <span>
                      <span className="block text-sm font-semibold text-foreground">
                        {titulo}
                      </span>
                      <span className="mt-0.5 block text-xs leading-relaxed text-muted-foreground">
                        {detalle}
                      </span>
                    </span>
                  </button>
                );
              })}
            </div>
            <p className="mt-3 max-w-xl text-xs leading-relaxed text-muted-foreground">
              Se aplica al momento y se recuerda en este navegador. En
              pantallas pequeñas se usa siempre la cabecera.
            </p>
          </div>
        </section>

        <section
          id="paquete-agente"
          className="scroll-mt-24 border-t border-border py-12"
        >
          <h2 className="font-display flex items-center gap-2.5 text-[1.4rem] font-bold leading-tight text-foreground">
            <Package className="size-5 shrink-0 text-[var(--acero)]" />
            Paquete del agente
          </h2>
          <p className="mt-2 max-w-2xl text-sm leading-relaxed text-muted-foreground">
            Sube el zip de la Release del agente: trae el ejecutable y
            el empujador. El panel los coloca en sus carpetas, listos
            para las actualizaciones y las instalaciones en remoto, y
            escribe el manifiesto con la versión.
          </p>

          <div className="mt-8 max-w-3xl border border-border/60 bg-muted/20 px-4 py-4">
            <p className="text-sm font-semibold text-foreground">
              {paquete?.version
                ? `Paquete colocado: agente v${paquete.version}`
                : "Sin paquete colocado"}
            </p>
            <dl className="mt-3 space-y-1.5 text-sm leading-relaxed text-muted-foreground">
              <div className="flex flex-wrap gap-x-2">
                <dt className="font-medium text-foreground">
                  Ejecutable del agente:
                </dt>
                <dd>
                  {paquete?.agente.presente
                    ? `colocado (${formatoTamano(paquete.agente.tamano)})`
                    : "no está"}
                </dd>
              </div>
              <div className="flex flex-wrap gap-x-2">
                <dt className="font-medium text-foreground">Empujador:</dt>
                <dd>
                  {paquete?.empujador.presente
                    ? `colocado (${formatoTamano(paquete.empujador.tamano)})`
                    : "no está"}
                </dd>
              </div>
            </dl>
            {paquete && !paquete.empujador.presente && (
              <p className="mt-3 max-w-xl text-xs leading-relaxed text-muted-foreground">
                Sin el empujador colocado, las tareas de instalación no
                pueden llegar a los equipos que aún no tienen agente.
              </p>
            )}
          </div>

          <div className="mt-8 max-w-3xl">
            <Label
              htmlFor="paquete-zip"
              className="text-xs font-semibold uppercase tracking-[0.22em] text-muted-foreground"
            >
              Zip de la Release del agente
            </Label>
            <Input
              id="paquete-zip"
              ref={inputPaqueteRef}
              type="file"
              accept=".zip"
              className="mt-3"
              onChange={(e) => {
                setArchivoPaquete(e.target.files?.[0] ?? null);
                setErrorPaquete(null);
                setMensajePaquete(null);
              }}
            />
            <Label
              htmlFor="paquete-version"
              className="mt-6 block text-xs font-semibold uppercase tracking-[0.22em] text-muted-foreground"
            >
              Versión
            </Label>
            <Input
              id="paquete-version"
              value={versionPaquete}
              onChange={(e) => setVersionPaquete(e.target.value)}
              placeholder="Versión (solo si el ejecutable no la declara)"
              className="mt-3 max-w-xs"
            />
            <div className="mt-6">
              <Button onClick={subirPaquete} disabled={subiendoPaquete}>
                {subiendoPaquete ? "Subiendo y colocando…" : "Subir y colocar"}
              </Button>
            </div>
            {mensajePaquete && (
              <p className="mt-4 max-w-xl text-sm leading-relaxed text-emerald-700 dark:text-emerald-500">
                {mensajePaquete}
              </p>
            )}
            {errorPaquete && (
              <p className="mt-4 max-w-xl text-sm leading-relaxed text-red-700 dark:text-red-500">
                {errorPaquete}
              </p>
            )}
          </div>

          <div className="mt-6 flex max-w-3xl items-start justify-between gap-4 border border-border/60 bg-muted/20 px-4 py-4">
            <div>
              <p className="text-sm font-semibold text-foreground">
                Actualización automática de los agentes
              </p>
              <p className="mt-1 max-w-xl text-sm leading-relaxed text-muted-foreground">
                Con esto encendido, cada equipo se actualiza solo en
                cuanto el paquete colocado sea más nuevo que la
                versión que corre, sin pulsar «Actualizar» en
                Equipos. La descarga verifica el SHA-256 del paquete,
                como siempre. Apagado, la actualización se sigue
                pudiendo pedir desde Equipos o desde la caja de
                herramientas de cada equipo.
              </p>
              {mensajeAutoUpdate && (
                <p className="mt-2 text-sm text-success">{mensajeAutoUpdate}</p>
              )}
            </div>
            <Switch
              checked={autoUpdate}
              onCheckedChange={cambiarAutoUpdate}
              aria-label="Actualización automática de los agentes"
            />
          </div>
        </section>

        <section
          id="enrolamiento"
          className="scroll-mt-24 border-t border-border py-12"
        >
          <h2 className="font-display flex items-center gap-2.5 text-[1.4rem] font-bold leading-tight text-foreground">
            <KeyRound className="size-5 shrink-0 text-[var(--acero)]" />
            Enrolamiento de agentes
          </h2>
          <p className="mt-2 max-w-2xl text-sm leading-relaxed text-muted-foreground">
            Una sola clave de despliegue para dar de alta los equipos
            nuevos: la escribes en el asistente del agente de cada PC
            (paso «Credencial del equipo») y el panel le emite su
            token propio automáticamente, sin generar ni transportar
            tokens equipo a equipo. Los agentes ya dados de alta
            rotan su token solos cada día, sin corte.
          </p>
          <div className="mt-8 max-w-3xl border border-border/60 bg-muted/20 px-4 py-4">
            <p className="text-sm font-semibold text-foreground">
              {enrollConfigurada === null
                ? "Comprobando…"
                : enrollConfigurada
                  ? "Clave de enrolamiento activa"
                  : "Sin clave de enrolamiento"}
            </p>
            <p className="mt-2 max-w-xl text-sm leading-relaxed text-muted-foreground">
              Quien tenga esta clave puede dar de alta un equipo:
              trátala como una contraseña de despliegue. Generar una
              nueva invalida la anterior al instante; revocarla no
              toca los tokens de los equipos ya enrolados.
            </p>
            {claveEnrollNueva && (
              <div className="mt-4">
                <label
                  className="smallcaps text-muted-foreground"
                  htmlFor="clave-enroll"
                >
                  Clave nueva (se muestra una sola vez)
                </label>
                <input
                  id="clave-enroll"
                  readOnly
                  value={claveEnrollNueva}
                  onFocus={(e) => e.target.select()}
                  className="mt-1.5 w-full rounded border border-input bg-background px-3.5 py-2.5 font-mono text-sm"
                />
              </div>
            )}
            <div className="mt-4 flex flex-wrap gap-2">
              <Button onClick={generarClaveEnroll} disabled={generandoEnroll}>
                {generandoEnroll
                  ? "Generando…"
                  : enrollConfigurada
                    ? "Generar una clave nueva"
                    : "Generar la clave"}
              </Button>
              {enrollConfigurada && (
                <Button variant="outline" onClick={revocarClaveEnroll}>
                  Revocar la clave
                </Button>
              )}
            </div>
            {mensajeEnroll && (
              <p className="mt-3 text-sm text-success">{mensajeEnroll}</p>
            )}
            {errorEnroll && (
              <p className="mt-3 text-sm text-destructive">{errorEnroll}</p>
            )}
          </div>
        </section>

        <section
          id="preguntas-frecuentes"
          className="scroll-mt-24 border-t border-border py-12"
        >
          <h2 className="font-display flex items-center gap-2.5 text-[1.4rem] font-bold leading-tight text-foreground">
            <HelpCircle className="size-5 shrink-0 text-[var(--acero)]" />
            Preguntas frecuentes
          </h2>
          <p className="mt-2 max-w-xl text-sm leading-relaxed text-muted-foreground">
            Cómo se comporta el sistema en los casos que más se
            preguntan: la lista blanca, los desbloqueos, los agentes
            y las actualizaciones.
          </p>

          <div className="mt-8 flex flex-wrap items-center justify-between gap-4 border border-border/60 bg-muted/20 px-4 py-4">
            <div>
              <p className="text-sm font-semibold text-foreground">
                Guía introductoria
              </p>
              <p className="mt-1 max-w-md text-xs leading-relaxed text-muted-foreground">
                Vuelve a ver el recorrido guiado por el panel: la
                vista se mueve sola hasta cada sección y la enfoca
                sobre el fondo oscuro.
              </p>
            </div>
            <Button variant="outline" onClick={reactivarGuia}>
              <RotateCcw className="mr-2 size-4" />
              Reactivar guía
            </Button>
          </div>

          <div className="mt-8 border border-border/60 bg-muted/20 px-4 py-4">
            <p className="text-sm font-semibold text-foreground">
              Lista de verificación — empujón SMB en una máquina recién creada
            </p>
            <p className="mt-1 max-w-xl text-xs leading-relaxed text-muted-foreground">
              Los pasos del destino, en orden, con el comando de
              cada uno. En la vista de Tareas esta misma lista se
              comprueba en vivo contra cada destino y cada paso se
              marca solo cuando el destino lo cumple.
            </p>
            <div className="mt-4 max-w-3xl">
              <EmpujeChecklist />
            </div>
          </div>

          <div className="mt-6">
            {PREGUNTAS_FRECUENTES.map((item) => (
              <Collapsible
                key={item.pregunta}
                className="border-b border-border/60"
              >
                <CollapsibleTrigger className="group flex w-full items-center justify-between gap-4 py-4 text-left">
                  <span className="text-sm font-medium text-foreground">
                    {item.pregunta}
                  </span>
                  <ChevronDown className="size-4 shrink-0 text-muted-foreground transition-transform duration-200 group-data-[state=open]:rotate-180" />
                </CollapsibleTrigger>
                <CollapsibleContent>
                  <p className="max-w-3xl pb-5 text-sm leading-relaxed text-muted-foreground">
                    {item.respuesta}
                  </p>
                </CollapsibleContent>
              </Collapsible>
            ))}
          </div>
        </section>
      </div>
    </div>
  );
}
