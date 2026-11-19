"use client";

// El diálogo «Credencial del equipo» de la pestaña Equipos,
// como componente propio: antes vivía dentro del componente
// de la pestaña y su estado también, así que cada tecla en el
// nombre del equipo volvía a pintar la tabla entera que hay
// detrás (y su consulta de estado, con su respiro, corría
// sobre la pestaña). Aquí el diálogo guarda su estado en
// casa: teclear solo repinta el diálogo. El diseño no
// cambia — mismo JSX, mismas clases, mismos textos.

import { useCallback, useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Copy } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import * as equiposApi from "@/lib/api/equipos";
import * as usuariosApi from "@/lib/api/usuarios";
import type { Computer } from "./types";

/**
 * Copia texto al portapapeles devolviendo si lo logró. La API
 * moderna solo existe en contextos seguros (HTTPS o localhost):
 * entrando al panel por la IP de la LAN en HTTP no está disponible
 * y el botón quedaba muerto; en ese caso se usa el método clásico
 * con un textarea temporal, que funciona en cualquier contexto.
 */
async function copiarAlPortapapeles(texto: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(texto);
      return true;
    }
  } catch {
    // Se intenta el método clásico.
  }
  try {
    const area = document.createElement("textarea");
    area.value = texto;
    area.style.position = "fixed";
    area.style.opacity = "0";
    document.body.appendChild(area);
    area.focus();
    area.select();
    const ok = document.execCommand("copy");
    area.remove();
    return ok;
  } catch {
    return false;
  }
}

interface CredentialDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Los equipos de la flota, para el datalist de nombres. */
  computers: Computer[];
}

