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
import { Skeleton } from "@/components/ui/skeleton";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { AlertTriangle } from "lucide-react";
import { Computer, formatDateTime } from "./types";
import { Badge } from "@/components/ui/badge";

interface Props {
  computers: Computer[];
  loading: boolean;
}

function StatusBadge({ active }: { active: boolean }) {
  return (
    <Badge variant={active ? "default" : "secondary"}>
      {active ? "Activo" : "Inactivo"}
    </Badge>
  );
}

export function ComputersTab({ computers, loading }: Props) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Computadoras Monitoreadas</CardTitle>
        <CardDescription>
          Lista de computadoras con el servicio de monitoreo USB instalado
        </CardDescription>
      </CardHeader>
      <CardContent>
        {loading ? (
          <div className="space-y-2">
            {[...Array(5)].map((_, i) => (
              <Skeleton key={i} className="h-12" />
            ))}
          </div>
        ) : computers.length === 0 ? (
          <Alert>
            <AlertTriangle className="h-4 w-4" />
            <AlertDescription>
              No hay computadoras monitoreadas aún.
            </AlertDescription>
          </Alert>
        ) : (
          <ScrollArea className="h-[400px]">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Nombre</TableHead>
                  <TableHead>Dirección IP</TableHead>
                  <TableHead>Estado</TableHead>
                  <TableHead>Última Conexión</TableHead>
                  <TableHead>Fecha Registro</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {computers.map((c) => (
                  <TableRow key={c.id}>
                    <TableCell className="font-medium">{c.name}</TableCell>
                    <TableCell>{c.ipAddress}</TableCell>
                    <TableCell>
                      <StatusBadge active={c.isActive} />
                    </TableCell>
                    <TableCell>
                      {c.lastSeen ? formatDateTime(c.lastSeen) : "Nunca"}
                    </TableCell>
                    <TableCell>{formatDateTime(c.createdAt)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </ScrollArea>
        )}
      </CardContent>
    </Card>
  );
}
