import { NextRequest, NextResponse } from "next/server";
import { hit } from "@/lib/rateLimit";
import { requireAuth } from "@/lib/auth";
import { logError } from "@/lib/logger";
import {
  copyFilesViaSSH,
  installServiceViaSSH,
  type ProgressCallback,
  type SSHCredentials,
  type SSHOperationResult,
} from "@/lib/sshService";
import {
  copyFilesViaWinRM,
  installServiceViaWinRM,
  DEFAULT_WINRM_PORT,
  type WinRMCredentials,
} from "@/lib/winrmService";
import { db } from "@/lib/db";

// Instalación remota en dos fases (copy + install) con progreso en vivo:
// - Sin `stream`, cada llamada responde un JSON al terminar la fase.
// - Con `stream: true`, la respuesta es SSE (text/event-stream): eventos
//   `progress` ({ phase, stage, detail }) durante la fase y un evento
//   `result` final con el mismo cuerpo que devolvería el JSON.

interface InstallRequest {
  ip: string;
  username: string;
  password: string;
  phase: "copy" | "install";
  protocol: "ssh" | "winrm";
  port: number;
  stream: boolean;
}

async function markInstalledInDb(ip: string): Promise<void> {
  try {
    await (db as any).computer.updateMany({
      where: { ipAddress: ip },
      data: {
        serviceInstalled: true,
        serviceRunning: true,
        lastServiceCheck: new Date(),
      },
    });
  } catch (dbErr) {
    logError("Error al actualizar Computer en DB tras instalación", dbErr);
  }
}

async function runPhase(
  input: InstallRequest,
  onProgress?: ProgressCallback,
): Promise<SSHOperationResult> {
  let result: SSHOperationResult;

  if (input.protocol === "winrm") {
    const creds: WinRMCredentials = {
      host: input.ip,
      username: input.username,
      password: input.password,
      port: input.port,
    };
    result =
      input.phase === "copy"
        ? await copyFilesViaWinRM(creds, onProgress)
        : await installServiceViaWinRM(creds, onProgress);
  } else {
    const creds: SSHCredentials = {
      host: input.ip,
      username: input.username,
      password: input.password,
      port: input.port,
    };
    result =
      input.phase === "copy"
        ? await copyFilesViaSSH(creds, onProgress)
        : await installServiceViaSSH(creds, onProgress);
  }

  if (input.phase === "install" && result.success) {
    await markInstalledInDb(input.ip);
  }
  return result;
}

export async function POST(req: NextRequest) {
  try {
    const auth = await requireAuth(req, { role: "admin" });
    const ipClient =
      (req.headers.get("x-forwarded-for") || "").split(",")[0].trim() ||
      "unknown";
    const rl = await hit(
      `remote-install`,
      {
        windowMs: 10 * 60_000,
        max: 10,
      },
      { userId: auth.userId, ip: ipClient },
    );
    if (!rl.allowed) {
      return NextResponse.json({ error: "Rate limit" }, { status: 429 });
    }

    const body = await req.json();
    const ip = body.ip as string;
    const username = body.username as string;
    const password = body.password as string;
    const phase = body.phase as string;
    const protocol = ((body.protocol as string) || "ssh").toLowerCase();
    const stream = body.stream === true;

    // Validación
    if (typeof ip !== "string" || !ip.trim()) {
      return NextResponse.json({ error: "Falta ip" }, { status: 400 });
    }
    if (typeof username !== "string" || !username.trim()) {
      return NextResponse.json({ error: "Falta username" }, { status: 400 });
    }
    if (typeof password !== "string") {
      return NextResponse.json({ error: "Falta password" }, { status: 400 });
    }
    if (phase !== "copy" && phase !== "install") {
      return NextResponse.json(
        { error: "phase debe ser 'copy' o 'install'" },
        { status: 400 },
      );
    }
    if (protocol !== "ssh" && protocol !== "winrm") {
      return NextResponse.json(
        { error: "protocol debe ser 'ssh' o 'winrm'" },
        { status: 400 },
      );
    }

    const port =
      typeof body.port === "number"
        ? body.port
        : protocol === "winrm"
          ? DEFAULT_WINRM_PORT
          : 22;

    const input: InstallRequest = {
      ip: ip.trim(),
      username: username.trim(),
      password,
      phase,
      protocol,
      port,
      stream,
    };

    if (stream) {
      const encoder = new TextEncoder();
      const sseStream = new ReadableStream({
        async start(controller) {
          const send = (event: string, data: unknown) => {
            try {
              controller.enqueue(
                encoder.encode(
                  `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`,
                ),
              );
            } catch {
              // El cliente cerró la conexión; la fase sigue y se descarta.
            }
          };

          try {
            const result = await runPhase(input, (stage, detail) =>
              send("progress", { phase: input.phase, stage, detail }),
            );
            send("result", { ...result, phase: input.phase });
          } catch (error: any) {
            send("result", {
              success: false,
              message: error?.message || "Error durante la operación",
              phase: input.phase,
            });
          } finally {
            try {
              controller.close();
            } catch {}
          }
        },
      });

      return new Response(sseStream, {
        headers: {
          "Content-Type": "text/event-stream",
          "Cache-Control": "no-cache, no-store",
          Connection: "keep-alive",
        },
      });
    }

    const result = await runPhase(input);
    const res = NextResponse.json(
      { ...result, phase: input.phase },
      { status: result.success ? 200 : 502 },
    );
    res.headers.set("Cache-Control", "no-store");
    return res;
  } catch (error: any) {
    if (error?.message === "UNAUTHORIZED")
      return NextResponse.json({ error: "No autorizado" }, { status: 401 });
    if (error?.message === "FORBIDDEN")
      return NextResponse.json({ error: "Acceso denegado" }, { status: 403 });
    if (error?.code === "CSRF_INVALID" || error?.code === "CSRF_MISSING") {
      return NextResponse.json({ error: "CSRF inválido" }, { status: 403 });
    }
    logError("Error en remote install", error);
    return NextResponse.json(
      { error: error.message || "Error" },
      { status: 500 },
    );
  }
}

export const dynamic = "force-dynamic";
