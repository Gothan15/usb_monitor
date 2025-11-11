"use client";

import { useCallback, useState } from "react";
import type { ComponentProps } from "react";
import { LogOut, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { cn, getCsrfTokenFromDocument } from "@/lib/utils";

type ButtonProps = ComponentProps<typeof Button>;

interface LogoutButtonProps extends Omit<ButtonProps, "onClick" | "children"> {
  label?: string;
  pendingLabel?: string;
}

export const LogoutButton = ({
  label = "Cerrar sesión",
  pendingLabel = "Saliendo...",
  variant = "outline",
  size = "sm",
  className,
  ...buttonProps
}: LogoutButtonProps) => {
  const { toast } = useToast();
  const [loading, setLoading] = useState(false);

  const handleLogout = useCallback(async () => {
    if (loading) return;
    setLoading(true);
    try {
      const csrfToken = getCsrfTokenFromDocument();
      if (!csrfToken) {
        throw new Error(
          "No se detectó el token CSRF. Vuelve a iniciar sesión antes de cerrar la sesión."
        );
      }
      const res = await fetch("/api/auth/logout", {
        method: "POST",
        credentials: "include",
        headers: {
          "x-csrf-token": csrfToken,
        },
      });
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        throw new Error(
          data?.error || `Error HTTP ${res.status} al cerrar sesión.`
        );
      }
      try {
        const channel = new BroadcastChannel("auth-state");
        channel.postMessage({ type: "logout" });
        channel.close();
      } catch {}
      window.location.href = "/login";
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "No se pudo cerrar la sesión.";
      toast({
        title: "Error al cerrar sesión",
        description: message,
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  }, [loading, toast]);

  return (
    <Button
      type="button"
      variant={variant}
      size={size}
      onClick={handleLogout}
      disabled={loading}
      className={cn(
        "inline-flex items-center gap-2 border-slate-200 text-sm font-semibold text-slate-600 transition-colors hover:bg-slate-100 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800",
        className
      )}
      {...buttonProps}
    >
      {loading ? (
        <Loader2 className="h-4 w-4 animate-spin text-slate-400" />
      ) : (
        <LogOut className="h-4 w-4 text-slate-500 dark:text-slate-300" />
      )}
      {loading ? pendingLabel : label}
    </Button>
  );
};