export function CredentialDialog({
  open,
  onOpenChange,
  computers,
}: CredentialDialogProps) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [tokenPc, setTokenPc] = useState("");
  const [tokenValor, setTokenValor] = useState<string | null>(null);
  const [tokenUsuarioId, setTokenUsuarioId] = useState("");
  const [usuariosToken, setUsuariosToken] = useState<
    { id: string; username: string }[]
  >([]);

  // La lista de usuarios para el selector de dueño se pide al
  // abrir el diálogo: no hace falta tenerla cargada en la pestaña.
  // Al abrir también se retira el código de la vez anterior (el
  // botón que abría el diálogo lo limpiaba antes, en la pestaña).
  useEffect(() => {
    if (!open) return;
    setTokenValor(null);
    let cancelado = false;
    void usuariosApi.listarParaSelector().then((lista) => {
      if (cancelado) return;
      setUsuariosToken(lista);
    })
      .catch(() => undefined);
    return () => {
      cancelado = true;
    };
  }, [open ]);
  const [tokenOcupado, setTokenOcupado] = useState(false);
  const [credencialEstado, setCredencialEstado] =
    useState<equiposApi.EstadoCredencial | null>(null);
  // «Ahora» como estado para decidir si el código sigue vivo:
  // Date.now() durante el render es impuro y el lint lo marca;
  // la referencia se toma al consultar el estado y se refresca
  // cada 30 s mientras el diálogo muestra un código vivo.
  const [ahora, setAhora] = useState(() => Date.now());

  // Al vaciarse el nombre, el estado de la credencial se limpia
  // en el propio render (el patrón que recomienda React para
  // reajustar un estado cuando cambia otro) en vez de en un
  // efecto: el efecto solo consulta, nunca limpia.
  const [nombreAnterior, setNombreAnterior] = useState(tokenPc);
  if (tokenPc !== nombreAnterior) {
    setNombreAnterior(tokenPc);
    if (!tokenPc.trim()) setCredencialEstado(null);
  }

  // El estado de la credencial del nombre escrito: se consulta al
  // abrir el diálogo y al cambiar el nombre (con un respiro).
  useEffect(() => {
    if (!open) return;
    const nombre = tokenPc.trim();
    if (!nombre) return;
    const temporizador = setTimeout(() => {
      void (async () => {
        setCredencialEstado(await equiposApi.estadoCredencial(nombre));
        setAhora(Date.now());
      })();
    }, 400);
    return () => clearTimeout(temporizador);
  }, [open, tokenPc]);

  // Refresco de la referencia de tiempo con un código vivo a
  // la vista: al caducar, el aviso de «código vivo» se retira
  // solo en vez de esperar a otro render.
  useEffect(() => {
    if (!open || !credencialEstado?.codigoExpira) return;
    const temporizador = setInterval(() => setAhora(Date.now()), 30000);
    return () => clearInterval(temporizador);
  }, [open, credencialEstado]);

  const llamarProvision = useCallback(
    async (metodo: "POST" | "DELETE") => {
      const nombre = tokenPc.trim();
      if (!nombre) {
        toast({
          title: "Escribe el nombre del equipo",
          variant: "destructive",
        });
        return;
      }
      setTokenOcupado(true);
      try {
        // Al generar, la respuesta trae el código y el equipo;
        // al revocar solo confirma.
        const generado =
          metodo === "POST"
            ? await equiposApi.generarCodigoEnrolamiento(nombre)
            : null;
        if (generado) {
          setTokenValor(generado.codigo);
          toast({ title: `Código generado para ${generado.pcName}` });
        } else {
          await equiposApi.revocarCodigoEnrolamiento(nombre);
          setTokenValor(null);
          toast({ title: `Credencial revocada para ${nombre}` });
        }
        // Generar el código crea el equipo en el servidor si no
        // existía (y revocar cambia su estado): sin invalidar la
        // consulta, la lista no enseñaba el cambio hasta recargar.
        await queryClient.invalidateQueries({ queryKey: ["computers"] });
        // Dueño elegido en el propio diálogo: con el token ya
        // generado, el usuario queda asignado a este equipo sin
        // tener que ir a la pestaña de Usuarios a enlazarlo.
        if (generado && tokenUsuarioId && generado.computerId) {
          const elegido = usuariosToken.find((u) => u.id === tokenUsuarioId);
          try {
            await usuariosApi.asignarEquipo(
              tokenUsuarioId,
              generado.computerId,
            );
            toast({
              title: `Dueño asignado: ${elegido?.username ?? "usuario"}`,
              description: `${generado.pcName} queda a su nombre para los desbloqueos.`,
            });
            await queryClient.invalidateQueries({ queryKey: ["users"] });
          } catch {
            toast({
              title: "El código se generó, pero el dueño no se asignó",
              description: "Puedes asignarlo desde la pestaña Usuarios.",
              variant: "destructive",
            });
          }
        }
      } catch (error: any) {
        toast({
          title: "No se pudo completar",
          description: error?.message,
          variant: "destructive",
        });
      } finally {
        setTokenOcupado(false);
      }
    },
    [tokenPc, toast, queryClient, tokenUsuarioId, usuariosToken],
  );

  const manejarApertura = (nuevoAbierto: boolean) => {
    onOpenChange(nuevoAbierto);
    if (!nuevoAbierto) setTokenValor(null);
  };

  return (
    <Dialog open={open} onOpenChange={manejarApertura}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Credencial del equipo</DialogTitle>
          <DialogDescription>
            El código de enrolamiento es de UN SOLO USO y vale solo
            para el equipo cuyo nombre escribas abajo: ese nombre
            tiene que ser EXACTAMENTE el nombre de la PC (el que
            enseña su agente), porque el agente se presenta con él
            y el panel lo empareja con esta fila. Genera el código,
            ve a ESA PC, abre el asistente de su agente y pégalo en
            el campo «Código de enrolamiento». El código se muestra
            una vez, caduca a los 30 minutos y generar otro
            invalida el anterior. La clave privada del equipo no
            se copia nunca a ningún sitio: nace dentro de la PC
            cuando el agente arranca, y lo único que viaja es este
            código.
          </DialogDescription>
        </DialogHeader>
        {/* Formulario con display:contents (sin tocar el layout):
            Enter en el nombre genera el código, como Escape
            cierra. El botón «Generar código» es el submit; los
            demás (Copiar, Revocar, Cerrar) ya son type="button". */}
        <form
          className="contents"
          onSubmit={(event) => {
            event.preventDefault();
            void llamarProvision("POST");
          }}
        >
        <div className="flex flex-col gap-2">
          <label className="smallcaps text-muted-foreground">
            Nombre del equipo
          </label>
          <Input
            value={tokenPc}
            onChange={(event) => setTokenPc(event.target.value)}
            placeholder="PC-RECEPCION"
            list="nombres-equipos-token"
            className="rounded-none font-mono"
          />
          <datalist id="nombres-equipos-token">
            {computers.map((c) => (
              <option key={c.id} value={c.name} />
            ))}
          </datalist>
          {/^\d{1,3}(\.\d{1,3}){3}$/.test(tokenPc.trim()) && (
            <p className="text-[0.6875rem] font-medium leading-relaxed text-destructive">
              Eso que has escrito es una dirección IP, no el nombre
              de la PC. El código quedaría atado a una fila que el
              agente nunca usará —se presenta con su nombre— y el
              enrolamiento será rechazado. Escribe el nombre del
              equipo tal como se ve en su agente.
            </p>
          )}
          {credencialEstado && (
            <div className="mt-1 flex flex-col gap-1 border border-border bg-muted/30 p-3 text-xs leading-relaxed">
              {credencialEstado.tieneClave ? (
                <p>
                  <strong>Clave registrada</strong>
                  {credencialEstado.credencialAt
                    ? ` desde el ${new Date(credencialEstado.credencialAt).toLocaleString()}`
                    : ""}
                  {credencialEstado.huella
                    ? ` · huella ${String(credencialEstado.huella).slice(0, 12)}…`
                    : ""}
                </p>
              ) : (
                <p>
                  <strong>Sin credencial:</strong> este equipo no puede
                  hablar con el panel hasta enrolarse con un código.
                </p>
              )}
              {credencialEstado.codigoExpira &&
                new Date(credencialEstado.codigoExpira).getTime() > ahora && (
                  <p className="text-muted-foreground">
                    Hay un código de enrolamiento vivo hasta el{" "}
                    {new Date(credencialEstado.codigoExpira).toLocaleString()}.
                  </p>
                )}
              {credencialEstado.intentosFallidos > 0 && (
                <p className="text-muted-foreground">
                  Intentos de firma fallidos acumulados:{" "}
                  {credencialEstado.intentosFallidos}.
                </p>
              )}
              {credencialEstado.alertaCredencial && (
                <p className="font-medium text-destructive">
                  {credencialEstado.alertaCredencial}
                </p>
              )}
            </div>
          )}
          <label className="smallcaps mt-2 text-muted-foreground">
            Usuario dueño (opcional)
          </label>
          <Select
            value={tokenUsuarioId || "ninguno"}
            onValueChange={(v) =>
              setTokenUsuarioId(v === "ninguno" ? "" : v)
            }
          >
            <SelectTrigger className="rounded-none">
              <SelectValue placeholder="Sin asignar" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="ninguno">Sin asignar</SelectItem>
              {usuariosToken.map((u) => (
                <SelectItem key={u.id} value={u.id}>
                  {u.username}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <p className="text-[0.6875rem] leading-relaxed text-muted-foreground">
            Si eliges uno, al generar el código ese usuario queda como
            dueño de este equipo: podrá desbloquear sus dispositivos
            con su contraseña, sin pasar por la pestaña Usuarios.
          </p>
          {tokenValor && (
            <div className="mt-2 flex flex-col gap-2">
              <div className="flex items-center gap-2 border border-border bg-muted/30 p-3">
                <code className="flex-1 select-all break-all font-mono text-xs">
                  {tokenValor}
                </code>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  className="rounded-none"
                  onClick={() => {
                    void copiarAlPortapapeles(tokenValor).then((ok) => {
                      toast(
                        ok
                          ? { title: "Código copiado" }
                          : {
                              title: "No se pudo copiar",
                              description:
                                "Toca el código para seleccionarlo entero y cópialo a mano.",
                              variant: "destructive",
                            },
                      );
                    });
                  }}
                >
                  <Copy className="mr-1 size-3.5" />
                  Copiar
                </Button>
              </div>
              <p className="text-[0.6875rem] leading-relaxed text-muted-foreground">
                Llévalo a la PC de arriba y pégalo en el asistente
                de su agente, campo «Código de enrolamiento», antes
                de 30 minutos. Se gasta al primer uso que salga
                bien; si el agente de esa PC ya corre como servicio
                (instalación remota), no pegues nada: gastará solo
                el código que viajó con la instalación.
              </p>
            </div>
          )}
        </div>
        <DialogFooter>
          <Button
            type="button"
            variant="ghost"
            className="rounded-none"
            onClick={() => manejarApertura(false)}
          >
            Cerrar
          </Button>
          <Button
            type="button"
            variant="outline"
            className="rounded-none"
            disabled={tokenOcupado}
            onClick={() => void llamarProvision("DELETE")}
          >
            Revocar credencial
          </Button>
          <Button
            type="submit"
            className="rounded-none"
            disabled={tokenOcupado}
          >
            {tokenOcupado ? "Trabajando..." : "Generar código"}
          </Button>
        </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
