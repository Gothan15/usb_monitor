import { NextRequest, NextResponse } from "next/server";
import { hit } from "@/lib/rateLimit";
import { requireAuth } from "@/lib/auth";
import { logError } from "@/lib/logger";
import {
  copyFilesViaSSH,
  installServiceViaSSH,
  type SSHCredentials,
} from "@/lib/sshService";
import { db } from "@/lib/db";

// TODO: [FUTURO] Implementar SSE para streaming de progreso granular.
// Actualmente se usa un approach de dos llamadas HTTP (fase copy + fase install).

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
      { userId: auth.userId, ip: ipClient }
    );
    if (!rl.allowed) {
      return NextResponse.json({ error: "Rate limit" }, { status: 429 });
    }

    const body = await req.json();
    const ip = body.ip as string;
    const username = body.username as string;
    const password = body.password as string;
    const phase = body.phase as string;
    const port = typeof body.port === "number" ? body.port : 22;

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
        { status: 400 }
      );
    }

    const creds: SSHCredentials = {
      host: ip.trim(),
      username: username.trim(),
      password,
      port,
    };

    let result;

    if (phase === "copy") {
      result = await copyFilesViaSSH(creds);
    } else {
      result = await installServiceViaSSH(creds);

      // Si la instalación fue exitosa, actualizar la DB
      if (result.success) {
        try {
          await (db as any).computer.updateMany({
            where: { ipAddress: ip.trim() },
            data: {
              serviceInstalled: true,
              serviceRunning: true,
              lastServiceCheck: new Date(),
            },
          });
        } catch (dbErr) {
          // No fallar la respuesta por un error de DB
          logError("Error al actualizar Computer en DB tras instalación", dbErr);
        }
      }
    }

    // Limpiar credenciales de memoria explícitamente
    creds.password = "";
    creds.username = "";

    const res = NextResponse.json(
      { ...result, phase },
      { status: result.success ? 200 : 502 }
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
      { status: 500 }
    );
  }
}

export const dynamic = "force-dynamic";
