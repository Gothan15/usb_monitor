"use client";

import type { ReactNode } from "react";
import { useMemo } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Clock, Key, ShieldCheck, Usb } from "lucide-react";
import { ThemeToggle } from "@/components/system/ThemeToggle";
import { cn } from "@/lib/utils";
import { LogoutButton } from "@/components/system/LogoutButton";
import { useAmbientScrollbar } from "@/hooks/useAmbientScrollbar";

const navItems = [
  {
    key: "devices",
    label: "Dispositivos",
    description: "Estado de USB activos",
    icon: Usb,
  },
  {
    key: "history",
    label: "Historial",
    description: "Eventos recientes",
    icon: Clock,
  },
  {
    key: "apikey",
    label: "API Key",
    description: "Credenciales seguras",
    icon: Key,
  },
] as const;

type ViewKey = (typeof navItems)[number]["key"];

export default function BasicUserLayout({ children }: { children: ReactNode }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const {
    containerProps: navScrollProps,
    scrollbarClassName: navScrollbarClassName,
  } = useAmbientScrollbar();
  const {
    containerProps: contentScrollProps,
    scrollbarClassName: contentScrollbarClassName,
  } = useAmbientScrollbar();

  const activeKey = useMemo<ViewKey>(() => {
    const raw = searchParams?.get("view");
    if (raw === "devices" || raw === "history" || raw === "apikey") {
      return raw;
    }
    return "devices";
  }, [searchParams]);

  const navigate = (key: ViewKey) => {
    if (key === "devices") {
      router.push("/basic-user", { scroll: false });
      return;
    }
    router.push(`/basic-user?view=${key}`, { scroll: false });
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-slate-100 to-slate-50 dark:from-slate-950 dark:via-slate-900 dark:to-slate-950">
      <div className="flex min-h-screen">
        <aside
          {...navScrollProps}
          className={cn(
            "hidden w-64 shrink-0 border-r border-slate-200/70 bg-white/80 backdrop-blur-sm transition-colors dark:border-slate-800/70 dark:bg-slate-950/60 md:flex md:flex-col md:sticky md:top-0 md:h-screen md:overflow-y-auto",
            navScrollbarClassName
          )}
        >
          <div className="flex h-20 items-center gap-3 border-b border-slate-200/70 px-6 dark:border-slate-800/70">
            <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-slate-900 text-white shadow-md dark:bg-slate-700">
              <ShieldCheck className="h-6 w-6" />
            </div>
            <div>
              <p className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                Monitor USB
              </p>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Espacio del usuario básico
              </p>
            </div>
          </div>
          <nav className="flex-1 space-y-1 px-4 py-6">
            {navItems.map(({ key, label, description, icon: Icon }) => {
              const isActive = key === activeKey;
              return (
                <button
                  key={key}
                  type="button"
                  onClick={() => navigate(key)}
                  className={cn(
                    "group flex w-full flex-col gap-1 rounded-lg px-3 py-2 text-left transition-all",
                    isActive
                      ? "bg-slate-900 text-white shadow-sm dark:bg-slate-700"
                      : "text-slate-600 hover:translate-x-1 hover:bg-slate-100/80 hover:text-slate-900 dark:text-slate-300 dark:hover:bg-slate-800/60 dark:hover:text-white"
                  )}
                >
                  <div className="flex items-center gap-3">
                    <div
                      className={cn(
                        "flex h-9 w-9 items-center justify-center rounded-md border transition-all",
                        isActive
                          ? "border-slate-800 bg-white text-slate-900 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100"
                          : "border-transparent bg-slate-100 text-slate-500 group-hover:border-slate-300 group-hover:bg-white group-hover:text-slate-900 dark:bg-slate-900 dark:text-slate-400 dark:group-hover:border-slate-700 dark:group-hover:bg-slate-800 dark:group-hover:text-slate-100"
                      )}
                    >
                      <Icon className="h-4 w-4" />
                    </div>
                    <span className="text-sm font-semibold">{label}</span>
                  </div>
                  <span className="pl-12 text-xs font-medium text-slate-500 transition-colors group-hover:text-slate-600 dark:text-slate-400 dark:group-hover:text-slate-300">
                    {description}
                  </span>
                </button>
              );
            })}
          </nav>
          <div className="px-4 pb-6">
            <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 text-xs text-slate-500 shadow-sm transition-colors dark:border-slate-800 dark:bg-slate-900 dark:text-slate-400">
              <p className="font-semibold text-slate-700 dark:text-slate-200">
                Consejo de seguridad
              </p>
              <p className="mt-1 leading-relaxed">
                Desconecta los dispositivos USB cuando finalices su uso para
                evitar accesos no autorizados.
              </p>
            </div>
          </div>
        </aside>

        <div className="flex min-h-screen flex-1 flex-col">
          <header className="sticky top-0 z-20 border-b border-slate-200/80 bg-white/90 backdrop-blur-md transition-colors dark:border-slate-800/70 dark:bg-slate-950/70">
            <div className="flex h-20 items-center justify-between px-4 sm:px-6">
              <div>
                <h1 className="text-xl font-bold tracking-tight text-slate-900 dark:text-slate-100">
                  Área de usuario
                </h1>
                <p className="text-sm text-slate-500 dark:text-slate-400">
                  Consulta tus dispositivos autorizados y la actividad reciente.
                </p>
              </div>
              <div className="flex items-center gap-3">
                <ThemeToggle />
                <LogoutButton />
              </div>
            </div>
          </header>

          <main
            {...contentScrollProps}
            className={cn(
              "flex-1 overflow-y-auto px-4 py-6 sm:px-6 md:px-8 scroll-smooth",
              contentScrollbarClassName
            )}
          >
            <div className="mx-auto w-full max-w-6xl space-y-6 pb-24">
              {children}
            </div>
          </main>
        </div>
      </div>
    </div>
  );
}
