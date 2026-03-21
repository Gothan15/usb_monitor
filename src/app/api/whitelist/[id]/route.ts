import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import {
  requireAdminUser,
  sanitizeText,
  serializeWhitelistEntry,
} from "../_helpers";

function unauthorized() {
  return NextResponse.json(
    { ok: false, error: "No autorizado" },
    { status: 401 },
  );
}

function notFound() {
  return NextResponse.json(
    { ok: false, error: "Elemento no encontrado" },
    { status: 404 },
  );
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const admin = await requireAdminUser(req);
  if (!admin) return unauthorized();

  const { id } = await params;
  if (!id) return notFound();

  try {
    const deleted = await (db as any).uSBWhitelist.delete({
      where: { id },
      include: { createdBy: { select: { id: true, username: true } } },
    });

    return NextResponse.json({
      ok: true,
      item: serializeWhitelistEntry(deleted),
    });
  } catch (error) {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2025"
    ) {
      return notFound();
    }

    console.error("Error eliminando elemento de whitelist:", error);
    return NextResponse.json(
      { ok: false, error: "Error interno del servidor" },
      { status: 500 },
    );
  }
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const admin = await requireAdminUser(req);
  if (!admin) return unauthorized();

  const { id } = await params;
  if (!id) return notFound();

  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(
      { ok: false, error: "JSON inválido" },
      { status: 400 },
    );
  }

  const data: Record<string, string | null> = {};
  let hasUpdates = false;

  if (Object.prototype.hasOwnProperty.call(body, "label")) {
    data.label = sanitizeText(body.label, 120);
    hasUpdates = true;
  }

  if (Object.prototype.hasOwnProperty.call(body, "notes")) {
    data.notes = sanitizeText(body.notes, 500);
    hasUpdates = true;
  }

  if (!hasUpdates) {
    return NextResponse.json(
      { ok: false, error: "No hay cambios para aplicar" },
      { status: 400 },
    );
  }

  try {
    const updated = await (db as any).uSBWhitelist.update({
      where: { id },
      data,
      include: { createdBy: { select: { id: true, username: true } } },
    });

    return NextResponse.json({
      ok: true,
      item: serializeWhitelistEntry(updated),
    });
  } catch (error) {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2025"
    ) {
      return notFound();
    }

    console.error("Error actualizando whitelist:", error);
    return NextResponse.json(
      { ok: false, error: "Error interno del servidor" },
      { status: 500 },
    );
  }
}
