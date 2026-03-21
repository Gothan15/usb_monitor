"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Clock,
  Key,
  LayoutDashboard,
  MonitorSmartphone,
  Moon,
  Radar,
  Search,
  ShieldCheck,
  Sun,
  Usb,
  Users,
  Wrench,
} from "lucide-react";
import { useTheme } from "next-themes";
import type { LucideIcon } from "lucide-react";
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from "@/components/ui/command";

/* ────── Types ────── */
interface CommandEntry {
  id: string;
  label: string;
  icon: LucideIcon;
  keywords?: string;
  action: () => void;
  group: "navigation" | "actions" | "theme";
}

/* ────── Props ────── */
interface CommandPaletteProps {
  /** Current user role, determines which nav items show */
  role?: "ADMIN" | "USER" | null;
}

/* ────── Component ────── */
export function CommandPalette({ role }: CommandPaletteProps) {
  const [open, setOpen] = useState(false);
  const router = useRouter();
  const { setTheme, theme } = useTheme();

  /* ── Keyboard shortcut ── */
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        setOpen((prev) => !prev);
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, []);

  const navigate = useCallback(
    (href: string) => {
      setOpen(false);
      router.push(href);
    },
    [router],
  );

  /* ── Commands list ── */
  const commands = useMemo<CommandEntry[]>(() => {
    const entries: CommandEntry[] = [];

    if (role === "ADMIN") {
      entries.push(
        {
          id: "nav-overview",
          label: "Resumen general",
          icon: LayoutDashboard,
          keywords: "panel resumen inicio",
          action: () => navigate("/admin"),
          group: "navigation",
        },
        {
          id: "nav-events",
          label: "Eventos USB",
          icon: Usb,
          keywords: "eventos pendrive usb",
          action: () => navigate("/admin/events"),
          group: "navigation",
        },
        {
          id: "nav-computers",
          label: "Equipos",
          icon: MonitorSmartphone,
          keywords: "computadoras máquinas agentes",
          action: () => navigate("/admin/computers"),
          group: "navigation",
        },
        {
          id: "nav-users",
          label: "Usuarios",
          icon: Users,
          keywords: "cuentas permisos roles",
          action: () => navigate("/admin/users"),
          group: "navigation",
        },
        {
          id: "nav-whitelist",
          label: "Lista blanca",
          icon: ShieldCheck,
          keywords: "lista blanca autorizados permitidos",
          action: () => navigate("/admin/whitelist"),
          group: "navigation",
        },
        {
          id: "nav-network",
          label: "Escáner de red",
          icon: Radar,
          keywords: "red escaneo hosts",
          action: () => navigate("/admin/network"),
          group: "navigation",
        },
        {
          id: "nav-settings",
          label: "Ajustes",
          icon: Wrench,
          keywords: "configuración políticas",
          action: () => navigate("/admin/settings"),
          group: "navigation",
        },
      );
    } else {
      entries.push(
        {
          id: "nav-devices",
          label: "Dispositivos",
          icon: Usb,
          keywords: "usb pendrive",
          action: () => navigate("/user"),
          group: "navigation",
        },
        {
          id: "nav-history",
          label: "Historial",
          icon: Clock,
          keywords: "eventos historia",
          action: () => navigate("/user/history"),
          group: "navigation",
        },
        {
          id: "nav-apikey",
          label: "Clave API",
          icon: Key,
          keywords: "credenciales token",
          action: () => navigate("/user/apikey"),
          group: "navigation",
        },
      );
    }

    /* Theme actions */
    entries.push(
      {
        id: "theme-light",
        label: "Tema claro",
        icon: Sun,
        keywords: "tema claro",
        action: () => {
          setTheme("light");
          setOpen(false);
        },
        group: "theme",
      },
      {
        id: "theme-dark",
        label: "Tema oscuro",
        icon: Moon,
        keywords: "tema oscuro",
        action: () => {
          setTheme("dark");
          setOpen(false);
        },
        group: "theme",
      },
    );

    return entries;
  }, [role, navigate, setTheme]);

  const navCommands = commands.filter((c) => c.group === "navigation");
  const themeCommands = commands.filter((c) => c.group === "theme");

  return (
    <CommandDialog
      open={open}
      onOpenChange={setOpen}
      title="Paleta de comandos"
      description="Busca secciones y acciones rápidas"
    >
      <CommandInput placeholder="Buscar sección o acción..." />
      <CommandList>
        <CommandEmpty>Sin resultados.</CommandEmpty>

        <CommandGroup heading="Navegación">
          {navCommands.map((cmd) => (
            <CommandItem
              key={cmd.id}
              value={`${cmd.label} ${cmd.keywords ?? ""}`}
              onSelect={cmd.action}
            >
              <cmd.icon className="mr-2 size-4 shrink-0 opacity-60" />
              <span>{cmd.label}</span>
            </CommandItem>
          ))}
        </CommandGroup>

        <CommandSeparator />

        <CommandGroup heading="Apariencia">
          {themeCommands.map((cmd) => (
            <CommandItem
              key={cmd.id}
              value={`${cmd.label} ${cmd.keywords ?? ""}`}
              onSelect={cmd.action}
            >
              <cmd.icon className="mr-2 size-4 shrink-0 opacity-60" />
              <span>{cmd.label}</span>
            </CommandItem>
          ))}
        </CommandGroup>
      </CommandList>
    </CommandDialog>
  );
}
