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
      <Card className="border-border/60 bg-card/80 shadow-sm backdrop-blur-xl">
        <CardHeader className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <CardTitle className="flex items-center gap-3 text-lg text-foreground">
            <div className="flex h-11 w-11 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-md">
              <UserIcon className="h-5 w-5" />
            </div>
            <div>
              <p className="text-sm text-muted-foreground">Bienvenido</p>
              <p className="text-xl font-semibold text-foreground">
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
        <CardContent className="grid gap-4 text-sm text-muted-foreground md:grid-cols-3">
          <div className="flex items-center gap-2 rounded-lg border border-border/40 bg-muted/30 p-3">
            <ShieldCheck className="h-4 w-4 text-muted-foreground" />
            <span>Acceso restringido a su equipo asignado.</span>
          </div>
          <div className="flex items-center gap-2 rounded-lg border border-border/40 bg-muted/30 p-3">
            <Activity className="h-4 w-4 text-muted-foreground" />
            <span>Las conexiones USB se actualizan automáticamente.</span>
          </div>
          <div className="flex items-center gap-2 rounded-lg border border-border/40 bg-muted/30 p-3">
            <Key className="h-4 w-4 text-muted-foreground" />
            <span>Proteja su API key y úsela solo en clientes oficiales.</span>
          </div>
        </CardContent>
      </Card>
    </section>
  );
}
