import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { hashPassword } from "@/lib/auth";
import { requireAdminUser } from "@/lib/admin";
import {
  normalizeIpAddress,
  sanitizePassword,
  sanitizeUsername,
  serializeUser,
} from "../_helpers";

function unauthorized() {
  return NextResponse.json(
    { ok: false, error: "No autorizado" },
    { status: 401 }
  );
}

function badRequest(message: string) {
  return NextResponse.json({ ok: false, error: message }, { status: 400 });
}

function notFound(message: string) {
  return NextResponse.json({ ok: false, error: message }, { status: 404 });
}

export async function PATCH(
  req: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  const admin = await requireAdminUser(req);
  if (!admin) return unauthorized();

  const { id: userId } = await context.params;
  if (!userId) return badRequest("ID inválido");

  let body: any;
  try {
    body = await req.json();
  } catch {
    return badRequest("JSON inválido");
  }

  const usernameProvided = Object.prototype.hasOwnProperty.call(
    body,
    "username"
  );
  const passwordProvided = Object.prototype.hasOwnProperty.call(
    body,
    "password"
  );
  const ipProvided = Object.prototype.hasOwnProperty.call(body, "ipAddress");

  if (!usernameProvided && !passwordProvided && !ipProvided) {
    return badRequest("No se enviaron cambios");
  }

  const username = usernameProvided ? sanitizeUsername(body?.username) : null;
  if (usernameProvided && !username) {
    return badRequest("El nombre de usuario es obligatorio");
  }

  const password = passwordProvided ? sanitizePassword(body?.password) : null;

  let computerId: string | null | undefined = undefined;
  if (ipProvided) {
    const ipAddress = normalizeIpAddress(body?.ipAddress);
    if (!ipAddress) {
      computerId = null;
    } else {
      const computer = await db.computer.findFirst({
        where: {
          ipAddress: {
            equals: ipAddress,
            mode: "insensitive",
          },
        },
        select: { id: true },
      });

      if (!computer) {
        return notFound("No se encontró una computadora con esa IP");
      }

      computerId = computer.id;
    }
  }

  try {
    const data: Prisma.UserUpdateInput = {};

    if (usernameProvided && username) {
      data.username = username;
    }

    if (passwordProvided) {
      if (password) {
        data.passwordHash = await hashPassword(password);
      }
    }

    if (computerId !== undefined) {
      if (computerId === null) {
        data.computer = { disconnect: true };
      } else {
        data.computer = { connect: { id: computerId } };
      }
    }

    if (Object.keys(data).length === 0) {
      return badRequest("No se enviaron cambios válidos");
    }

    const user = await db.user.update({
      where: { id: userId },
      data,
      include: {
        computer: {
          select: { id: true, name: true, ipAddress: true },
        },
      },
    });

    return NextResponse.json({
      ok: true,
      item: serializeUser(user),
    });
  } catch (error: any) {
    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      if (error.code === "P2002") {
        return NextResponse.json(
          { ok: false, error: "El usuario ya existe" },
          { status: 409 }
        );
      }
      if (error.code === "P2025") {
        return notFound("Usuario no encontrado");
      }
    }

    console.error("Error updating user:", error);
    return NextResponse.json(
      { ok: false, error: "Error interno del servidor" },
      { status: 500 }
    );
  }
}

export async function DELETE(
  req: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  const admin = await requireAdminUser(req);
  if (!admin) return unauthorized();

  const { id: userId } = await context.params;
  if (!userId) return badRequest("ID inválido");

  if (userId === admin.userId) {
    return badRequest("No puedes eliminar tu propio usuario");
  }

  try {
    await db.user.delete({ where: { id: userId } });
    return NextResponse.json({ ok: true });
  } catch (error: any) {
    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      if (error.code === "P2025") {
        return notFound("Usuario no encontrado");
      }
    }

    console.error("Error deleting user:", error);
    return NextResponse.json(
      { ok: false, error: "Error interno del servidor" },
      { status: 500 }
    );
  }
}
