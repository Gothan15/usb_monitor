import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import {
  normalizeSerial,
  sanitizeText,
  serializeWhitelistEntry,
  requireAdminUser,
} from "./_helpers";

function unauthorized() {
  return NextResponse.json(
    { ok: false, error: "No autorizado" },
    { status: 401 }
  );
}

export async function GET(req: NextRequest) {
  const admin = await requireAdminUser(req);
  if (!admin) return unauthorized();

  try {
    const entries = await (db as any).uSBWhitelist.findMany({
      orderBy: { createdAt: "desc" },
      include: {
        createdBy: {
          select: { id: true, username: true },
        },
      },
    });

    return NextResponse.json({
      ok: true,
      items: entries.map(serializeWhitelistEntry),
    });
  } catch (error) {
    console.error("Error obteniendo whitelist:", error);
    return NextResponse.json(
      { ok: false, error: "Error interno del servidor" },
      { status: 500 }
    );
  }
}

export async function POST(req: NextRequest) {
  const admin = await requireAdminUser(req);
  if (!admin) return unauthorized();

  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(
      { ok: false, error: "JSON inválido" },
      { status: 400 }
    );
  }

  const serialInput =
    typeof body?.serialNumber === "string" ? body.serialNumber : "";
  const label = sanitizeText(body?.label, 120);
  const notes = sanitizeText(body?.notes, 500);

  const normalizedSerial = normalizeSerial(serialInput);

  if (!normalizedSerial) {
    return NextResponse.json(
      { ok: false, error: "serialNumber es requerido" },
      { status: 400 }
    );
  }

  if (normalizedSerial.length < 1) {
    return NextResponse.json(
      { ok: false, error: "El serial es requerido y no puede estar vacío" },
      { status: 400 }
    );
  }

  if (normalizedSerial.length > 128) {
    return NextResponse.json(
      { ok: false, error: "El serial excede el máximo de 128 caracteres" },
      { status: 400 }
    );
  }

  try {
    const entry = await (db as any).uSBWhitelist.create({
      data: {
        serialNumber: normalizedSerial,
        label,
        notes,
        createdById: admin.userId,
      },
      include: {
        createdBy: {
          select: { id: true, username: true },
        },
      },
    });

    return NextResponse.json(
      {
        ok: true,
        item: serializeWhitelistEntry(entry),
      },
      { status: 201 }
    );
  } catch (error: any) {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2002"
    ) {
      return NextResponse.json(
        { ok: false, error: "El serial ya está en la whitelist" },
        { status: 409 }
      );
    }

    console.error("Error creando entrada de whitelist:", error);
    return NextResponse.json(
      { ok: false, error: "Error interno del servidor" },
      { status: 500 }
    );
  }
}
