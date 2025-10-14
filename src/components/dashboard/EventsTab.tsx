"use client";

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { AlertTriangle, Usb } from "lucide-react";
import { cn } from "@/lib/utils";
import { USBEvent, formatDateTime } from "./types";

interface Props {
  events: USBEvent[];
  loading: boolean;
}

export function EventsTab({ events, loading }: Props) {
  const classifyEvent = (message: string) => {
    const normalized = message.toLowerCase();
    const isUnlock =
      normalized.includes("readonly removido") ||
      normalized.includes("desbloqueada") ||
      normalized.includes("desbloqueado");
    const isError =
      normalized.includes("error") ||
      normalized.includes("fallo") ||
      normalized.includes("denegado");

    if (isUnlock) {
      return {
        badgeVariant: "success" as const,
        rowClassName:
          "bg-emerald-50/60 dark:bg-emerald-500/10 transition-colors",
      };
    }

    if (isError) {
      return {
        badgeVariant: "destructive" as const,
        rowClassName: "bg-red-50/70 dark:bg-red-500/10 transition-colors",
      };
    }

    return {
      badgeVariant: "default" as const,
      rowClassName: "",
    };
  };

  return (
    <Card className="border border-slate-200/80 bg-white/90 text-slate-900 shadow-lg supports-[backdrop-filter]:backdrop-blur-xl dark:border-white/10 dark:bg-slate-900/50 dark:text-white">
      <CardHeader className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex items-center gap-3">
          <span className="inline-flex size-9 items-center justify-center rounded-full border border-purple-200/60 bg-purple-50/90 text-purple-600 shadow-sm dark:border-purple-400/40 dark:bg-purple-500/10 dark:text-purple-200">
            <Usb className="size-4" />
          </span>
          <div>
            <CardTitle className="text-lg font-semibold text-slate-900 dark:text-slate-100">
              Eventos USB recientes
            </CardTitle>
            <CardDescription className="text-slate-600 dark:text-slate-300/80">
              Lista auditada con resaltado contextual según el tipo de evento
            </CardDescription>
          </div>
        </div>
        <div className="flex items-center gap-2 text-xs font-medium text-slate-600 dark:text-slate-300/80">
          <span className="inline-flex items-center gap-1 rounded-full border border-slate-200/80 bg-slate-100/70 px-3 py-1 shadow-sm backdrop-blur-sm dark:border-white/10 dark:bg-white/5">
            <span className="size-2 rounded-full bg-emerald-500 dark:bg-emerald-400" />
            Tiempo real sincronizado
          </span>
        </div>
      </CardHeader>
      <CardContent>
        {loading ? (
          <div className="space-y-3">
            {[...Array(5)].map((_, i) => (
              <Skeleton
                key={i}
                className="h-12 rounded-xl bg-slate-100 dark:bg-white/10"
              />
            ))}
          </div>
        ) : events.length === 0 ? (
          <Alert className="border-amber-200/60 bg-amber-50 text-amber-700 dark:border-amber-300/40 dark:bg-amber-500/10 dark:text-amber-100">
            <AlertTriangle className="h-4 w-4" />
            <AlertDescription>
              No se han registrado eventos USB aún.
            </AlertDescription>
          </Alert>
        ) : (
          <ScrollArea className="h-[420px] pr-2">
            <Table className="min-w-full">
              <TableHeader className="sticky top-0 z-10 bg-white/95 backdrop-blur-lg dark:bg-slate-900/80">
                <TableRow className="border-slate-200/80 dark:border-white/10">
                  <TableHead className="text-slate-600 dark:text-slate-200">
                    Computadora
                  </TableHead>
                  <TableHead className="text-slate-600 dark:text-slate-200">
                    Usuario
                  </TableHead>
                  <TableHead className="text-slate-600 dark:text-slate-200">
                    IP
                  </TableHead>
                  <TableHead className="text-slate-600 dark:text-slate-200">
                    Evento
                  </TableHead>
                  <TableHead className="text-slate-600 dark:text-slate-200">
                    Fecha / Hora
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {events.map((event) => {
                  const { badgeVariant, rowClassName } = classifyEvent(
                    event.event
                  );
                  const badgeClass =
                    badgeVariant === "default"
                      ? "border border-slate-200 bg-slate-100 text-slate-700 shadow-sm dark:border-white/10 dark:bg-white/10 dark:text-white"
                      : "border border-transparent shadow-sm";
                  return (
                    <TableRow
                      key={event.id}
                      className={cn(
                        "group border border-slate-100/70 transition-all duration-200 hover:translate-x-[1px] hover:border-slate-400/60 dark:border-white/5 dark:hover:border-white/20",
                        rowClassName
                      )}
                    >
                      <TableCell className="font-medium text-slate-700 dark:text-slate-100">
                        {event.pcName}
                      </TableCell>
                      <TableCell className="text-slate-600 dark:text-slate-300/80">
                        {event.pcUser}
                      </TableCell>
                      <TableCell className="text-slate-600 dark:text-slate-300/80">
                        {event.pcIp}
                      </TableCell>
                      <TableCell>
                        <Badge variant={badgeVariant} className={badgeClass}>
                          {event.event}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-slate-600 dark:text-slate-200">
                        {formatDateTime(event.createdAt)}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </ScrollArea>
        )}
      </CardContent>
    </Card>
  );
}
