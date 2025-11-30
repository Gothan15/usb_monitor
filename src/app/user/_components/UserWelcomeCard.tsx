"use client";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Activity, Key, ShieldCheck, User as UserIcon } from "lucide-react";

interface UserWelcomeCardProps {
  username: string;
}

export function UserWelcomeCard({ username }: UserWelcomeCardProps) {
  return (
    <section>
      <Card className="border-slate-200/80 bg-gradient-to-br from-white via-white to-slate-50 shadow-sm dark:border-slate-800/80 dark:from-slate-950 dark:via-slate-900 dark:to-slate-950">
        <CardHeader className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <CardTitle className="flex items-center gap-3 text-lg text-slate-800 dark:text-slate-100">
            <div className="flex h-11 w-11 items-center justify-center rounded-full bg-slate-900 text-white shadow-md dark:bg-slate-700">
              <UserIcon className="h-5 w-5" />
            </div>
            <div>
              <p className="text-sm text-slate-500 dark:text-slate-300">
                Bienvenido
              </p>
              <p className="text-xl font-semibold text-slate-900 dark:text-slate-100">
                {username}
              </p>
            </div>
          </CardTitle>
          <div className="flex flex-wrap items-center gap-2">
            <Badge
              variant="outline"
              className="border-green-500/50 text-green-700 dark:border-green-500/70 dark:text-green-300"
            >
              Usuario básico
            </Badge>
          </div>
        </CardHeader>
        <CardContent className="grid gap-4 text-sm text-slate-600 dark:text-slate-300 md:grid-cols-3">
          <div className="flex items-center gap-2 rounded-lg border border-slate-100 bg-slate-50 p-3 dark:border-slate-800 dark:bg-slate-900/60">
            <ShieldCheck className="h-4 w-4 text-slate-500 dark:text-slate-300" />
            <span>Acceso restringido a su equipo asignado.</span>
          </div>
          <div className="flex items-center gap-2 rounded-lg border border-slate-100 bg-slate-50 p-3 dark:border-slate-800 dark:bg-slate-900/60">
            <Activity className="h-4 w-4 text-slate-500 dark:text-slate-300" />
            <span>Las conexiones USB se actualizan automáticamente.</span>
          </div>
          <div className="flex items-center gap-2 rounded-lg border border-slate-100 bg-slate-50 p-3 dark:border-slate-800 dark:bg-slate-900/60">
            <Key className="h-4 w-4 text-slate-500 dark:text-slate-300" />
            <span>Proteja su API key y úsela solo en clientes oficiales.</span>
          </div>
        </CardContent>
      </Card>
    </section>
  );
}
