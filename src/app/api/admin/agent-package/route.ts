import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
import { logError } from "@/lib/logger";
import {
  ErrorPaqueteInvalido,
  LIMITE_PAQUETE_BYTES,
  colocarPaquete,
  estadoPaqueteAgente,
  validarVersion,
  versionDesdeNombre,
  versionPeDesdeZip,
} from "@/lib/paqueteAdmin";

/**
 * GET /api/admin/agent-package
 * Estado del paquete del agente colocado en el panel: versión,
 * huella y presencia del ejecutable y del empujador.
 *
 * POST /api/admin/agent-package
 * Recibe el zip de la Release del agente (formulario, campo
 * «paquete»; campo «version» opcional) y lo coloca: el
 * ejecutable en `paquete-agente/` con su manifiesto y el
 * empujador en `empujador/`. Sin esto el administrador tenía que
 * dejar los archivos a mano en las carpetas del panel.
 */

function noAutorizado() {
  return NextResponse.json(
    { ok: false, error: "No autorizado" },
    { status: 401 },
  );
}

function errorJson(error: string, status: number) {
  return NextResponse.json({ ok: false, error }, { status });
}

export async function GET(req: NextRequest) {
  try {
    await requireAuth(req, { role: "admin" });
    const estado = await estadoPaqueteAgente();
    return NextResponse.json({ ok: true, ...estado });
  } catch (error: any) {
    if (error?.message === "UNAUTHORIZED" || error?.message === "FORBIDDEN") {
      return noAutorizado();
    }
    logError("Error en GET /api/admin/agent-package", error);
    return errorJson("No se pudo leer el estado del paquete", 500);
  }
}

export async function POST(req: NextRequest) {
  try {
    await requireAuth(req, { role: "admin" });

    const form = await req.formData().catch(() => null);
    const archivo = form?.get("paquete");
    if (
      !archivo ||
      typeof archivo !== "object" ||
      typeof (archivo as File).arrayBuffer !== "function"
    ) {
      return errorJson(
        "Falta el archivo del paquete: elige el zip de la Release del agente.",
        400,
      );
    }
    const file = archivo as File;

    if (file.size > LIMITE_PAQUETE_BYTES) {
      return errorJson(
        "El archivo es demasiado grande: el zip de la Release pesa unos 95 MB.",
        413,
      );
    }

    const bytes = new Uint8Array(await file.arrayBuffer());

    // La versión manda el propio ejecutable: se lee de su PE
    // (VERSIONINFO) y el nombre del zip o el campo manual solo
    // valen si el exe no declara ninguna.
    const version =
      versionPeDesdeZip(bytes) ??
      validarVersion(form?.get("version")) ??
      versionDesdeNombre(file.name || "");
    if (!version) {
      return errorJson(
        "No se pudo saber la versión: el ejecutable no la declara y el nombre del archivo no la trae. Escríbela en el campo de versión (por ejemplo, 1.0.19).",
        400,
      );
    }
    const { estado, avisos } = await colocarPaquete(bytes, version);
    return NextResponse.json({ ok: true, estado, avisos });
  } catch (error: any) {
    if (error?.message === "UNAUTHORIZED" || error?.message === "FORBIDDEN") {
      return noAutorizado();
    }
    if (error instanceof ErrorPaqueteInvalido) {
      return errorJson(error.message, 400);
    }
    logError("Error en POST /api/admin/agent-package", error);
    return errorJson("No se pudo colocar el paquete en el panel", 500);
  }
}
