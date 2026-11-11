"use client";
import React, { useEffect, useState, useSyncExternalStore } from "react";
import { FullscreenSpinner } from "@/components/ui/spinner";

// Componente cliente separado para control de sesión sin forzar layout a client component
export default function AuthGate({ children }: { children: React.ReactNode }) {
  const [status, setStatus] = useState<"checking" | "ok" | "login">("checking");
  const mounted = useSyncExternalStore(
    () => () => {},
    () => true,
    () => false
  );
  const channelRef = React.useRef<BroadcastChannel | null>(null);

  // NOTA HIDRATACIÓN:
  // Antes devolvíamos 'children' en SSR y 'null' en el primer render cliente (status = 'checking'),
  // provocando mismatch de hidratación. Ahora siempre devolvemos la misma estructura inicial.

  useEffect(() => {
    let cancelled = false;
    async function check(full = false) {
      try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 8000);
        // Usamos HEAD /api/auth/ping para comprobaciones ligeras.
        // Si es 'full' (primer check) usamos GET /api/auth/session para también renovar.
        const res = await fetch(full ? "/api/auth/session" : "/api/auth/ping", {
          method: full ? "GET" : "HEAD",
          cache: "no-store",
          signal: controller.signal,
          credentials: "include",
        });
        clearTimeout(timeout);
        if (res.status === 401) {
          if (!cancelled) setStatus("login");
          return;
        }
        if (!res.ok) {
          if (!cancelled) setStatus("login");
          return;
        }
        if (!cancelled) setStatus("ok");
      } catch {
        if (!cancelled) setStatus("login");
      }
    }
    // Primer check completo (renueva session cookie si procede)
    check(true);
    const interval = setInterval(() => check(false), 60_000);

    // BroadcastChannel para sincronizar login/logout entre pestañas
    if (typeof window !== "undefined") {
      const ch = new BroadcastChannel("auth-state");
      channelRef.current = ch;
      ch.onmessage = (ev) => {
        if (!ev || !ev.data) return;
        if (ev.data.type === "logout") {
          setStatus("login");
        } else if (ev.data.type === "login") {
          // Forzamos un check completo inmediato al recibir login de otra pestaña
          check(true);
        }
      };
    }
    return () => {
      cancelled = true;
      clearInterval(interval);
      channelRef.current?.close();
    };
  }, []);

  // Las redirecciones de este efecto cruzan la frontera de
  // sesión (entrar, salir, aterrizar según el rol) y se hacen
  // con recarga completa A PROPÓSITO: una navegación suave
  // arrastraría el estado del cliente (socket y consultas) de
  // un lado a otro de la frontera. La regla de Next que pide
  // useRouter se desactiva solo para este efecto.
  /* eslint-disable @next/next/no-location-assign-relative-destination */
  useEffect(() => {
    if (typeof window === "undefined") return;
    // /desbloquear es pública a propósito: es la página de respaldo del
    // desbloqueo por contraseña y pide las credenciales en su propio
    // formulario (POST /api/usb-auth); no requiere sesión del panel.
    const isPublicPage =
      window.location.pathname === "/login" ||
      window.location.pathname === "/desbloquear";
    if (status === "login" && !isPublicPage) {
      window.location.href = "/login";
    }
    if (status === "ok" && window.location.pathname === "/login") {
      // Verificar rol antes de redirigir
      fetch("/api/auth/session", { credentials: "include" })
        .then((res) => res.json())
        .then((data) => {
          if (data.ok && data.user) {
            const role = data.user.role?.toLowerCase?.();
            if (role === "user") {
              window.location.href = "/user";
            } else {
              window.location.href = "/admin";
            }
          } else {
            window.location.href = "/admin";
          }
        })
        .catch(() => {
          window.location.href = "/admin";
        });
    }
  }, [status]);
  /* eslint-enable @next/next/no-location-assign-relative-destination */

  // Hidratación: el servidor y el PRIMER render del cliente deben
  // coincidir al carácter. Antes esto se intentaba con una rama
  // `typeof window === "undefined"`, que es justamente lo contrario:
  // el servidor devolvía este marcador y el cliente, ya con window,
  // devolvía el spinner — React lo detectaba y regeneraba el árbol
  // (el error "Hydration failed"). Con `mounted` (falso en el
  // servidor y en el primer render cliente, verdadero tras el efecto
  // de montaje) ambos lados dibujan lo mismo; el spinner y el resto
  // de estados llegan como una actualización normal, sin comparación.
  // No mostramos children hasta montar para no renderizar datos
  // potencialmente sensibles sin saber si hay sesión.
  if (!mounted) {
    return <div data-auth-gate="ssr-placeholder" />;
  }

  // En cliente mientras 'checking' mostramos un pequeño placeholder (evita mismatch).
  if (status === "checking") {
    return <FullscreenSpinner label="Verificando sesión" />;
  }

  if (
    status === "login" &&
    (window.location.pathname === "/login" ||
      window.location.pathname === "/desbloquear")
  ) {
    // Login y la página pública de desbloqueo: render normal sin sesión.
    return <>{children}</>;
  }
  if (status === "login") {
    // Se lanzará redirección por efecto, mostramos placeholder breve.
    return <FullscreenSpinner label="Redirigiendo" />;
  }

  // Estado ok -> mostrar la app (incluyendo /user para usuarios normales).
  return <>{children}</>;
}
