"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Eye,
  EyeOff,
  Key,
  RefreshCw,
  Shield,
  Copy,
  Check,
} from "lucide-react";
import { Spinner } from "@/components/ui/spinner";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import { fetchBasicUserSnapshot } from "../../utils";

interface ApiKeyDisplayProps {
  userId: string;
}

export const ApiKeyDisplay = ({ userId }: ApiKeyDisplayProps) => {
  const { toast } = useToast();
  const [apiKey, setApiKey] = useState("");
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [visible, setVisible] = useState(false);
  const [copied, setCopied] = useState(false);

  const maskedValue = useMemo(() => {
    if (!apiKey) return "Sin clave disponible";
    if (visible) return apiKey;
    return apiKey
      .split("")
      .map((char, index) =>
        char === "-" ? "-" : index < apiKey.length - 4 ? "•" : char
      )
      .join("");
  }, [apiKey, visible]);

  const loadApiKey = useCallback(
    async (signal?: AbortSignal, manual = false) => {
      if (!userId) return;
      try {
        if (manual) {
          setRefreshing(true);
        } else {
          setLoading(true);
        }
        setError(null);
        const snapshot = await fetchBasicUserSnapshot(userId, signal);
        setApiKey(snapshot.apiKey || "");
        if (manual) {
          toast({
            title: "Clave sincronizada",
            description: "La API key se actualizó correctamente.",
          });
        }
      } catch (fetchError) {
        const message =
          fetchError instanceof Error
            ? fetchError.message
            : "No se pudo obtener la API key.";
        setError(message);
        if (manual) {
          toast({
            title: "Error al actualizar",
            description: message,
            variant: "destructive",
          });
        }
      } finally {
        if (manual) {
          setRefreshing(false);
        } else {
          setLoading(false);
        }
      }
    },
    [toast, userId]
  );

  useEffect(() => {
    if (!userId) return;
    const controller = new AbortController();
    loadApiKey(controller.signal);
    return () => {
      controller.abort();
    };
  }, [loadApiKey, userId]);

  const handleCopy = useCallback(async () => {
    if (!apiKey) {
      toast({
        title: "No hay clave para copiar",
        description: "Aún no se ha generado una API key para este usuario.",
        variant: "destructive",
      });
      return;
    }
    try {
      await navigator.clipboard.writeText(apiKey);
      setCopied(true);
      toast({
        title: "API key copiada",
        description: "La clave se copió al portapapeles de manera segura.",
      });
      setTimeout(() => setCopied(false), 2000);
    } catch (copyError) {
      const message =
        copyError instanceof Error
          ? copyError.message
          : "No se pudo copiar la API key.";
      toast({
        title: "No se pudo copiar la API key",
        description: message,
        variant: "destructive",
      });
    }
  }, [apiKey, toast]);

  return (
    <Card className="border-slate-200/80 bg-gradient-to-br from-white via-white to-slate-50 shadow-sm dark:border-slate-800/80 dark:from-slate-950 dark:via-slate-900 dark:to-slate-950">
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle className="flex items-center gap-2 text-lg text-slate-800 dark:text-slate-100">
          <Key className="h-5 w-5 text-slate-500 dark:text-slate-300" />
          API key personal
        </CardTitle>
        <Button
          type="button"
          size="sm"
          variant="outline"
          className="inline-flex items-center gap-2 border-slate-200 text-xs font-semibold text-slate-600 transition-colors hover:bg-slate-100 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
          disabled={refreshing}
          onClick={() => loadApiKey(undefined, true)}
        >
          {refreshing ? (
            <div className="mr-2">
              <Spinner size={16} />
            </div>
          ) : (
            <RefreshCw className="mr-2 h-4 w-4 text-slate-500 dark:text-slate-300" />
          )}
          {refreshing ? "Actualizando..." : "Actualizar"}
        </Button>
      </CardHeader>
      <CardContent className="space-y-4">
        <Alert className="border-blue-200 bg-blue-50 text-sm text-blue-900 dark:border-blue-800 dark:bg-blue-950/30 dark:text-blue-200">
          <AlertDescription className="flex items-center gap-2">
            <Shield className="h-4 w-4" />
            Mantenga su clave segura. Si sospecha de un compromiso, solicite una
            nueva al administrador.
          </AlertDescription>
        </Alert>

        {loading && (
          <div className="flex h-32 items-center justify-center">
            <Spinner size={32} />
          </div>
        )}

        {!loading && error && (
          <Alert className="border-red-200 bg-red-50 text-red-900 dark:border-red-700 dark:bg-red-950/20 dark:text-red-100">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}

        {!loading && !error && (
          <div className="space-y-3">
            <div className="relative">
              <Input
                type="text"
                value={maskedValue}
                readOnly
                className="font-mono text-sm tracking-wide transition-all duration-300 focus-visible:ring-slate-400 dark:bg-slate-900"
              />
              <button
                type="button"
                aria-label={visible ? "Ocultar API key" : "Mostrar API key"}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 transition-colors hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200"
                onClick={() => setVisible((prev) => !prev)}
              >
                {visible ? (
                  <EyeOff className="h-4 w-4" />
                ) : (
                  <Eye className="h-4 w-4" />
                )}
              </button>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                onClick={handleCopy}
                className="inline-flex items-center gap-2 bg-slate-800 text-white transition-colors hover:bg-slate-900 dark:bg-slate-700 dark:hover:bg-slate-600"
              >
                {copied ? (
                  <Check className="h-4 w-4" />
                ) : (
                  <Copy className="h-4 w-4" />
                )}
                {copied ? "Copiada" : "Copiar clave"}
              </Button>
              <Button
                type="button"
                variant="outline"
                className="inline-flex items-center gap-2 border-slate-200 text-xs font-semibold text-slate-600 transition-colors hover:bg-slate-100 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
                onClick={() => setVisible((prev) => !prev)}
              >
                {visible ? "Ocultar" : "Mostrar"} clave completa
              </Button>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
};
