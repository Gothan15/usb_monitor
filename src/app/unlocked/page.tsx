"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { LogOut, Shield, Check } from "lucide-react";

export default function UnlockedPage() {
  const router = useRouter();
  const [username, setUsername] = useState("");

  useEffect(() => {
    // Verificar sesión al cargar
    fetch("/api/auth/session", { credentials: "include" })
      .then((res) => res.json())
      .then((data) => {
        if (data.ok && data.user) {
          setUsername(data.user.username);
          // Si es admin, redirigir al panel principal
          if (data.user.role === "admin") {
            router.push("/");
          }
        }
      })
      .catch(() => {});
  }, [router]);

  const handleLogout = async () => {
    try {
      await fetch("/api/auth/logout", { method: "POST" });
      try {
        const ch = new BroadcastChannel("auth-state");
        ch.postMessage({ type: "logout" });
        ch.close();
      } catch {}
      window.location.href = "/login";
    } catch {}
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-green-50 to-blue-50 dark:from-green-950 dark:to-blue-950 p-4">
      <div className="max-w-md w-full bg-white dark:bg-gray-900 rounded-lg shadow-xl p-8 text-center">
        <div className="mb-6 flex justify-center">
          <div className="w-20 h-20 bg-green-100 dark:bg-green-900 rounded-full flex items-center justify-center">
            <Check className="w-12 h-12 text-green-600 dark:text-green-400" />
          </div>
        </div>

        <h1 className="text-3xl font-bold mb-2 text-gray-900 dark:text-gray-100">
          Memoria Desbloqueada
        </h1>

        <p className="text-gray-600 dark:text-gray-400 mb-6">
          El dispositivo USB ha sido desbloqueado correctamente
        </p>

        <div className="bg-green-50 dark:bg-green-900/30 border border-green-200 dark:border-green-800 rounded-lg p-4 mb-6">
          <div className="flex items-center justify-center gap-2 text-green-700 dark:text-green-400">
            <Shield className="w-5 h-5" />
            <span className="font-medium">
              Usuario: {username || "Cargando..."}
            </span>
          </div>
        </div>

        <div className="space-y-3">
          <p className="text-sm text-gray-500 dark:text-gray-400">
            Tu sesión está activa. Puedes cerrar esta ventana o cerrar sesión.
          </p>

          <Button onClick={handleLogout} variant="outline" className="w-full">
            <LogOut className="w-4 h-4 mr-2" />
            Cerrar Sesión
          </Button>
        </div>
      </div>
    </div>
  );
}
