"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
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
  SlidersHorizontal,
  Loader2
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
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";

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

const CATEGORIES = [
  { id: "events", label: "Eventos" },
  { id: "users", label: "Usuarios" },
  { id: "computers", label: "Equipos" },
  { id: "whitelist", label: "Lista Blanca" },
];

function useDebounce<T>(value: T, delay: number): T {
  const [debouncedValue, setDebouncedValue] = useState<T>(value);
  useEffect(() => {
    const handler = setTimeout(() => {
      setDebouncedValue(value);
    }, delay);
    return () => clearTimeout(handler);
  }, [value, delay]);
  return debouncedValue;
}

/* ────── Component ────── */
export function CommandPalette({ role }: CommandPaletteProps) {
  const [open, setOpen] = useState(false);
  const router = useRouter();
  const { setTheme, theme } = useTheme();

  // Search State
  const [searchQuery, setSearchQuery] = useState("");
  const debouncedSearch = useDebounce(searchQuery, 300);
  const [selectedCategories, setSelectedCategories] = useState<string[]>(
    CATEGORIES.map((c) => c.id)
  );

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

  /* ── Navigation Commands list ── */
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

  /* ── Search Query ── */
  const { data: searchResults, isFetching } = useQuery({
    queryKey: ["globalSearch", debouncedSearch, selectedCategories],
    queryFn: async () => {
      if (!debouncedSearch || debouncedSearch.length < 2) return null;
      const params = new URLSearchParams();
      params.set("q", debouncedSearch);
      params.set("categories", selectedCategories.join(","));
      const res = await fetch(`/api/search?${params.toString()}`);
      if (!res.ok) throw new Error("Search failed");
      return res.json();
    },
    enabled: debouncedSearch.length >= 2,
    staleTime: 1000 * 60,
  });

  const toggleCategory = (id: string, checked: boolean) => {
    setSelectedCategories((prev) =>
      checked ? [...prev, id] : prev.filter((c) => c !== id)
    );
  };

  const isSearching = debouncedSearch.length >= 2;
  const hasResults =
    searchResults &&
    (searchResults.users?.length > 0 ||
      searchResults.computers?.length > 0 ||
      searchResults.whitelist?.length > 0 ||
      searchResults.events?.length > 0);

  return (
    <CommandDialog
      open={open}
      onOpenChange={setOpen}
      title="Búsqueda global"
      description="Busca en todas las entidades o ejecuta un comando..."
      shouldFilter={!isSearching} // Disable local filter when fetching results
    >
      <CommandInput
        placeholder="Buscar sección, usuario, equipo o evento..."
        value={searchQuery}
        onValueChange={setSearchQuery}
        endAdornment={
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="size-7 mr-2 text-muted-foreground hover:bg-muted"
                aria-label="Filtrar resultados"
              >
                <SlidersHorizontal className="size-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-48">
              <DropdownMenuLabel>Filtros de búsqueda</DropdownMenuLabel>
              <DropdownMenuSeparator />
              {CATEGORIES.map((cat) => (
                <DropdownMenuCheckboxItem
                  key={cat.id}
                  checked={selectedCategories.includes(cat.id)}
                  onCheckedChange={(checked) => toggleCategory(cat.id, checked)}
                >
                  {cat.label}
                </DropdownMenuCheckboxItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        }
      />
      
      <CommandList>
        {isFetching && (
          <div className="py-6 flex items-center justify-center text-sm text-muted-foreground">
            <Loader2 className="mr-2 size-4 animate-spin" />
            Buscando resultados...
          </div>
        )}

        {!isFetching && isSearching && !hasResults && (
          <CommandEmpty>No se encontraron resultados para "{searchQuery}" en las categorías seleccionadas.</CommandEmpty>
        )}
        
        {!isFetching && !isSearching && (
          <CommandEmpty>Sin resultados.</CommandEmpty>
        )}

        {isSearching && searchResults ? (
          <>
            {searchResults.users?.length > 0 && (
              <CommandGroup heading="Usuarios">
                {searchResults.users.map((user: any) => (
                  <CommandItem
                    key={`user-${user.id}`}
                    value={`user ${user.username}`}
                    onSelect={() => navigate(`/admin/users?search=${user.username}`)}
                  >
                    <Users className="mr-2 size-4 shrink-0 opacity-60" />
                    <div className="flex flex-col">
                      <span>{user.username}</span>
                      <span className="text-xs text-muted-foreground uppercase">{user.role}</span>
                    </div>
                  </CommandItem>
                ))}
              </CommandGroup>
            )}

            {searchResults.computers?.length > 0 && (
              <CommandGroup heading="Equipos">
                {searchResults.computers.map((computer: any) => (
                  <CommandItem
                    key={`comp-${computer.id}`}
                    value={`computer ${computer.name} ${computer.ipAddress}`}
                    onSelect={() => navigate(`/admin/computers?search=${computer.name}`)}
                  >
                    <MonitorSmartphone className="mr-2 size-4 shrink-0 opacity-60" />
                    <div className="flex flex-col">
                      <span>{computer.name}</span>
                      <span className="text-xs text-muted-foreground">{computer.ipAddress}</span>
                    </div>
                  </CommandItem>
                ))}
              </CommandGroup>
            )}

            {searchResults.whitelist?.length > 0 && (
              <CommandGroup heading="Lista Blanca">
                {searchResults.whitelist.map((wl: any) => (
                  <CommandItem
                    key={`wl-${wl.id}`}
                    value={`whitelist ${wl.serialNumber} ${wl.label ?? ""}`}
                    onSelect={() => navigate(`/admin/whitelist?search=${wl.serialNumber}`)}
                  >
                    <ShieldCheck className="mr-2 size-4 shrink-0 opacity-60" />
                    <div className="flex flex-col">
                      <span>{wl.serialNumber}</span>
                      {wl.label && <span className="text-xs text-muted-foreground">{wl.label}</span>}
                    </div>
                  </CommandItem>
                ))}
              </CommandGroup>
            )}

            {searchResults.events?.length > 0 && (
              <CommandGroup heading="Eventos">
                {searchResults.events.map((ev: any) => (
                  <CommandItem
                    key={`ev-${ev.id}`}
                    value={`event ${ev.pcName} ${ev.event}`}
                    onSelect={() => navigate(`/admin/events`)}
                  >
                    <Usb className="mr-2 size-4 shrink-0 opacity-60" />
                    <div className="flex flex-col">
                      <span>{ev.event} en {ev.pcName}</span>
                      <span className="text-xs text-muted-foreground">{new Date(ev.timestamp).toLocaleString()}</span>
                    </div>
                  </CommandItem>
                ))}
              </CommandGroup>
            )}
          </>
        ) : (
          <>
            {!isSearching && (
              <>
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
              </>
            )}
          </>
        )}
      </CommandList>
    </CommandDialog>
  );
}
