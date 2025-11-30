/**
 * Componente Error404
 * Maneja rutas no encontradas (404)
 * Se muestra cuando el usuario navega a una ruta inexistente
 */

"use client";

import { useRouter } from "next/navigation";
import { motion } from "framer-motion";
import { AlertCircle, Home, ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export default function NotFound() {
  const router = useRouter();

  return (
    <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-slate-50 via-slate-100 to-slate-200 p-4 dark:from-slate-950 dark:via-slate-900 dark:to-slate-800">
      <motion.div
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ duration: 0.3 }}
      >
        <Card className="w-full max-w-md border-slate-200 shadow-xl dark:border-slate-800">
          <CardHeader className="text-center">
            <div className="mx-auto mb-4 flex h-20 w-20 items-center justify-center rounded-full bg-rose-100 dark:bg-rose-500/20">
              <AlertCircle className="h-10 w-10 text-rose-600 dark:text-rose-400" />
            </div>
            <CardTitle className="text-3xl font-bold text-slate-900 dark:text-slate-100">
              404
            </CardTitle>
            <p className="text-lg text-slate-600 dark:text-slate-300">
              Página no encontrada
            </p>
          </CardHeader>
          <CardContent className="space-y-4 text-center">
            <p className="text-sm text-slate-500 dark:text-slate-400">
              La página que buscas no existe o no tienes permisos para acceder a
              ella.
            </p>
            <div className="flex flex-col gap-2 sm:flex-row sm:justify-center">
              <Button
                onClick={() => router.back()}
                variant="outline"
                className="flex items-center gap-2"
              >
                <ArrowLeft className="h-4 w-4" />
                Volver atrás
              </Button>
              <Button
                onClick={() => router.push("/admin")}
                className="flex items-center gap-2"
              >
                <Home className="h-4 w-4" />
                Ir al inicio
              </Button>
            </div>
          </CardContent>
        </Card>
      </motion.div>
    </div>
  );
}
