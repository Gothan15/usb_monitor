"use client";
import React, { useEffect, useState } from "react";
import { FullscreenSpinner } from "@/components/ui/spinner";

// Componente cliente separado para control de sesión sin forzar layout a client component
export default function AuthGate({ children }: { children: React.ReactNode }) {
  const [status, setStatus] = useState<"checking" | "ok" | "login">("checking");
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

  // SSR: devolvemos un contenedor estable. No mostramos children todavía para evitar renderizar
  // datos potencialmente sensibles sin saber si hay sesión. El primer render cliente verá lo mismo.
  const isServer = typeof window === "undefined";
  if (isServer) {
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
