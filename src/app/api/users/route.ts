import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { hashPassword, generateApiKey } from "@/lib/auth";
import { requireAdminUser } from "@/lib/admin";
import {
  buildUserSearchFilter,
  normalizeIpAddress,
  sanitizePassword,
  sanitizeUsername,
  serializeUser,
} from "./_helpers";
import { broadcastUserChange } from "@/lib/socket";

function unauthorized() {
  return NextResponse.json(
    { ok: false, error: "No autorizado" },
    { status: 401 },
  );
}

function badRequest(message: string) {
  return NextResponse.json({ ok: false, error: message }, { status: 400 });
}

function notFound(message: string) {
  return NextResponse.json({ ok: false, error: message }, { status: 404 });
}

export async function GET(req: NextRequest) {
  const admin = await requireAdminUser(req);
  if (!admin) return unauthorized();

  const { searchParams } = new URL(req.url);
  const pageParam = Number(searchParams.get("page") || "1");
  const pageSizeParam = Number(searchParams.get("pageSize") || "10");
  const searchRaw = searchParams.get("q");

  const search = searchRaw?.trim() || null;
  const page =
    Number.isFinite(pageParam) && pageParam > 0 ? Math.floor(pageParam) : 1;
  const pageSizeRaw =
    Number.isFinite(pageSizeParam) && pageSizeParam > 0
      ? Math.floor(pageSizeParam)
      : 10;
  const pageSize = Math.min(Math.max(pageSizeRaw, 1), 100);

  try {
    const where = buildUserSearchFilter(search);
    const total = await db.user.count({ where });
    const totalPages = Math.max(1, Math.ceil(total / pageSize));
    const safePage = Math.min(Math.max(page, 1), totalPages);
    const skip = (safePage - 1) * pageSize;

    const users = await db.user.findMany({
      where,
      include: {
        computer: {
          select: { id: true, name: true, ipAddress: true },
        },
      },
      orderBy: { createdAt: "desc" },
      skip,
      take: pageSize,
    });

    return NextResponse.json({
      ok: true,
      items: users.map(serializeUser),
      total,
      page: safePage,
      pageSize,
    });
  } catch (error) {
    console.error("Error listing users:", error);
    return NextResponse.json(
      { ok: false, error: "Error interno del servidor" },
      { status: 500 },
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
    return badRequest("JSON inválido");
  }

  const username = sanitizeUsername(body?.username);
  const password = sanitizePassword(body?.password);
  const ipAddress = normalizeIpAddress(body?.ipAddress);

  if (!username) {
    return badRequest("El nombre de usuario es obligatorio");
  }

  if (!password) {
    return badRequest("La contraseña es obligatoria");
  }

  // La asignación se hace por ID de equipo: es la fila exacta que el
  // administrador eligió en la lista. Antes se resolvía por la IP del
  // equipo, que NO es única (varios equipos pueden compartir
  // 127.0.0.1 o una IP vieja): el findFirst enlazaba al usuario con
  // OTRA fila y el agente de su PC seguía sin dueño. La vía por IP
  // queda solo como compatibilidad si no llega computerId.
  let computerId: string | null = null;
  if (Object.prototype.hasOwnProperty.call(body, "computerId")) {
    const bruto = body?.computerId;
    if (typeof bruto === "string" && bruto.trim()) {
      const computer = await db.computer.findUnique({
        where: { id: bruto.trim() },
        select: { id: true },
      });
      if (!computer) {
        return notFound("No se encontró el equipo seleccionado");
      }
      computerId = computer.id;
    }
  } else if (ipAddress) {
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

  try {
    const passwordHash = await hashPassword(password);
    const apiKey = generateApiKey();

    const user = await db.user.create({
      data: {
        username,
        passwordHash,
        apiKey,
        role: "USER",
        computerId,
      },
      include: {
        computer: {
          select: { id: true, name: true, ipAddress: true },
        },
      },
    });

    broadcastUserChange();
    return NextResponse.json({
      ok: true,
      item: serializeUser(user),
    });
  } catch (error: any) {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2002"
    ) {
      return NextResponse.json(
        { ok: false, error: "El usuario ya existe" },
        { status: 409 },
      );
    }

    console.error("Error creating user:", error);
    return NextResponse.json(
      { ok: false, error: "Error interno del servidor" },
      { status: 500 },
    );
  }
}

function sanitizeIds(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  for (const item of value) {
    if (typeof item === "string" && item.trim()) seen.add(item.trim());
    if (seen.size >= 500) break;
  }
  return [...seen];
}

export async function DELETE(req: NextRequest) {
  const admin = await requireAdminUser(req);
  if (!admin) return unauthorized();

  const body = await req.json().catch(() => null);
  const ids = sanitizeIds((body as any)?.ids);
  if (!ids.length) return badRequest("Selecciona al menos un usuario");

  // La misma guarda del borrado individual: nunca tu propio usuario.
  const skippedSelf = ids.includes(admin.userId);
  const targets = ids.filter((id) => id !== admin.userId);

  try {
    const existing = await db.user.findMany({
      where: { id: { in: targets } },
      select: { id: true },
    });
    const found = existing.map((u) => u.id);
    if (found.length) {
      await db.user.deleteMany({ where: { id: { in: found } } });
      broadcastUserChange();
    }
    return NextResponse.json({
      ok: true,
      deleted: found.length,
      skippedSelf,
      notFound: targets.filter((id) => !found.includes(id)),
    });
  } catch (error) {
    console.error("Error deleting users in bulk:", error);
    return NextResponse.json(
      { ok: false, error: "Error interno del servidor" },
      { status: 500 },
    );
  }
}
