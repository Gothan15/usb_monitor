import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { generateApiKey, hashPassword, requireAuth } from "@/lib/auth";
import { sanitizePassword, sanitizeUsername } from "../../users/_helpers";
import { logError } from "@/lib/logger";

export async function POST(req: NextRequest) {
  try {
    await requireAuth(req, { role: "admin" });

    let body: unknown;
    try {
      body = await req.json();
    } catch {
      return NextResponse.json({ error: "JSON inválido" }, { status: 400 });
    }

    const username = sanitizeUsername((body as any)?.username);
    const password = sanitizePassword((body as any)?.password);

    if (!username || !password) {
      return NextResponse.json(
        { error: "Usuario y contraseña son obligatorios" },
        { status: 400 }
      );
    }

    const exists = await (db as any).user.findUnique({ where: { username } });
    if (exists) {
      return NextResponse.json({ error: "Usuario ya existe" }, { status: 409 });
    }

    const passwordHash = await hashPassword(password);
    const apiKey = generateApiKey();
    const user = await (db as any).user.create({
      data: { username, passwordHash, apiKey },
    });
    return NextResponse.json({ id: user.id, username, apiKey });
  } catch (error: any) {
    if (error?.message === "UNAUTHORIZED" || error?.message === "FORBIDDEN") {
      return NextResponse.json({ error: "No autorizado" }, { status: 401 });
    }
    logError("Error creando usuario desde register", error);
    return NextResponse.json(
      { error: "Error interno del servidor" },
      { status: 500 }
    );
  }
}

export const dynamic = "force-dynamic";
